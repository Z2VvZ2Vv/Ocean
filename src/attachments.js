import { canInlineImage, readImages } from './clipboard.js'

const formats = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}

export function attachmentFormat(name, mime) {
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return formats[mime] || extension || (mime?.startsWith('text/') ? 'txt' : 'fichier')
}

export async function readAttachments(files, current, signal) {
  const images = [...current.images]
  const documents = [...current.documents]
  for (const file of files) {
    signal.throwIfAborted()
    if (canInlineImage(file)) {
      const [image] = await readImages([file])
      images.push(image)
    } else {
      documents.push({
        id: crypto.randomUUID(), name: file.name, size: file.size, mime: file.type,
        format: attachmentFormat(file.name, file.type).toUpperCase(), blob: file,
      })
    }
  }
  signal.throwIfAborted()
  return { images, documents }
}
