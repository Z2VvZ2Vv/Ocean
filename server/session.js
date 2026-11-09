import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose'

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
const sessionCookie = 'ocean_session'
export const nonceCookie = 'ocean_login'
const sessionSeconds = 7 * 24 * 60 * 60

export function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(data))
}

export function sameOrigin(req) {
  const host = req.headers.host
  const scheme = process.env.VERCEL || req.socket.encrypted ? 'https' : 'http'
  return req.headers.origin === `${scheme}://${host}`
    && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin')
}

export function readCookie(req, name) {
  return req.headers.cookie?.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
}

export function cookie(req, name, value, age) {
  const secure = process.env.VERCEL || req.socket.encrypted ? '; Secure' : ''
  return `${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Strict${secure}`
}

export async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON requis.')
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  let data = ''
  for await (const chunk of req) {
    data += chunk.toString()
    if (data.length > 16384) throw new Error('Requête trop volumineuse.')
  }
  return JSON.parse(data)
}

function secret() {
  return new TextEncoder().encode(process.env.SESSION_SECRET || '')
}

export function authConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && secret().length >= 32)
}

export function searchConfigured() {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY)
}

function allowed(email) {
  const emails = (process.env.ALLOWED_GOOGLE_EMAILS || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean)
  return !emails.length || emails.includes(email.toLowerCase())
}

export async function verifyGoogle(credential, nonce) {
  const { payload } = await jwtVerify(credential, googleKeys, {
    audience: process.env.GOOGLE_CLIENT_ID,
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat'],
    maxTokenAge: '5m',
    clockTolerance: '10s',
  })
  if (payload.nonce !== nonce || typeof payload.email !== 'string' || !payload.email_verified || !allowed(payload.email)) {
    throw new Error('Compte Google non autorisé ou connexion expirée.')
  }
  const { sub: id, name, email, picture } = payload
  const avatar = typeof picture === 'string' && /^https:\/\/lh\d+\.googleusercontent\.com\//.test(picture) ? picture : ''
  return { id, name: typeof name === 'string' ? name : email, email, avatar }
}

export async function startSession(req, res, user) {
  const token = await new SignJWT({ user }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer('ocean').setIssuedAt().setExpirationTime(`${sessionSeconds}s`).sign(secret())
  res.setHeader('Set-Cookie', [cookie(req, sessionCookie, token, sessionSeconds), cookie(req, nonceCookie, '', 0)])
}

export async function currentUser(req) {
  const token = readCookie(req, sessionCookie)
  if (!token || !authConfigured()) return null
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: 'ocean', algorithms: ['HS256'], requiredClaims: ['exp'],
    })
    return allowed(payload.user.email) ? payload.user : null
  } catch {
    return null
  }
}

export function endSession(req, res) {
  res.setHeader('Set-Cookie', [cookie(req, sessionCookie, '', 0), cookie(req, nonceCookie, '', 0)])
}
