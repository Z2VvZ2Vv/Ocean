import { attachmentFormat } from './attachments.js'
import { checkOfficeArchive, isTextDocument, readTextChunk, readWorkbookSheets } from './document-text.js'

const safeRaster = /^(png|jpe?g|gif|webp|avif|bmp)$/i
const maxRows = 100
const maxColumns = 24
const maxText = 40000
const sizeNumber = new Intl.NumberFormat('fr', { maximumFractionDigits: 1 })

export function embeddedFileUrl(file) {
  return typeof file.url === 'string' && /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(file.url) ? file.url : null
}

export function previewFormat(file) {
  const mime = file.mime || file.blob?.type || embeddedFileUrl(file)?.split(/[;:]/, 2)[1]
  const format = attachmentFormat(file.name, mime)
  if (safeRaster.test(format) || /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(mime || '')) return 'image'
  if (['pdf', 'zip', 'docx', 'xlsx', 'csv', 'tsv', 'md', 'markdown'].includes(format)) return format
  if (isTextDocument({ type: mime || '' }, format)) return 'text'
  return format
}

export function canOpenFile(file) {
  return Boolean(file.blob || embeddedFileUrl(file) || file.text || file.pageImages?.length)
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes >= 1048576) return `${sizeNumber.format(bytes / 1048576)} Mio`
  if (bytes >= 1024) return `${sizeNumber.format(bytes / 1024)} Kio`
  return `${sizeNumber.format(bytes)} octets`
}

function guessDelimiter(text) {
  const counts = new Map([[',', 0], [';', 0], ['\t', 0]])
  let quoted = false
  for (const char of text) {
    if (char === '"') quoted = !quoted
    if (quoted) continue
    if (char === '\r' || char === '\n') break
    if (counts.has(char)) counts.set(char, counts.get(char) + 1)
  }
  return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))[0]
}

export function parseTablePreview(text, format) {
  const content = text.replace(/^\uFEFF/, '')
  const directive = /^sep=([,;\t])(?:\r\n|\r|\n)/i.exec(content)
  const source = directive ? content.slice(directive[0].length) : content
  const separator = format === 'tsv' ? '\t' : directive?.[1] || guessDelimiter(source)
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  let truncated = false

  function pushCell() {
    if (row.length < maxColumns) row.push(value)
    else truncated = true
    value = ''
  }

  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quoted) {
      if (char !== '"') value += char
      else if (source[index + 1] === '"') {
        value += '"'
        index++
      } else quoted = false
    } else if (char === '"' && !value) quoted = true
    else if (char === separator) pushCell()
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index++
      pushCell()
      rows.push(row)
      row = []
      if (rows.length >= maxRows && index + 1 < source.length) return { rows, truncated: true }
    } else value += char
  }
  if (row.length || value || source.endsWith('"')) {
    pushCell()
    rows.push(row)
  }
  return { rows, truncated }
}

export async function readFilePreview(blob, format, signal) {
  if (format === 'pdf') {
    const { loadPdf } = await import('./pdf.js')
    return { kind: 'pdf', ...await loadPdf(blob, signal) }
  }
  if (format === 'zip') return { kind: 'zip' }
  if (format === 'image') return { kind: 'image' }
  if (!['docx', 'xlsx', 'csv', 'tsv', 'md', 'markdown', 'text'].includes(format)) return { kind: 'unsupported' }
  if (format === 'docx') {
    await checkOfficeArchive(blob, signal)
    const { default: mammoth } = await import('mammoth')
    let remainingImageBytes = 4 * 1024 * 1024
    const urls = []
    const convertImage = mammoth.images.imgElement(async image => {
      const mime = image.contentType?.toLowerCase() || ''
      if (!/^image\/(png|jpeg|gif|webp)$/.test(mime) || remainingImageBytes <= 0) return {}
      const bytes = await image.readAsArrayBuffer()
      signal.throwIfAborted()
      remainingImageBytes -= bytes.byteLength
      if (remainingImageBytes < 0) return {}
      const src = URL.createObjectURL(new Blob([bytes], { type: mime }))
      urls.push(src)
      return { src }
    })
    try {
      const arrayBuffer = await blob.arrayBuffer()
      signal.throwIfAborted()
      const { value } = await mammoth.convertToHtml({ arrayBuffer }, {
        convertImage, styleMap: ["r[style-name='Ocean Code'] => code", "p[style-name='Ocean Code Block'] => pre"],
      })
      signal.throwIfAborted()
      const template = document.createElement('template')
      template.innerHTML = value
      return { kind: 'document', content: template.content, urls }
    } catch (error) {
      urls.forEach(url => URL.revokeObjectURL(url))
      throw error
    }
  }
  if (format === 'xlsx') {
    const sheets = await readWorkbookSheets(blob, signal)
    return { kind: 'table', sheets: sheets.map(({ sheet, data }) => ({
      sheet,
      rows: data.slice(0, maxRows).map(row => row.slice(0, maxColumns)),
      truncated: data.length > maxRows || data.some(row => row.length > maxColumns),
    })) }
  }
  const { text, next_offset } = await readTextChunk(blob, 0, signal, maxText)
  if (format === 'csv' || format === 'tsv') {
    const { rows, truncated } = parseTablePreview(text, format)
    return { kind: 'table', sheets: [{ rows, truncated: truncated || Boolean(next_offset) }] }
  }
  return { kind: 'text', text, truncated: Boolean(next_offset) }
}
