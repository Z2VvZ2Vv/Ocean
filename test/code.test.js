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
      files: [{ name: '1-table.csv', data: 'NDI=' }],
    })
    return Response.json({ artifacts: [
      { name: 'tracé.png', data: 'cG5n' },
      { name: 'archive.zip', data: 'emlw' },
      { name: '../fichier.html', data: 'aHRtbA==' },
    ] })
  })
  const signal = new AbortController().signal
  const result = await runCode({ language: 'py', code: 'import seaborn', packages: ['seaborn'],
    files: [{ name: '1-table.csv', blob: new Blob(['42']) }] }, true, signal)
  assert.deepEqual(result.artifacts, [
    { name: 'tracé.png', mime: 'image/png', url: 'data:image/png;base64,cG5n' },
    { name: 'archive.zip', mime: 'application/zip', url: 'data:application/zip;base64,emlw' },
  ])
  await assert.rejects(runCode({ language: 'python', code: 'print(1)', packages: ['https://example.org/fichier.whl'] }, true, signal), /paquets PyPI/)
})

test('les paquets sont installés avant l’envoi du code et la sandbox est supprimée après lecture', async () => {
  const signal = new AbortController().signal
  const order = []
  const progress = []
  const attachedFile = { path: 'attachments/1-table.csv', content: Buffer.from('42') }
  const files = new Map([
    ['.ocean-output', '42\n'], ['.ocean-files', 'artifacts/table.csv\0artifacts/../secret.csv\0./plot.png\0artifacts/plot.zip\0'],
    ['artifacts/table.csv', 'n\n42\n'], ['./plot.png', 'png'], ['artifacts/plot.zip', 'zip'],
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
      assert.deepEqual(input, [{ path: 'main.py', content: 'import seaborn' }, { path: '.ocean-stdin', content: '42' }, attachedFile])
    },
    async readFile({ path }) {
      assert.ok(files.has(path), `Lecture inattendue : ${path}`)
      return Readable.from([Buffer.from(files.get(path))])
    },
    async delete() { order.push('suppression') },
  }
  const result = await runSandboxCode({ language: 'python', code: 'import seaborn', stdin: '42', packages: ['seaborn'], files: [attachedFile] }, signal, {
    onProgress: phase => progress.push(phase),
    createSandbox: async options => {
      assert.deepEqual(options.networkPolicy, { allow: ['pypi.org', 'files.pythonhosted.org'] })
      return sandbox
    },
  })
  assert.deepEqual(order, ['python3', 'verrouillage', 'mkdir', 'programme', 'bash', 'bash', 'suppression'])
  assert.deepEqual(progress, ['opening', 'setup', 'running', 'reading'])
  assert.equal(result.output, '42\n')
  assert.deepEqual(result.artifacts.map(file => file.name), ['table.csv', 'plot.png', 'plot.zip'])
})

test('le client affiche les étapes de compilation et accepte un résultat découpé en plusieurs fragments', async ({ mock }) => {
  mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.Accept, 'application/x-ndjson')
    assert.equal(JSON.parse(options.body).stdin, '7 5')
    const encoder = new TextEncoder()
    return new Response(new ReadableStream({
      start(controller) {
        for (const part of ['{"phase":"compil', 'ing"}\n{"phase":"running"}\n', '{"result":{"output":"12"}}\n']) {
          controller.enqueue(encoder.encode(part))
        }
        controller.close()
      },
    }), { headers: { 'Content-Type': 'application/x-ndjson' } })
  })
  const phases = []
  const result = await runCode({ language: 'cpp', code: 'int main() {}', stdin: '7 5' }, true, new AbortController().signal, phase => phases.push(phase))
  assert.deepEqual(phases, ['opening', 'compiling', 'running'])
  assert.equal(result.output, '12')
})
