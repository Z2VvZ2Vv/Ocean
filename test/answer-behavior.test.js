import assert from 'node:assert/strict'
import test from 'node:test'
import { generateChatTitle, defaultSettings, runChat } from '../src/inference.js'
import { requestsWordExport } from '../src/word-export.js'
import { previewMathParts } from '../src/preview-math.js'

test('un export Word exige une demande affirmative et distingue le fichier source', () => {
  for (const text of ['Fais le TD1', 'Fait le TD1', 'Fais le TD du document Word joint', 'Résume le Word joint', 'Pas de Word, fais le TD', 'Sans fichier Word', 'Crée un Word. Finalement pas de Word.']) {
    assert.equal(requestsWordExport(text), false, text)
  }
  for (const text of ['Fais-moi un Word', 'Crée un fichier bilan.docx', 'Oui, en Word', 'Donne le corrigé au format Word', 'Word nommé bilan.docx : résultats']) {
    assert.equal(requestsWordExport(text), true, text)
  }
})

test('un Word non demandé est refusé avant l’exécution et le modèle revient à la réponse web', async ({ mock }) => {
  let requests = 0
  mock.method(globalThis, 'fetch', async (_url, { body }) => {
    const data = JSON.parse(body)
    if (++requests === 1) return Response.json({ choices: [{ message: {
      content: 'Étape 1. Les champs des charges opposées se compensent.',
      tool_calls: [{ id: 'word', function: { name: 'create_file', arguments: '{"name":"corrige.docx","content":"Solution"}' } }],
    }, finish_reason: 'tool_calls' }] })
    assert.match(data.messages.at(-1).content, /demandé explicitement/)
    return Response.json({ choices: [{ message: { content: 'Voici le corrigé détaillé dans le chat.' }, finish_reason: 'stop' }] })
  })
  const answer = await runChat({
    config: defaultSettings, messages: [{ role: 'user', text: 'Fais le TD1' }],
    signal: new AbortController().signal, onUpdate: () => {},
    tools: [{ definition: { type: 'function', function: { name: 'create_file' } }, run: () => assert.fail('Un Word ne doit pas être créé.') }],
  })
  assert.equal(answer.text, 'Étape 1. Les champs des charges opposées se compensent.\n\nVoici le corrigé détaillé dans le chat.')
  assert.equal(answer.artifacts, undefined)
})

test('un Word produit par un autre outil est aussi exclu sans demande', async ({ mock }) => {
  let requests = 0
  mock.method(globalThis, 'fetch', async (_url, { body }) => {
    const data = JSON.parse(body)
    if (++requests === 1) return Response.json({ choices: [{ message: {
      tool_calls: [{ id: 'python', function: { name: 'python', arguments: '{}' } }],
    }, finish_reason: 'tool_calls' }] })
    const result = JSON.parse(data.messages.at(-1).content)
    assert.deepEqual(result.fichiers, [])
    assert.match(result.note, /chat/)
    return Response.json({ choices: [{ message: { content: 'Solution dans le chat.' }, finish_reason: 'stop' }] })
  })
  const answer = await runChat({
    config: defaultSettings, messages: [{ role: 'user', text: 'Explique le TD' }], signal: new AbortController().signal,
    onUpdate: update => assert.equal(update.artifacts, undefined),
    tools: [{ definition: { type: 'function', function: { name: 'python' } }, run: async () => ({ artifacts: [{ name: 'solution.docx', url: 'data:application/zip;base64,UEs=' }] }) }],
  })
  assert.equal(answer.artifacts, undefined)
})

test('le titre utilise une requête courte sans réflexion et sans outils', async ({ mock }) => {
  mock.method(globalThis, 'fetch', async (_url, { body }) => {
    const data = JSON.parse(body)
    assert.equal(data.stream, false)
    assert.equal(data.max_tokens, 64)
    assert.equal(data.chat_template_kwargs.enable_thinking, false)
    assert.equal(data.tools, undefined)
    assert.deepEqual(JSON.parse(data.messages[1].content).fichiers, ['TD1.pdf'])
    return Response.json({ choices: [{ message: { content: '« Correction du TD d’électrostatique »' } }] })
  })
  assert.equal(await generateChatTitle(defaultSettings, { text: 'Fais le TD1', documents: [{ name: 'TD1.pdf' }] }, 'Champ électrique et potentiel.', new AbortController().signal), 'Correction du TD d’électrostatique')
})

test('l’aperçu rend les formules inline et bloc avec les délimiteurs usuels', () => {
  const parts = previewMathParts('Distance $a_0$ puis $$E_0=\\frac{4kq}{a^2}$$ et \\(x^2\\), enfin \\[y=2\\].')
  const formulas = parts.filter(part => part.html)
  assert.equal(formulas.length, 4)
  assert.deepEqual(formulas.map(part => part.display), [false, true, false, true])
  assert.ok(formulas.every(part => part.html.includes('katex')))
  const unsafe = previewMathParts('$\\href{javascript:alert(1)}{clic}$')
  assert.ok(unsafe.every(part => !part.html || !part.html.includes('href="javascript:')))
})
