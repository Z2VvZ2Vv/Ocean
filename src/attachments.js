import { maxImages, readImages } from './clipboard.js'

const maxDocuments = 4
const maxDocumentBytes = 12 * 1024 * 1024
const maxDocumentText = 45000
const textExtensions = 'txt md markdown csv tsv json jsonl xml yaml yml log ini sql py js ts jsx tsx html css java c cpp h hpp rs go sh ps1 tex'.split(' ')
const documentTypes = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export const attachmentTypes = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/*',
  ...Object.keys(documentTypes).map(extension => `.${extension}`),
  ...textExtensions.map(extension => `.${extension}`),
].join(',')

export function imageSlots({ images, documents }) {
  return maxImages - images.length - documents.reduce((count, file) => count + (file.pageImages?.length || 0), 0)
}

async function readWord(file) {
  const { default: mammoth } = await import('mammoth')
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return value
}

async function readExcel(file) {
  const { default: readWorkbook } = await import('read-excel-file/browser')
  const sheets = await readWorkbook(file)
  return sheets.filter(sheet => sheet.data.length).map(({ sheet, data }) => (
    [`Feuille ${JSON.stringify(sheet)}`, ...data.map(row => JSON.stringify(row))].join('\n')
  )).join('\n\n')
}

async function readText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

async function readDocument(file, slots, textLimit, signal) {
  if (file.size > maxDocumentBytes) throw new Error('Le fichier dépasse 12 Mo.')
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  const format = Object.hasOwn(documentTypes, extension) ? extension
    : Object.keys(documentTypes).find(key => documentTypes[key] === file.type)
  let result
  if (format === 'pdf') {
    const { readPdf } = await import('./pdf.js')
    result = await readPdf(file, slots, textLimit, signal)
  } else if (format === 'docx') {
    result = { text: await readWord(file) }
  } else if (format === 'xlsx') {
    result = { text: await readExcel(file) }
  } else if (file.type.startsWith('text/') || textExtensions.includes(extension)) {
    result = { text: await readText(file) }
  } else {
    throw new Error('Format non pris en charge. Utilise un PDF, un DOCX, un XLSX, un fichier texte ou une image.')
  }

  const text = result.text.trim()
  if ((!text && !result.pageImages?.length) || text.includes('\0')) throw new Error('Aucun contenu lisible.')
  if (text.length > textLimit) throw new Error('Les pièces jointes contiennent trop de texte. Essaie avec un extrait.')
  return { ...result, id: crypto.randomUUID(), name: file.name, format: (format || extension || 'texte').toUpperCase(), text }
}

export async function readAttachments(files, current, signal) {
  const imageFiles = files.filter(file => file.type.startsWith('image/'))
  const documentFiles = files.filter(file => !file.type.startsWith('image/'))
  let slots = imageSlots(current) - imageFiles.length
  if (slots < 0) throw new Error(`Jusqu’à ${maxImages} images ou pages scannées par message.`)
  if (current.documents.length + documentFiles.length > maxDocuments) {
    throw new Error(`Jusqu’à ${maxDocuments} documents par message.`)
  }
  const images = [...current.images, ...await readImages(imageFiles)]
  const documents = [...current.documents]
  let textLimit = maxDocumentText - documents.reduce((length, file) => length + file.text.length, 0)
  for (const file of documentFiles) {
    signal.throwIfAborted()
    try {
      const parsed = await readDocument(file, slots, textLimit, signal)
      documents.push(parsed)
      slots -= parsed.pageImages?.length || 0
      textLimit -= parsed.text.length
    } catch (error) {
      throw new Error(`${file.name} — ${error.message || 'Impossible de lire le fichier.'}`, { cause: error })
    }
  }
  return { images, documents }
}
