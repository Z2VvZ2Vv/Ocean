import katex from 'katex'

export function previewMathParts(text) {
  const parts = []
  const openings = /\$\$|\$|\\\(|\\\[/g
  let from = 0
  let match
  while ((match = openings.exec(text))) {
    const start = match.index
    if (start > 0 && text[start - 1] === '\\') continue
    const left = match[0]
    const right = left === '\\(' ? '\\)' : left === '\\[' ? '\\]' : left
    let depth = 0
    let end = -1
    for (let index = start + left.length; index < text.length; index++) {
      if (depth === 0 && text.startsWith(right, index)) { end = index; break }
      if (text[index] === '\\') index++
      else if (text[index] === '{') depth++
      else if (text[index] === '}') depth = Math.max(0, depth - 1)
    }
    if (end < 0) continue
    if (start > from) parts.push({ text: text.slice(from, start) })
    const source = text.slice(start, end + right.length)
    const formula = text.slice(start + left.length, end).trim()
    const display = left === '$$' || left === '\\['
    try {
      if (!formula || formula.length > 6000) throw new Error('Formule trop longue.')
      parts.push({ html: katex.renderToString(formula, {
        displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 400, maxSize: 20,
      }), display })
    } catch { parts.push({ text: source }) }
    from = end + right.length
    openings.lastIndex = from
  }
  if (from < text.length) parts.push({ text: text.slice(from) })
  return parts
}
