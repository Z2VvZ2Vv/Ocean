const format = '(?:microsoft\\s+)?(?:word|docx)\\b'
const negative = new RegExp(`\\b(?:sans|pas|aucun|aucune|ni|no|without)\\b[^.!?;\\n]{0,36}${format}`)
const destination = new RegExp(`\\b(?:en|au format|en format|sous format|vers|to|as)\\s+(?:un(?:e)?\\s+|a\\s+)?${format}|\\bdans\\s+(?:un|une)\\s+(?:document|fichier|version)\\s+${format}`)
const creation = /\b(?:cree[rz]?|genere[rz]?|produi[st]|produire|fais|faire|donne[rz]?|fournis|redige[rz]?|ecri[st]|exporte[rz]?|converti[st]|enregistre[rz]?|veux|voudrais|souhaite|create|generate|write|make|export|save)\b/
const requestedFile = new RegExp(`(?:^|\\b(?:un|une|a|le|the)\\s+)(?:(?:document|fichier|version)\\s+)?${format}|[\\w-]\\.docx\\b`)

export function requestsWordExport(text) {
  const normalized = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const clauses = normalized.split(/[!?;\n]|\.(?=\s|$)/)
  if (clauses.some(clause => negative.test(clause))) return false
  return clauses.some(clause => {
    if (/^\s*word\s+(?:nomme|appele)\b/.test(clause)) return true
    if (new RegExp(`${format}\\s+(?:joint|en piece jointe)`).test(clause) && !destination.test(clause)) return false
    if (destination.test(clause.trim()) || new RegExp(`^\\s*(?:un\\s+)?${format}(?:\\s+(?:stp|svp|s'il te plait))?\\s*$`).test(clause)) return true
    const action = creation.exec(clause)
    if (!action) return false
    const target = clause.slice(action.index + action[0].length).trim().split(/\b(?:avec|depuis|a partir|joint|using|from)\b/)[0]
    return requestedFile.test(target)
  })
}

export function isWordFile(name) {
  return typeof name === 'string' && /\.docx$/i.test(name.trim())
}
