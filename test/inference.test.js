import assert from 'node:assert/strict'
import test from 'node:test'
import { apiBase, defaultSettings, listModels, runChat } from '../src/inference.js'

test('une adresse GGUF ne peut pas être utilisée comme API', () => {
  assert.throws(() => apiBase('http://model.ts.net/etc/model.gguf'), /fichier GGUF/)
  assert.equal(apiBase('https://model.ts.net/v1/models/'), 'https://model.ts.net/v1')
  assert.equal(apiBase('https://model.ts.net/inference/'), 'https://model.ts.net/inference')
})

test('la détection essaie /v1 seulement si la route directe est indisponible', async ({ mock }) => {
  const urls = []
  mock.method(globalThis, 'fetch', async url => {
    urls.push(url)
    if (url.endsWith('/v1/models')) return Response.json({ data: [{ id: 'local' }] })
    return new Response(null, { status: 404 })
  })
  const endpoint = 'https://model.ts.net'
  assert.deepEqual(await listModels({ endpoint }), ['local'])
  assert.deepEqual(urls, [`${endpoint}/models`, `${endpoint}/v1/models`])
})

function stream(...choices) {
  const encoder = new TextEncoder()
  const data = choices.map(choice => `data: ${JSON.stringify({ choices: [choice] })}\r\n\r\n`).join('')
  const bytes = encoder.encode(data + 'data: [DONE]\r\n\r\n')
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 13) controller.enqueue(bytes.slice(i, i + 13))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
}

test('une image seule et les résultats des outils repartent directement vers le modèle local', async ({ mock }) => {
  const calls = []
  const image = 'data:image/png;base64,cG5n'
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://model.ts.net/v1/chat/completions')
    assert.equal(options.credentials, 'omit')
    const body = JSON.parse(options.body)
    calls.push(body)
    if (calls.length === 1) return stream(
      { delta: { tool_calls: [{ index: 0, id: 'calc', function: { name: 'python', arguments: '{"co' } }] } },
      { delta: { tool_calls: [{ index: 0, function: { arguments: 'de":"print(2*3)"}' } }] }, finish_reason: 'tool_calls' },
    )
    return stream(
      { delta: { content: '<thi' } },
      { delta: { content: 'nk>Vérification</think> Quel serait ton premier indice ?' }, finish_reason: 'stop' },
    )
  })

  const updates = []
  const answer = await runChat({
    config: { ...defaultSettings, endpoint: 'https://model.ts.net/v1', effort: 'high' },
    messages: [{ role: 'user', text: '', images: [{ url: image }] }],
    learning: true,
    signal: new AbortController().signal,
    onTool: () => {},
    onUpdate: update => updates.push(update),
    tools: [{
      definition: { type: 'function', function: { name: 'python' } },
      run: async args => {
        assert.deepEqual(args, { code: 'print(2*3)' })
        return { output: '6' }
      },
    }],
  })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].thinking_budget_tokens, 8192)
  assert.match(calls[0].messages[0].content, /ne révèle ni le résultat final/)
  assert.deepEqual(calls[0].messages[1].content, [{ type: 'image_url', image_url: { url: image } }])
  assert.deepEqual(calls[1].messages.at(-1), { role: 'tool', tool_call_id: 'calc', content: '{"output":"6"}' })
  assert.ok(updates.every(update => !update.text.includes('<think') && !update.text.includes('<thi')))
  assert.equal(answer.reasoning, 'Vérification')
  assert.equal(answer.text, 'Quel serait ton premier indice ?')
})

test('les documents restent disponibles au tour suivant et les scans gardent leur numéro de page', async ({ mock }) => {
  const scan = 'data:image/jpeg;base64,c2Nhbg=='
  const messages = [
    { role: 'user', text: '', documents: [{ name: 'Cours.pdf', text: 'Page 1\nLa charge est quantifiée.' }] },
    { role: 'assistant', text: 'Le cours parle de charge.' },
    { role: 'user', text: 'Compare avec ce scan.', documents: [{ name: 'Exercice.pdf', text: '', pageImages: [{ number: 3, url: scan }] }] },
  ]
  let body
  mock.method(globalThis, 'fetch', async (url, options) => {
    body = JSON.parse(options.body)
    return stream({ delta: { content: 'Comparaison' }, finish_reason: 'stop' })
  })

  await runChat({
    config: defaultSettings, messages, tools: [], signal: new AbortController().signal,
    onTool: () => {}, onUpdate: () => {},
  })

  assert.match(body.messages[1].content, /Pièce jointe "Cours.pdf"\nPage 1\nLa charge est quantifiée\./)
  assert.deepEqual(body.messages.at(-1).content, [
    { type: 'text', text: 'Compare avec ce scan.' },
    { type: 'text', text: 'Pièce jointe "Exercice.pdf", page 3' },
    { type: 'image_url', image_url: { url: scan } },
  ])
})

test('un modèle qui exige xhigh accepte la réflexion approfondie', async ({ mock }) => {
  const attempts = []
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `${defaultSettings.endpoint}/chat/completions`)
    const body = JSON.parse(options.body)
    attempts.push(body.reasoning_effort)
    assert.equal(body.thinking_budget_tokens, 8192)
    if (body.reasoning_effort === 'high') {
      return Response.json({
        error: { message: 'Jinja Exception: Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low.' },
      }, { status: 500 })
    }
    return stream({ delta: { content: 'Réponse' }, finish_reason: 'stop' })
  })

  const result = await runChat({
    config: { ...defaultSettings, effort: 'high' },
    messages: [{ role: 'user', text: 'Bonjour' }], tools: [], signal: new AbortController().signal,
    onTool: () => {}, onUpdate: () => {},
  })

  assert.deepEqual(attempts, ['high', 'xhigh'])
  assert.equal(result.text, 'Réponse')
})
