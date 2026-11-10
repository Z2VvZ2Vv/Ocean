import { attachmentFormat } from './attachments.js'
import { artifactType, fileInputLimit, safeInputName } from './code.js'
import { isTextDocument, readOfficeText, readTextChunk, textChunkSize } from './document-text.js'

const imageFormats = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'])

function documentInfo(file) {
  return { id: file.id, name: file.name.slice(0, 180), format: file.format, bytes: file.size ?? file.blob?.size,
    ...(file.source && { source: file.source }) }
}

export function generatedFiles(message, turn) {
  return (message.artifacts || []).flatMap(({ name, url }, index) => {
    const mime = artifactType(name)
    if (!mime || typeof url !== 'string' || !url.startsWith(`data:${mime};base64,`)) return []
    return [{ id: `generated-${turn}-${index + 1}`, name, url, mime,
      format: attachmentFormat(name, mime).toUpperCase(), source: 'generated' }]
  })
}

export function attachmentCatalog(messages) {
  const files = new Map()
  for (let turn = messages.length - 1; turn >= 0; turn--) {
    const message = messages[turn]
    if (message.role === 'assistant') {
      for (const file of generatedFiles(message, turn + 1)) files.set(file.id, file)
    }
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
  const end = offset + textChunkSize
  return { text: text.slice(offset, end), ...(end < text.length && { next_offset: end }) }
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

async function originalBlob(file, signal) {
  if (file.blob) return file.blob
  if (file.url?.startsWith('data:image/') || file.source === 'generated') {
    const response = await fetch(file.url, { signal })
    return response.blob()
  }
}

function tool(name, label, description, properties, required, run) {
  return { label, definition: {
    type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
  }, run }
}

export function fileTools(messages) {
  const files = attachmentCatalog(messages)
  const selectors = {
    file_id: { type: 'string', description: 'Identifiant indiqué dans le message ou renvoyé par list_attachments.' },
    entry: { type: 'integer', minimum: 1, description: 'Numéro d’une entrée ZIP renvoyé par read_attachment, si nécessaire.' },
  }
  const pageField = { type: 'integer', minimum: 1, description: 'Numéro de page PDF, à partir de 1.' }
  const offsetField = { type: 'integer', minimum: 0, description: 'Reprendre à la valeur next_offset du résultat précédent.' }

  async function resolve({ file_id, entry }, signal) {
    signal.throwIfAborted()
    const file = files.get(file_id)
    if (!file) throw new Error('Fichier inconnu. Utilise list_attachments pour retrouver son identifiant.')
    if (entry === undefined) return file
    const blob = fileFormat(file) === 'zip' && await originalBlob(file, signal)
    if (!blob) throw new Error('Ce fichier n’est pas une archive ZIP disponible.')
    const { extractArchiveEntry } = await import('./archive.js')
    return extractArchiveEntry(blob, whole(entry, 1, Number.MAX_SAFE_INTEGER, 'Numéro d’entrée'), signal)
  }

  async function mount(selections, signal) {
    if (!Array.isArray(selections) || selections.length > 32) throw new Error('Sélectionne jusqu’à 32 fichiers par exécution.')
    const mounted = []
    let size = 0
    for (const selection of selections) {
      const file = await resolve(selection, signal)
      let blob = await originalBlob(file, signal)
      if (!blob && file.text) blob = new Blob([file.text], { type: 'text/plain' })
      if (!blob) throw new Error(`Le fichier original de ${file.name} n’est plus disponible. Joins-le de nouveau.`)
      size += blob.size
      if (size > fileInputLimit) throw new Error('Les fichiers sélectionnés dépassent 32 Mio pour une exécution Python. Traite-les par lots.')
      const label = file.text !== undefined && !file.blob ? `${file.name}.txt` : file.name
      mounted.push({ name: safeInputName(label, mounted.length), blob })
    }
    return mounted
  }

  const canSearchPdf = [...files.values()].some(file => {
    const format = fileFormat(file)
    return (format === 'pdf' || format === 'zip') && (file.blob || file.source === 'generated')
  })
  const tools = files.size ? [
    tool('list_attachments', 'Liste des fichiers', 'Liste les pièces jointes et les fichiers produits dans les réponses précédentes, les plus récents en premier. Filtre par nom ou utilise next_offset pour voir la suite.', {
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
      if (format === 'image' || imageFormats.has(format)) return { name, note: 'Utilise view_attachment pour examiner cette image.' }
      const blob = await originalBlob(file, signal)
      if (!blob) return { name, note: 'Utilise view_attachment pour examiner cette image ou cette page scannée.' }
      if (format === 'pdf') {
        const { readPdfPages } = await import('./pdf.js')
        const page = whole(args.page ?? 1, 1, Number.MAX_SAFE_INTEGER, 'Numéro de page')
        const count = whole(args.count ?? (offset ? 1 : 3), 1, 5, 'Nombre de pages')
        return { name, ...await readPdfPages(blob, page, count, offset, signal) }
      }
      if (format === 'zip') {
        const { listArchive } = await import('./archive.js')
        return { name, ...await listArchive(blob, offset, signal) }
      }
      if (format === 'docx' || format === 'xlsx') return { name, ...chunkText(await readOfficeText(blob, format, signal), offset) }
      if (isTextDocument(blob, format)) return { name, ...await readTextChunk(blob, offset, signal) }
      return { name, note: 'Utilise view_attachment pour une image, ou passe ce fichier à Python pour l’analyser.' }
    }),
    ...(canSearchPdf ? [tool('search_attachment', 'Recherche dans le PDF',
      'Recherche un mot ou un titre précis dans le texte d’un PDF, par exemple « TD 2 ». Renvoie les pages trouvées avec un extrait. Utilise next_page pour poursuivre si nécessaire. Passe entry si le PDF est dans un ZIP.', {
        ...selectors, page: pageField, query: { type: 'string', maxLength: 120 },
      }, ['file_id', 'query'], async ({ query, page = 1, ...args }, signal, onProgress) => {
        if (typeof query !== 'string' || !query.trim() || query.length > 120) throw new Error('Recherche dans le PDF invalide.')
        const start = whole(page, 1, Number.MAX_SAFE_INTEGER, 'Numéro de page')
        const file = await resolve(args, signal)
        const blob = fileFormat(file) === 'pdf' && await originalBlob(file, signal)
        if (!blob) throw new Error('La recherche nécessite le PDF original.')
        const { searchPdf } = await import('./pdf.js')
        return { name: file.name.slice(0, 180), ...await searchPdf(blob, query.trim(), start, signal, onProgress) }
      })] : []),
    tool('view_attachment', 'Examen visuel d’une page', 'Observe une image ou la page précise d’un PDF. Utile pour les scans, figures, tableaux et mises en page que le texte extrait ne restitue pas. Passe entry pour une image ou un PDF dans un ZIP.', {
      ...selectors, page: pageField,
    }, ['file_id'], async (args, signal) => {
      const file = await resolve(args, signal)
      const page = whole(args.page ?? 1, 1, Number.MAX_SAFE_INTEGER, 'Numéro de page')
      const format = fileFormat(file)
      let url
      if (format === 'pdf' && (file.blob || file.source === 'generated')) {
        const blob = await originalBlob(file, signal)
        const { viewPdfPage } = await import('./pdf.js')
        url = await viewPdfPage(blob, page, signal)
      } else if (file.url && (format === 'image' || imageFormats.has(format))) {
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
  ].map(item => ({ ...item, detail(args) {
    const file = files.get(args?.file_id)
    if (!file) return ''
    const page = Number.isSafeInteger(args.page) && args.page > 0 ? `, page ${args.page}` : ''
    return `« ${file.name.slice(0, 100)} »${page}`
  } })) : []
  return { tools, mount, selectors, hasFiles: files.size > 0 }
}
