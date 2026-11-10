import { cloudFileLimit, cloudRunTimeout, codeLanguage, codeStreamType, inputFilename, validatePackages, validateProgram } from '../src/code.js'
import { codeSandboxConfigured, currentUser, json, readJson, sameOrigin } from '../server/session.js'

const activeUsers = new Set()

function decodeFiles(files) {
  if (!Array.isArray(files) || files.length > 32) throw new Error('Sélection de fichiers invalide.')
  let size = 0
  const names = new Set()
  return files.map(file => {
    if (typeof file?.name !== 'string' || !inputFilename.test(file.name) || names.has(file.name)) throw new Error('Nom de fichier invalide.')
    if (typeof file.data !== 'string' || file.data.length > 4 * Math.ceil(cloudFileLimit / 3) ||
      file.data.length % 4 !== 0 || /[^a-z0-9+/=]/i.test(file.data)) throw new Error('Contenu de fichier invalide.')
    const content = Buffer.from(file.data, 'base64')
    if (content.toString('base64') !== file.data) throw new Error('Contenu de fichier invalide.')
    size += content.length
    if (size > cloudFileLimit) throw new Error('Les fichiers sélectionnés dépassent 2,5 Mo.')
    names.add(file.name)
    return { path: `attachments/${file.name}`, content }
  })
}

export default async function execute(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée.' })
  const user = sameOrigin(req) && await currentUser(req)
  if (!user) return json(res, 401, { error: 'Connecte-toi pour exécuter du code.' })
  if (!codeSandboxConfigured()) return json(res, 503, { error: 'La sandbox Vercel est désactivée.' })

  let program
  try {
    const { language, code, stdin = '', packages = [], files = [] } = await readJson(req, 3600000)
    const target = codeLanguage(language)
    if (!target) throw new Error('Langage indisponible dans cette sandbox.')
    validateProgram(code, stdin)
    const dependencies = validatePackages(packages)
    const inputs = decodeFiles(files)
    if (target.id !== 'python' && (dependencies.length || inputs.length)) throw new Error('Les pièces jointes et les paquets PyPI sont réservés à Python.')
    program = { language: target.id, code, stdin, packages: dependencies, files: inputs }
  } catch (error) {
    return json(res, 400, { error: error.message || 'Programme invalide.' })
  }

  if (activeUsers.has(user.id)) return json(res, 429, { error: 'Attends la fin de l’exécution en cours.' })
  activeUsers.add(user.id)
  const controller = new AbortController()
  const deadline = AbortSignal.timeout(cloudRunTimeout - 10000)
  const signal = AbortSignal.any([controller.signal, deadline])
  const streaming = req.headers.accept?.includes(codeStreamType)
  const close = () => controller.abort()
  res.once('close', close)
  function finish(status, result) {
    if (controller.signal.aborted || res.destroyed) return
    if (streaming) return res.end(`${JSON.stringify({ result })}\n`)
    return json(res, status, result)
  }
  function onProgress(phase) {
    if (streaming && !signal.aborted && !res.destroyed) res.write(`${JSON.stringify({ phase })}\n`)
  }
  try {
    if (streaming) res.writeHead(200, { 'Content-Type': `${codeStreamType}; charset=utf-8`, 'Cache-Control': 'no-store, no-transform' })
    const { runSandboxCode } = await import('../server/sandbox.js')
    const result = await runSandboxCode(program, signal, { onProgress })
    signal.throwIfAborted()
    return finish(200, result)
  } catch (error) {
    if (controller.signal.aborted) return
    if (deadline.aborted) return finish(504, { error: 'La sandbox Vercel a dépassé le délai de préparation ou d’exécution.' })
    console.error('Vercel Sandbox:', error.name, error.status ?? error.statusCode ?? '')
    return finish(502, { error: 'La sandbox Vercel a interrompu l’exécution. Vérifie son accès et réessaie.' })
  } finally {
    res.removeListener('close', close)
    activeUsers.delete(user.id)
  }
}
