import { codeLanguage, validatePackages, validateProgram } from '../src/code.js'
import { codeSandboxConfigured, currentUser, json, readJson, sameOrigin } from '../server/session.js'

const activeUsers = new Set()

export default async function execute(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée.' })
  const user = sameOrigin(req) && await currentUser(req)
  if (!user) return json(res, 401, { error: 'Connecte-toi pour exécuter du code.' })
  if (!codeSandboxConfigured()) return json(res, 503, { error: 'La sandbox Vercel est désactivée.' })

  let program
  try {
    const { language, code, stdin = '', packages = [] } = await readJson(req, 128000)
    const target = codeLanguage(language)
    if (!target) throw new Error('Langage indisponible dans cette sandbox.')
    validateProgram(code, stdin)
    const dependencies = validatePackages(packages)
    if (target.id !== 'python' && dependencies.length) throw new Error('Les paquets PyPI sont réservés à Python.')
    program = { language: target.id, code, stdin, packages: dependencies }
  } catch (error) {
    return json(res, 400, { error: error.message || 'Programme invalide.' })
  }

  if (activeUsers.has(user.id)) return json(res, 429, { error: 'Attends la fin de l’exécution en cours.' })
  activeUsers.add(user.id)
  const controller = new AbortController()
  res.once('close', () => controller.abort())
  try {
    const { runSandboxCode } = await import('../server/sandbox.js')
    const result = await runSandboxCode(program, controller.signal)
    if (!controller.signal.aborted) return json(res, 200, result)
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error('Vercel Sandbox:', error.name, error.status ?? error.statusCode ?? '')
      return json(res, 502, { error: 'La sandbox Vercel a interrompu l’exécution. Vérifie son accès et réessaie.' })
    }
  } finally {
    activeUsers.delete(user.id)
  }
}
