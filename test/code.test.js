import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { runSandboxCode } from '../server/sandbox.js'
import { runCode } from '../src/code.js'

test('une dépendance Python part dans la sandbox et les fichiers reviennent au navigateur', async ({ mock }) => {
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/code')
    assert.deepEqual(JSON.parse(options.body), {
      language: 'python', code: 'import seaborn', stdin: '', packages: ['seaborn'],
    })
    return Response.json({ artifacts: [
      { name: 'tracé.png', data: 'cG5n' },
      { name: '../fichier.html', data: 'aHRtbA==' },
    ] })
  })
  const signal = new AbortController().signal
  const result = await runCode({ language: 'py', code: 'import seaborn', packages: ['seaborn'] }, true, signal)
  assert.deepEqual(result.artifacts, [{ name: 'tracé.png', mime: 'image/png', url: 'data:image/png;base64,cG5n' }])
  await assert.rejects(runCode({ language: 'python', code: 'print(1)', packages: ['https://example.org/fichier.whl'] }, true, signal), /paquets PyPI/)
})

test('les paquets sont installés avant l’envoi du code et la sandbox est supprimée après lecture', async () => {
  const signal = new AbortController().signal
  const order = []
  const files = new Map([
    ['.ocean-output', '42\n'], ['.ocean-files', 'artifacts/table.csv\0artifacts/../secret.csv\0./plot.png\0'],
    ['artifacts/table.csv', 'n\n42\n'], ['./plot.png', 'png'],
  ])
  const sandbox = {
    async runCommand({ cmd, args }) {
      order.push(cmd)
      if (cmd === 'python3') assert.deepEqual(args.slice(-2), ['--', 'seaborn'])
      return { exitCode: 0 }
    },
    async update(options) {
      order.push('verrouillage')
      assert.deepEqual(options, { networkPolicy: 'deny-all' })
    },
    async writeFiles(input) {
      order.push('programme')
      assert.deepEqual(input, [{ path: 'main.py', content: 'import seaborn' }, { path: '.ocean-stdin', content: '42' }])
    },
    async readFile({ path }) {
      assert.ok(files.has(path), `Lecture inattendue : ${path}`)
      return Readable.from([Buffer.from(files.get(path))])
    },
    async delete() { order.push('suppression') },
  }
  const result = await runSandboxCode({ language: 'python', code: 'import seaborn', stdin: '42', packages: ['seaborn'] }, signal, async options => {
    assert.deepEqual(options.networkPolicy, { allow: ['pypi.org', 'files.pythonhosted.org'] })
    return sandbox
  })
  assert.deepEqual(order, ['python3', 'verrouillage', 'mkdir', 'programme', 'bash', 'bash', 'suppression'])
  assert.equal(result.output, '42\n')
  assert.deepEqual(result.artifacts.map(file => file.name), ['table.csv', 'plot.png'])
})
