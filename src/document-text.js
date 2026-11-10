const textFormats = new Set('txt md markdown csv tsv json jsonl xml yaml yml log ini sql py js ts jsx tsx html css java c cpp h hpp rs go sh ps1 tex'.split(' '))
export const textChunkSize = 12000

export function isTextDocument(blob, format) {
  return blob.type.startsWith('text/') || textFormats.has(format)
}

export async function readTextChunk(blob, offset, signal, limit = textChunkSize) {
  signal.throwIfAborted()
  limit = Math.max(4, limit)
  const prefix = new Uint8Array(await blob.slice(0, 3).arrayBuffer())
  const encoding = prefix[0] === 0xff && prefix[1] === 0xfe ? 'utf-16le'
    : prefix[0] === 0xfe && prefix[1] === 0xff ? 'utf-16be' : 'utf-8'
  if (encoding !== 'utf-8' && offset % 2 !== 0) throw new Error('Utilise next_offset pour poursuivre la lecture du texte.')
  const bytes = new Uint8Array(await blob.slice(offset, offset + limit + 3).arrayBuffer())
  signal.throwIfAborted()
  let length = Math.min(bytes.length, limit)
  if (encoding === 'utf-8' && bytes.length > length) {
    const boundary = length
    while (length > 0 && (bytes[length] & 0xc0) === 0x80) length--
    if (!length) length = boundary
  }
  if (encoding !== 'utf-8' && bytes.length > length) {
    length -= length % 2
    const last = new DataView(bytes.buffer).getUint16(length - 2, encoding === 'utf-16le')
    if (last >= 0xd800 && last <= 0xdbff) length -= 2
  }
  const content = bytes.subarray(0, length)
  let text
  try { text = new TextDecoder(encoding, { fatal: true }).decode(content) }
  catch { text = new TextDecoder(encoding === 'utf-8' ? 'windows-1252' : encoding).decode(content) }
  if (text.includes('\0')) throw new Error('Le fichier semble binaire. Passe-le à Python pour l’analyser.')
  const end = offset + length
  return { text, ...(end < blob.size && { next_offset: end }), offset_unit: 'bytes' }
}

export async function checkOfficeArchive(blob, signal, inspect) {
  signal.throwIfAborted()
  const { checkArchiveSize } = await import('./archive.js')
  await checkArchiveSize(blob, signal, 32 * 1024 * 1024, 2048, inspect)
  signal.throwIfAborted()
}

export async function readDocxText(blob, signal) {
  await checkOfficeArchive(blob, signal)
  const { default: mammoth } = await import('mammoth')
  const arrayBuffer = await blob.arrayBuffer()
  signal.throwIfAborted()
  const { value } = await mammoth.extractRawText({ arrayBuffer })
  signal.throwIfAborted()
  return value
}

export async function readWorkbookSheets(blob, signal) {
  // The spreadsheet reader fills every gap up to the last populated cell.
  // Check the matrix size before a small sparse XML file can allocate a huge array.
  const parser = typeof DOMParser === 'undefined' ? null : new DOMParser()
  let cells = 0
  await checkOfficeArchive(blob, signal, parser && (async (name, readXml) => {
    if (!name.endsWith('.xml') && !name.endsWith('.xml.rels')) return
    const xml = await readXml()
    if (!xml.includes('sheetData')) return
    const document = parser.parseFromString(xml, 'application/xml')
    if (document.documentElement.localName === 'parsererror') throw new Error('Une feuille Excel est illisible.')
    for (const data of document.getElementsByTagNameNS('*', 'sheetData')) {
      const { rows, columns } = worksheetSize(data)
      cells += rows * columns
      if (rows > 50000 || cells > 1_000_000) throw new Error('Ce classeur dépasse la taille de lecture du navigateur. Ouvre le fichier dans Excel ou utilise Python pour le traiter par plages.')
    }
  }))
  const { default: readWorkbook } = await import('read-excel-file/browser')
  signal.throwIfAborted()
  const sheets = await readWorkbook(blob)
  signal.throwIfAborted()
  return sheets
}

function worksheetSize(data) {
  let rows = 0
  let columns = 0
  function address(node) {
    return [...node.attributes].find(attribute => attribute.localName === 'r')?.value
  }
  for (const row of data.getElementsByTagNameNS('*', 'row')) {
    const index = address(row)
    rows = Math.max(rows + 1, index ? Number(index) : 0)
    if (!Number.isSafeInteger(rows)) throw new Error('Numéro de ligne Excel invalide.')
  }
  for (const cell of data.getElementsByTagNameNS('*', 'c')) {
    const ref = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(address(cell))
    if (!ref) throw new Error('Adresse de cellule Excel invalide.')
    rows = Math.max(rows, Number(ref[2]))
    let column = 0
    for (const letter of ref[1]) column = column * 26 + letter.charCodeAt(0) - 64
    columns = Math.max(columns, column)
  }
  return { rows, columns }
}

export async function readOfficeText(blob, format, signal) {
  if (format === 'docx') return readDocxText(blob, signal)
  const sheets = await readWorkbookSheets(blob, signal)
  return sheets.filter(sheet => sheet.data.length).map(({ sheet, data }) => (
    [`Feuille ${JSON.stringify(sheet)}`, ...data.map(row => JSON.stringify(row))].join('\n')
  )).join('\n\n')
}
