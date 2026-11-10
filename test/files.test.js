import assert from 'node:assert/strict'
import test from 'node:test'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'
import { readAttachments } from '../src/attachments.js'
import { fileTools } from '../src/file-tools.js'

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
