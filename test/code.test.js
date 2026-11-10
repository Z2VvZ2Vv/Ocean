import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { runSandboxCode } from '../server/sandbox.js'
import { artifactBytes, artifactFromBytes, runCode } from '../src/code.js'

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
  const listing = ['artifacts/table.xlsx', 'artifacts/../secret.csv', 'artifacts/vide.docx', 'artifacts/rapport.pdf',
    './table.xlsx', './plot.png', 'artifacts/plot.zip', './présentation.pptx', ''].join('\0')
  const files = new Map([
    ['.ocean-output', '42\n'], ['.ocean-files', listing],
    ['artifacts/table.xlsx', 'xlsx'], ['artifacts/vide.docx', ''], ['artifacts/rapport.pdf', Buffer.alloc(artifactBytes + 1)],
    ['./plot.png', 'png'], ['artifacts/plot.zip', 'zip'],
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
  assert.deepEqual(result.artifacts.map(file => file.name), ['table.xlsx', 'plot.png', 'plot.zip'])
  assert.deepEqual(result.artifactIssues, [
    { name: 'vide.docx', reason: 'empty' }, { name: 'rapport.pdf', reason: 'oversized' }, { name: 'présentation.pptx', reason: 'count' },
  ])
})

test('les documents générés conservent leur type MIME et les limites de téléchargement', async ({ mock }) => {
  const bytes = Buffer.from('fixture')
  const names = ['rapport.PDF', 'résumé.docx', 'mesures.xlsx']
  mock.method(globalThis, 'fetch', async () => Response.json({
    artifacts: [
      { name: 'rapport.PDF', data: 'invalid_base64' },
      { name: 'script.html', data: bytes.toString('base64') },
      ...names.map(name => ({ name, data: bytes.toString('base64') })),
    ],
    artifactIssues: [{ name: 'trop-grand.pdf', reason: 'oversized' }],
  }))
  const result = await runCode({ language: 'python', code: 'print(1)', packages: ['reportlab'] }, true, new AbortController().signal)
  assert.deepEqual(result.artifacts, names.map(name => artifactFromBytes(name, bytes)))
  assert.deepEqual(result.artifacts.map(file => file.mime), [
    'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ])
  assert.deepEqual(result.artifactWarnings, ['Le fichier « trop-grand.pdf » dépasse la limite de 750 ko.'])
  assert.throws(() => artifactFromBytes('script.html', bytes), /format de fichier invalide/)
  assert.throws(() => artifactFromBytes('rapport.pdf', Buffer.alloc(artifactBytes + 1)), /limite de 750 ko/)
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
