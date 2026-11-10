import assert from 'node:assert/strict'
import test from 'node:test'
import { embeddedFileUrl, parseTablePreview, previewFormat } from '../src/preview-data.js'

test('l’aperçu CSV conserve les séparateurs et sauts de ligne dans les cellules entre guillemets', () => {
  const result = parseTablePreview('\uFEFFsep=;\r\nNom;Note\r\nAlice;"a;b\r\nune ""citation"""\r\nBob;\r\n', 'csv')
  assert.deepEqual(result, { rows: [['Nom', 'Note'], ['Alice', 'a;b\r\nune "citation"'], ['Bob', '']], truncated: false })
})

test('l’aperçu TSV préserve les cellules vides et signale les limites de lignes et de colonnes', () => {
  assert.deepEqual(parseTablePreview('\tB\t', 'tsv').rows, [['', 'B', '']])
  const source = Array.from({ length: 101 }, () => Array.from({ length: 25 }, (_, index) => index).join('\t')).join('\n')
  const result = parseTablePreview(source, 'tsv')
  assert.equal(result.rows.length, 100)
  assert.equal(result.rows[0].length, 24)
  assert.equal(result.truncated, true)
})

test('une pièce jointe à prévisualiser ne déclenche pas de requête vers une adresse externe', () => {
  assert.equal(embeddedFileUrl({ url: 'https://example.test/image.png' }), null)
  assert.equal(embeddedFileUrl({ url: 'javascript:alert(1)' }), null)
  assert.equal(previewFormat({ name: 'Capture d’écran', url: 'data:image/png;base64,AAAA' }), 'image')
  assert.equal(previewFormat({ name: 'page.html', mime: 'text/html' }), 'text')
})
