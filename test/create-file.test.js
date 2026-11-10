import assert from 'node:assert/strict'
import test from 'node:test'
import mammoth from 'mammoth'
import { readSheet } from 'read-excel-file/node'
import { createFile } from '../src/create-file.js'

const signal = new AbortController().signal

function artifactBytes(artifact) {
  assert.ok(artifact.url.startsWith(`data:${artifact.mime};base64,`))
  return Buffer.from(artifact.url.split(',')[1], 'base64')
}

test('un document Word conserve les titres, les accents, la mise en forme et les tableaux', async () => {
  const { artifacts: [file] } = await createFile({
    name: 'résultats.docx',
    content: '# Mesures\n\nValeur **mesurée** à 42 ms.\n\n| Essai | Durée |\n|---|---:|\n| A | 42 ms |',
  }, signal)
  const { value } = await mammoth.convertToHtml({ buffer: artifactBytes(file) })
  assert.match(value, /<h1>Mesures<\/h1>/)
  assert.match(value, /<strong>mesurée<\/strong>/)
  assert.match(value, /<table>[\s\S]*<th><p><strong>Durée<\/strong><\/p><\/th>[\s\S]*<td><p>42 ms<\/p><\/td>[\s\S]*<\/table>/)
})

test('un fichier Excel conserve le type des cellules et le texte qui commence par =', async () => {
  const rows = [['Essai', 'Durée', 'Validé'], ['=A1', 42, true]]
  const { artifacts: [file] } = await createFile({ name: 'mesures.xlsx', rows }, signal)
  assert.deepEqual(await readSheet(artifactBytes(file)), rows)
})

test('un Word conserve le LaTeX pour son aperçu sans interpréter les indices comme de l’emphase', async () => {
  const { artifacts: [file] } = await createFile({ name: 'formules.docx', content: '# Champ\n\nLe champ $E_0 = \\frac{4kq}{a^2}$ vaut\n\n$$\n\\vec{E}(O) = \\vec{0}\n$$\n\nLittéral : `$a_0$`.' }, signal)
  const { value } = await mammoth.extractRawText({ buffer: artifactBytes(file) })
  assert.match(value, /\$E_0 = \\frac\{4kq\}\{a\^2\}\$/)
  assert.match(value, /\$\$\\vec\{E\}\(O\) = \\vec\{0\}\$\$/)
  const html = await mammoth.convertToHtml({ buffer: artifactBytes(file) }, { styleMap: ["r[style-name='Ocean Code'] => code"] })
  assert.match(html.value, /<code>\$a_0\$<\/code>/)
})

test('un fichier CSV échappe les séparateurs et protège les cellules texte interprétables comme formules', async () => {
  const { artifacts: [file] } = await createFile({ name: 'mesures.csv', rows: [['Un, deux', 'A "B"', '=A1', -2]] }, signal)
  assert.equal(artifactBytes(file).toString(), `\uFEFF"Un, deux","A ""B""","'=A1","-2"\r\n`)
})

test('la création refuse les chemins, le JSON invalide et les valeurs de cellule structurées', async () => {
  await assert.rejects(createFile({ name: '../fichier.txt', content: 'Texte' }, signal), /nom de fichier valide/)
  await assert.rejects(createFile({ name: 'fichier.json', content: '{' }, signal), /JSON valide/)
  await assert.rejects(createFile({ name: 'fichier.xlsx', rows: [[{ formula: '=1+1' }]] }, signal), /cellule/)
})
