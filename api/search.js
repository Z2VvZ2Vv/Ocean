import { currentUser, json, readJson, sameOrigin, searchConfigured } from '../server/session.js'

export default async function search(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée.' })
  if (!sameOrigin(req) || !await currentUser(req)) return json(res, 401, { error: 'Connecte-toi pour utiliser la recherche.' })
  if (!searchConfigured()) return json(res, 503, { error: 'La recherche web est désactivée.' })

  let query
  try {
    const body = await readJson(req)
    query = typeof body?.query === 'string' ? body.query.trim() : ''
  } catch {
    return json(res, 400, { error: 'Requête invalide.' })
  }
  if (!query || query.length > 400) return json(res, 400, { error: 'Saisis une requête de 1 à 400 caractères.' })

  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.search = new URLSearchParams({ q: query, count: '5', text_decorations: 'false', result_filter: 'web' })
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return json(res, 502, { error: `La recherche Brave a échoué (HTTP ${response.status}).` })
    const data = await response.json()
    const results = (data.web?.results || []).filter(item => /^https?:\/\//i.test(item.url))
      .slice(0, 5).map(item => ({ title: item.title, url: item.url, snippet: item.description?.slice(0, 800) }))
    return json(res, 200, { results })
  } catch {
    return json(res, 502, { error: 'Impossible de joindre la recherche Brave.' })
  }
}
