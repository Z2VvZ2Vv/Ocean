import { artifactFromBytes, artifactType } from './code.js'

const tableFormats = new Set(['csv', 'tsv', 'xlsx'])
const textFormats = new Set(['docx', 'json', 'md', 'txt'])
const invalidXmlText = /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/u

function validateRows(rows, spreadsheetFormat) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) {
    throw new Error('Fournis de 1 à 500 lignes dans rows.')
  }
  let characters = 0
  for (const row of rows) {
    if (!Array.isArray(row) || !row.length || row.length > 40) throw new Error('Chaque ligne doit contenir de 1 à 40 cellules.')
    for (const cell of row) {
      if (cell !== null && typeof cell !== 'string' && typeof cell !== 'boolean' && !Number.isFinite(cell)) {
        throw new Error('Une cellule doit contenir du texte, un nombre, un booléen ou null.')
      }
      if (spreadsheetFormat && typeof cell === 'string' && (cell.length > 32767 || invalidXmlText.test(cell))) {
        throw new Error('Une cellule Excel dépasse 32 767 caractères ou contient un caractère de contrôle invalide.')
      }
      characters += String(cell ?? '').length
      if (characters > 100000) throw new Error('Le tableau dépasse 100 000 caractères.')
    }
  }
}

function delimitedText(rows, delimiter) {
  const lines = rows.map(row => row.map(cell => {
    let value = String(cell ?? '')
    if (typeof cell === 'string' && /^\s*[=+\-@\t\r\n＝＋－＠]/u.test(value)) value = `'${value}`
    return `"${value.replaceAll('"', '""')}"`
  }).join(delimiter))
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}

async function spreadsheet(rows, header) {
  const { default: writeExcelFile } = await import('write-excel-file/universal')
  const widths = []
  const cells = rows.map((row, index) => row.map((value, column) => {
    widths[column] = Math.min(45, Math.max(widths[column] || 12, String(value ?? '').length + 3))
    return value === null ? null : {
      value, wrap: true,
      ...(header && index === 0 && { fontWeight: 'bold', backgroundColor: '#DCE9F8' }),
    }
  }))
  return writeExcelFile(cells, {
    sheet: 'Données', columns: widths.map(width => ({ width })), stickyRowsCount: header ? 1 : 0,
  }).toBlob()
}

async function wordDocument(content) {
  const [docx, { unified }, { default: remarkParse }, { default: remarkGfm }, { default: remarkMath }] = await Promise.all([
    import('docx'), import('unified'), import('remark-parse'), import('remark-gfm'), import('remark-math'),
  ])
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType } = docx
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(content)

  function inline(node, style = {}) {
    switch (node.type) {
      case 'text': return [new TextRun({ ...style, text: node.value.replace(/\n/g, ' ') })]
      case 'inlineCode': return [new TextRun({ ...style, text: node.value, style: 'OceanCode' })]
      case 'inlineMath': return [new TextRun({ ...style, text: content.slice(node.position.start.offset, node.position.end.offset) })]
      case 'strong': return node.children.flatMap(child => inline(child, { ...style, bold: true }))
      case 'emphasis': return node.children.flatMap(child => inline(child, { ...style, italics: true }))
      case 'delete': return node.children.flatMap(child => inline(child, { ...style, strike: true }))
      case 'break': return [new TextRun({ ...style, break: 1 })]
      case 'image': return [new TextRun({ ...style, text: node.alt || '' })]
      default: return (node.children || []).flatMap(child => inline(child, style))
    }
  }

  function block(node, options = {}) {
    switch (node.type) {
      case 'heading': return [new Paragraph({ heading: HeadingLevel[`HEADING_${node.depth}`], children: inline(node) })]
      case 'paragraph': {
        const { prefix, depth = 0, quoted = false } = options
        return [new Paragraph({
          indent: { left: 360 * depth }, spacing: { after: 120 },
          children: [...(prefix ? [new TextRun(prefix)] : []), ...inline(node, { italics: quoted })],
        })]
      }
      case 'list': return node.children.flatMap((item, index) => item.children.flatMap((child, part) => block(child, {
        ...options, depth: (options.depth || 0) + 1,
        prefix: part === 0 ? (node.ordered ? `${(node.start ?? 1) + index}. ` : '• ') : '',
      })))
      case 'blockquote': return node.children.flatMap(child => block(child, { depth: (options.depth || 0) + 1, quoted: true }))
      case 'code': return node.value.split('\n').map(text => new Paragraph({ style: 'OceanCodeBlock', children: [new TextRun({ text, font: 'Consolas' })] }))
      case 'math': return [new Paragraph({ children: [new TextRun(`$$${node.value}$$`)] })]
      case 'table': return [new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: node.children.map((row, index) => new TableRow({
          ...(index === 0 && { tableHeader: true }),
          children: row.children.map(cell => new TableCell({
            ...(index === 0 && { shading: { fill: 'DCE9F8' } }),
            children: [new Paragraph({ children: inline(cell, { bold: index === 0 }) })],
          })),
        })),
      })]
      default: return []
    }
  }

  const children = tree.children.flatMap(node => block(node))
  if (!children.length) throw new Error('Le document doit contenir au moins un titre, un paragraphe, une liste ou un tableau.')
  return Packer.toBlob(new Document({
    styles: {
      characterStyles: [{ id: 'OceanCode', name: 'Ocean Code', basedOn: 'DefaultParagraphFont', run: { font: 'Consolas' } }],
      paragraphStyles: [{ id: 'OceanCodeBlock', name: 'Ocean Code Block', basedOn: 'Normal', run: { font: 'Consolas' } }],
    },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 } } }, children }],
  }))
}

export async function createFile({ name, content, rows, header = true }, signal) {
  signal.throwIfAborted()
  if (!artifactType(name)) throw new Error('Donne un nom de fichier valide avec son extension.')
  const format = name.split('.').at(-1).toLowerCase()
  let blob
  if (tableFormats.has(format)) {
    validateRows(rows, format === 'xlsx')
    if (format === 'xlsx') blob = await spreadsheet(rows, header)
    else blob = new Blob([delimitedText(rows, format === 'csv' ? ',' : '\t')])
  } else if (textFormats.has(format)) {
    if (typeof content !== 'string' || !content.trim() || content.length > 100000) {
      throw new Error('Fournis le contenu du fichier dans content (100 000 caractères maximum).')
    }
    if (format === 'json') {
      try { JSON.parse(content) }
      catch { throw new Error('Le contenu doit être un JSON valide.') }
    }
    if (format === 'docx' && invalidXmlText.test(content)) throw new Error('Le texte contient un caractère de contrôle incompatible avec Word.')
    blob = format === 'docx' ? await wordDocument(content) : new Blob([content])
  } else {
    throw new Error('Utilise une extension DOCX, XLSX, CSV, TSV, MD, TXT ou JSON.')
  }
  signal.throwIfAborted()
  const file = artifactFromBytes(name, new Uint8Array(await blob.arrayBuffer()))
  signal.throwIfAborted()
  return { artifacts: [file] }
}
