export function cleanChatTitle(text) {
  const title = text.split(/\r?\n/).find(line => line.trim())?.trim()
    .replace(/^(?:titre\s*[:：]\s*|#{1,6}\s*)/i, '').replace(/^["'«“`*]+|["'»”`*.]+$/g, '').trim() || ''
  if (title.length <= 58) return title
  return title.slice(0, 58).replace(/\s+\S*$/, '').trim() || title.slice(0, 58)
}

export function initialChatTitle(text, documents = []) {
  const source = text || documents[0]?.name.replace(/[_-]+/g, ' ') || 'Capture d’écran'
  return cleanChatTitle(source.replace(/^(?:bonjour[,.!]?\s*|salut[,.!]?\s*|est-ce que tu peux\s+|peux-tu\s+|pourrais-tu\s+|s’il te plaît[, ]*|s'il te plait[, ]*)/i, '').replace(/\s+/g, ' ')) || 'Nouvelle discussion'
}
