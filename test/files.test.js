import assert from 'node:assert/strict'
import test from 'node:test'
import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'
import { readAttachments } from '../src/attachments.js'
import { fileTools } from '../src/file-tools.js'
import { readTextChunk } from '../src/document-text.js'

test('les fichiers au-delà des anciennes limites sont conservés et le catalogue est paginé', async () => {
  const signal = new AbortController().signal
  const inputs = Array.from({ length: 24 }, (_, index) => new File(['%PDF'], `document-${index + 1}.pdf`, { type: 'application/pdf' }))
  inputs.push(new File([new Uint8Array(13 * 1024 * 1024)], 'archive.bin'))
  const attachments = await readAttachments(inputs, { images: [], documents: [] }, signal)
  assert.equal(attachments.documents.length, 25)
  assert.equal(attachments.documents.at(-1).blob, inputs.at(-1))
  const { tools } = fileTools([{ role: 'user', ...attachments }])
  const list = tools.find(tool => tool.definition.function.name === 'list_attachments')
  assert.equal((await list.run({}, signal)).next_offset, 20)
  assert.deepEqual((await list.run({ offset: 20 }, signal)).files.map(file => file.name), [
    'document-21.pdf', 'document-22.pdf', 'document-23.pdf', 'document-24.pdf', 'archive.bin',
  ])
})

test('un fichier dans un ZIP est lisible et peut être monté dans Python', async () => {
  const signal = new AbortController().signal
  const zip = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false })
  await zip.add('exports/résultats.csv', new TextReader('nom,valeur\nDelta,42\n'))
  const blob = await zip.close()
  const catalog = fileTools([{ role: 'user', documents: [{ id: 'zip', name: 'lot.zip', blob }] }])
  const read = catalog.tools.find(tool => tool.definition.function.name === 'read_attachment')
  const listed = await read.run({ file_id: 'zip' }, signal)
  assert.equal(listed.entries[0].name, 'exports/résultats.csv')
  const data = await read.run({ file_id: 'zip', entry: 1 }, signal)
  assert.equal(data.text, 'nom,valeur\nDelta,42\n')
  const [mounted] = await catalog.mount([{ file_id: 'zip', entry: 1 }], signal)
  assert.equal(mounted.name, '1-resultats.csv')
  assert.equal(await mounted.blob.text(), data.text)
})

test('une réponse suivante peut archiver les octets du graphique déjà affiché', async () => {
  const signal = new AbortController().signal
  const bytes = Buffer.from('graphique original')
  const name = 'graphique-1.png'
  const messages = [
    { role: 'user', text: 'Trace le graphique.' },
    { role: 'assistant', artifacts: [{ name, url: `data:image/png;base64,${bytes.toString('base64')}` }] },
    { role: 'user', text: 'Mets ce graphique dans un ZIP.' },
  ]
  const catalog = fileTools(messages)
  const list = catalog.tools.find(tool => tool.definition.function.name === 'list_attachments')
  const { files: [file] } = await list.run({ query: name }, signal)
  assert.equal(file.source, 'generated')
  assert.equal(file.name, name)
  const [mounted] = await catalog.mount([{ file_id: file.id }], signal)
  assert.deepEqual(Buffer.from(await mounted.blob.arrayBuffer()), bytes)

  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false })
  await writer.add(name, new BlobReader(mounted.blob))
  const zip = Buffer.from(await (await writer.close()).arrayBuffer())
  messages.push({ role: 'assistant', artifacts: [{ name: 'graphique-1.zip', url: `data:application/zip;base64,${zip.toString('base64')}` }] })
  const next = fileTools(messages)
  const read = next.tools.find(tool => tool.definition.function.name === 'read_attachment')
  const archive = await read.run({ file_id: 'generated-4-1' }, signal)
  assert.equal(archive.entries[0].name, name)
  const [extracted] = await next.mount([{ file_id: 'generated-4-1', entry: 1 }], signal)
  assert.deepEqual(Buffer.from(await extracted.blob.arrayBuffer()), bytes)
})

test('la lecture par octets conserve les caractères UTF-16 entre deux extraits', async () => {
  const signal = new AbortController().signal
  const text = 'a'.repeat(5998) + '🐬 Ocean'
  const blob = new Blob([Buffer.from('\uFEFF' + text, 'utf16le')])
  const first = await readTextChunk(blob, 0, signal)
  assert.equal(first.next_offset, 11998)
  const last = await readTextChunk(blob, first.next_offset, signal)
  assert.equal(first.text + last.text, text)
  assert.equal(last.next_offset, undefined)
})
