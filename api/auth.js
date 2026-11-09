import { randomBytes } from 'node:crypto'
import {
  authConfigured, cookie, currentUser, endSession, json, nonceCookie, readCookie,
  readJson, sameOrigin, searchConfigured, startSession, verifyGoogle,
} from '../server/session.js'

export default async function auth(req, res) {
  if (req.method === 'GET') {
    const user = await currentUser(req)
    if (user) return json(res, 200, { user, search: searchConfigured() })
    if (!authConfigured()) return json(res, 200, { clientId: null })
    const existingNonce = readCookie(req, nonceCookie)
    const nonce = /^[A-Za-z0-9_-]{32}$/.test(existingNonce || '') ? existingNonce : randomBytes(24).toString('base64url')
    res.setHeader('Set-Cookie', cookie(req, nonceCookie, nonce, 600))
    return json(res, 200, { clientId: process.env.GOOGLE_CLIENT_ID, nonce })
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée.' })
  if (!sameOrigin(req)) return json(res, 403, { error: 'Origine non autorisée.' })
  try {
    const { action, credential } = await readJson(req)
    if (action === 'logout') {
      endSession(req, res)
      return json(res, 200, {})
    }
    const nonce = readCookie(req, nonceCookie)
    if (!authConfigured() || !nonce || typeof credential !== 'string' || credential.length > 8192) {
      return json(res, 400, { error: 'Connexion Google indisponible ou expirée. Recharge la page.' })
    }
    const user = await verifyGoogle(credential, nonce)
    await startSession(req, res, user)
    return json(res, 200, { user, search: searchConfigured() })
  } catch {
    return json(res, 401, { error: 'La connexion Google a été refusée ou a expiré. Recharge la page pour réessayer.' })
  }
}
