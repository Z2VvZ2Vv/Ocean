import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { Sandbox } from '@vercel/sandbox'
import execute from '../api/code.js'
import { startSession } from '../server/session.js'

class Reply extends EventEmitter {
  chunks = []

  writeHead(status) { this.status = status }
  write(chunk) {
    this.chunks.push(chunk)
    this.emit('data', JSON.parse(chunk))
  }
  end(chunk) { this.write(chunk) }
}

test('une console transmet deux réponses au même programme et refuse un autre compte', { timeout: 10000 }, async context => {
  const env = { SESSION_SECRET: 'test-secret-with-at-least-32-bytes', GOOGLE_CLIENT_ID: 'test-google-client',
    ALLOWED_GOOGLE_EMAILS: 'one@example.com,two@example.com', OCEAN_CODE_SANDBOX: '1' }
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name]
    process.env[name] = value
    context.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous })
  }
  const host = 'ocean.example'
  const base = { method: 'POST', socket: {}, headers: { host, origin: `${process.env.VERCEL ? 'https' : 'http'}://${host}`,
    'content-type': 'application/json' } }
  async function account(id) {
    let cookie
    await startSession(base, { setHeader: (_name, values) => { cookie = values[0].split(';')[0] } }, { id, email: `${id}@example.com` })
    return { ...base, headers: { ...base.headers, cookie } }
  }
  const owner = await account('one')
  const other = await account('two')
  const first = Promise.withResolvers()
  const second = Promise.withResolvers()
  const stdin = []
  const command = {
    cmdId: 'cpp-command',
    async *logs() {
      yield { stream: 'stdout', data: '{"output":"Première valeur ? "}\n' }
      await first.promise
      yield { stream: 'stdout', data: '{"output":"Deuxième valeur ? "}\n' }
      await second.promise
      yield { stream: 'stdout', data: '{"output":"Résultat : 12\\n"}\n' }
    },
    async wait() { await second.promise; return { exitCode: 0 } },
    async writeStdin(line) {
      stdin.push(line)
      if (stdin.length === 1) first.resolve()
      else second.resolve()
    },
  }
  const sandbox = {
    name: 'test-console',
    currentSession: () => ({ sessionId: 'current', status: 'running', getCommand: async id => {
      assert.equal(id, command.cmdId)
      return command
    } }),
    async runCommand(options) {
      if (!options.detached) return { exitCode: 0 }
      assert.equal(options.stdin, true)
      return command
    },
    async update() {}, async writeFiles() {}, async readFile() { return null }, async delete() {},
  }
  context.mock.method(Sandbox, 'create', async () => sandbox)
  context.mock.method(Sandbox, 'get', async ({ name, resume }) => {
    assert.equal(name, sandbox.name)
    assert.equal(resume, false)
    return sandbox
  })

  const session = Promise.withResolvers()
  const prompts = [Promise.withResolvers(), Promise.withResolvers()]
  const stream = new Reply()
  stream.on('data', event => {
    if (event.session) session.resolve(event.session)
    if (event.output?.startsWith('Première')) prompts[0].resolve()
    if (event.output?.startsWith('Deuxième')) prompts[1].resolve()
  })
  const running = execute({ ...owner, headers: { ...owner.headers, accept: 'application/x-ndjson' },
    body: { language: 'cpp', code: 'int main() {}', interactive: true } }, stream)
  async function send(account, line) {
    const reply = new Reply()
    await execute({ ...account, body: { action: 'input', session: await session.promise, line } }, reply)
    return reply.status
  }
  await prompts[0].promise
  assert.equal(await send(other, 'intrusion'), 403)
  assert.equal(await send(owner, '7'), 200)
  await prompts[1].promise
  assert.equal(await send(owner, '5'), 200)
  await running
  assert.deepEqual(stdin, ['7\n', '5\n'])
  assert.match(JSON.parse(stream.chunks.at(-1)).result.output, /Résultat : 12/)
})
