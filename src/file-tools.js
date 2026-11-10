import { attachmentFormat } from './attachments.js'
import { fileInputLimit, safeInputName } from './code.js'

const textFormats = new Set('txt md markdown csv tsv json jsonl xml yaml yml log ini sql py js ts jsx tsx html css java c cpp h hpp rs go sh ps1 tex'.split(' '))
const imageFormats = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'])
const textLimit = 12000

function documentInfo(file) {
  return { id: file.id, name: file.name.slice(0, 180), format: file.format, bytes: file.size ?? file.blob?.size }
}

export function attachmentCatalog(messages) {
  const files = new Map()
  for (let turn = messages.length - 1; turn >= 0; turn--) {
    const message = messages[turn]
    if (message.role !== 'user') continue
    const documents = [...(message.documents || []), ...(message.images || [])]
    documents.forEach((file, index) => {
      const id = file.id || `${turn + 1}-${index + 1}`
      const format = file.format || (file.url ? 'IMAGE' : attachmentFormat(file.name, file.mime || file.blob?.type).toUpperCase())
      if (!files.has(id)) files.set(id, { ...file, id, format })
    })
  }
  return files
}

function whole(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} invalide.`)
  return value
}

function chunkText(text, offset) {
  const end = offset + textLimit
  return { text: text.slice(offset, end), ...(end < text.length && { next_offset: end }) }
}

async function readPlainText(blob, offset) {
  const prefix = new Uint8Array(await blob.slice(0, 3).arrayBuffer())
  const encoding = prefix[0] === 0xff && prefix[1] === 0xfe ? 'utf-16le'
    : prefix[0] === 0xfe && prefix[1] === 0xff ? 'utf-16be' : 'utf-8'
  if (encoding !== 'utf-8' && offset % 2 !== 0) throw new Error('Utilise next_offset pour poursuivre la lecture du texte.')
  const bytes = new Uint8Array(await blob.slice(offset, offset + textLimit + 1).arrayBuffer())
  let length = Math.min(bytes.length, textLimit)
  if (encoding === 'utf-8' && bytes.length > length) {
    while (length > 0 && (bytes[length] & 0xc0) === 0x80) length--
    if (!length) length = textLimit
  }
  const content = bytes.subarray(0, length)
  let text
  try { text = new TextDecoder(encoding, { fatal: true }).decode(content) }
  catch { text = new TextDecoder(encoding === 'utf-8' ? 'windows-1252' : encoding).decode(content) }
  if (text.includes('\0')) throw new Error('Le fichier semble binaire. Passe-le à Python pour l’analyser.')
  const end = offset + length
  return { text, ...(end < blob.size && { next_offset: end }), offset_unit: 'bytes' }
}

async function readOffice(blob, format) {
  if (format === 'docx') {
    const { default: mammoth } = await import('mammoth')
    const { value } = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() })
    return value
  }
  const { default: readWorkbook } = await import('read-excel-file/browser')
  const sheets = await readWorkbook(blob)
  return sheets.filter(sheet => sheet.data.length).map(({ sheet, data }) => (
    [`Feuille ${JSON.stringify(sheet)}`, ...data.map(row => JSON.stringify(row))].join('\n')
  )).join('\n\n')
}

async function viewImage(blob) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    context.fillStyle = 'white'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.88)
  } finally {
    bitmap.close()
    canvas.width = canvas.height = 0
  }
}

function fileFormat(file) {
  return file.format === 'IMAGE' ? 'image' : attachmentFormat(file.name, file.mime || file.blob?.type)
}

function tool(name, label, description, properties, required, run) {
  return { label, definition: {
    type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
  }, run }
}

export function fileTools(messages) {
  const files = attachmentCatalog(messages)
  const selectors = {
    file_id: { type: 'string', description: 'Identifiant renvoyé par list_attachments.' },
    entry: { type: 'integer', minimum: 1, description: 'Numéro d’une entrée ZIP renvoyé par read_attachment, si nécessaire.' },
  }
  const pageField = { type: 'integer', minimum: 1, description: 'Numéro de page PDF, à partir de 1.' }
  const offsetField = { type: 'integer', minimum: 0, description: 'Reprendre à la valeur next_offset du résultat précédent.' }

  async function resolve({ file_id, entry }, signal) {
    signal.throwIfAborted()
    const file = files.get(file_id)
    if (!file) throw new Error('Pièce jointe inconnue. Utilise list_attachments pour retrouver son identifiant.')
    if (entry === undefined) return file
    if (fileFormat(file) !== 'zip' || !file.blob) throw new Error('Ce fichier n’est pas une archive ZIP disponible.')
    const { extractArchiveEntry } = await import('./archive.js')
    return extractArchiveEntry(file.blob, whole(entry, 1, Number.MAX_SAFE_INTEGER, 'Numéro d’entrée'), signal)
  }

  async function mount(selections, signal) {
    if (!Array.isArray(selections) || selections.length > 32) throw new Error('Sélectionne jusqu’à 32 fichiers par exécution.')
    const mounted = []
    let size = 0
    for (const selection of selections) {
      const file = await resolve(selection, signal)
      let blob = file.blob
      if (!blob && file.url?.startsWith('data:image/')) blob = await fetch(file.url, { signal }).then(result => result.blob())
      if (!blob && file.text) blob = new Blob([file.text], { type: 'text/plain' })
      if (!blob) throw new Error(`Le fichier original de ${file.name} n’est plus disponible. Joins-le de nouveau.`)
      size += blob.size
      if (size > fileInputLimit) throw new Error('Les fichiers sélectionnés dépassent 32 Mio pour une exécution Python. Traite-les par lots.')
      const label = file.text !== undefined && !file.blob ? `${file.name}.txt` : file.name
      mounted.push({ name: safeInputName(label, mounted.length), blob })
    }
    return mounted
  }

  const tools = files.size ? [
    tool('list_attachments', 'Liste des pièces jointes', 'Liste tous les fichiers de cette discussion, les plus récents en premier. Filtre par nom ou utilise next_offset pour voir la suite.', {
      query: { type: 'string' }, offset: offsetField,
    }, [], ({ query = '', offset = 0 }) => {
      whole(offset, 0, Number.MAX_SAFE_INTEGER, 'Décalage')
      if (typeof query !== 'string') throw new Error('Filtre invalide.')
      const matches = [...files.values()].filter(file => file.name.toLowerCase().includes(query.toLowerCase()))
      return { total: matches.length, files: matches.slice(offset, offset + 20).map(documentInfo),
        ...(offset + 20 < matches.length && { next_offset: offset + 20 }) }
    }),
    tool('read_attachment', 'Lecture d’une pièce jointe', 'Lit le texte d’un fichier, quelques pages PDF, ou liste les entrées d’un ZIP. Passe entry pour lire une entrée du ZIP. Utilise next_page ou next_offset pour poursuivre.', {
      ...selectors, page: pageField, count: { type: 'integer', minimum: 1, maximum: 5 }, offset: offsetField,
    }, ['file_id'], async (args, signal) => {
      const file = await resolve(args, signal)
      const offset = whole(args.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, 'Décalage')
      const format = fileFormat(file)
      const name = file.name.slice(0, 180)
      if (!file.blob && file.text) return { name, ...chunkText(file.text, offset), page_count: file.pageCount }
      if (!file.blob) return { name, note: 'Utilise view_attachment pour examiner cette image ou cette page scannée.' }
      if (format === 'pdf') {
        const { readPdfPages } = await import('./pdf.js')
        const page = whole(args.page ?? 1, 1, Number.MAX_SAFE_INTEGER, 'Numéro de page')
        const count = whole(args.count ?? (offset ? 1 : 3), 1, 5, 'Nombre de pages')
        return { name, ...await readPdfPages(file.blob, page, count, offset, signal) }
      }
      if (format === 'zip') {
        const { listArchive } = await import('./archive.js')
        return { name, ...await listArchive(file.blob, offset, signal) }
      }
      if (format === 'docx' || format === 'xlsx') return { name, ...chunkText(await readOffice(file.blob, format), offset) }
      if (file.blob.type.startsWith('text/') || textFormats.has(format)) return { name, ...await readPlainText(file.blob, offset) }
      return { name, note: 'Utilise view_attachment pour une image, ou passe ce fichier à Python pour l’analyser.' }
    }),
    tool('view_attachment', 'Examen visuel d’une page', 'Observe une image ou la page précise d’un PDF. Utile pour les scans, figures, tableaux et mises en page que le texte extrait ne restitue pas. Passe entry pour une image ou un PDF dans un ZIP.', {
      ...selectors, page: pageField,
    }, ['file_id'], async (args, signal) => {
      const file = await resolve(args, signal)
      const page = whole(args.page ?? 1, 1, Number.MAX_SAFE_INTEGER, 'Numéro de page')
      const format = fileFormat(file)
      let url
      if (format === 'pdf' && file.blob) {
        const { viewPdfPage } = await import('./pdf.js')
        url = await viewPdfPage(file.blob, page, signal)
      } else if (file.url) {
        url = file.url
      } else if (file.blob && (file.blob.type.startsWith('image/') || imageFormats.has(format))) {
        url = await viewImage(file.blob)
      } else {
        url = file.pageImages?.find(image => image.number === page)?.url
      }
      if (!url) throw new Error('Cette page ou image n’est pas disponible. Pour un ancien PDF, joins le fichier original de nouveau.')
      signal.throwIfAborted()
      const label = `${file.name.slice(0, 180)}${format === 'pdf' ? ` — page ${page}` : ''}`
      return { image: label, images: [{ label, url }] }
    }),
  ] : []
  return { tools, mount, selectors, hasFiles: files.size > 0 }
}
