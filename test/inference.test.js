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
      { delta: { reasoning_content: 'Je prépare le calcul.' } },
      { delta: { tool_calls: [{ index: 0, id: 'calc', function: { name: 'python', arguments: '{"co' } }] } },
      { delta: { tool_calls: [{ index: 0, function: { arguments: 'de":"print(2*3)"}' } }] }, finish_reason: 'tool_calls' },
    )
    assert.deepEqual(updates.at(-1).artifacts, [{ name: 'calcul.png', mime: 'image/png', url: image }])
    return stream(
      { delta: { content: '<thi' } },
      { delta: { content: 'nk>Vérification' } },
      { delta: { content: '</think> Quel serait ton premier indice ?' }, finish_reason: 'stop' },
    )
  })

  const updates = []
  const progress = []
  const answer = await runChat({
    config: { ...defaultSettings, endpoint: 'https://model.ts.net/v1', effort: 'xhigh' },
    messages: [{ role: 'user', text: '', images: [{ url: image }] }],
    learning: true,
    signal: new AbortController().signal,
    onProgress: (label, record) => progress.push([label, Boolean(record)]),
    onUpdate: update => updates.push(update),
    tools: [{
      label: 'Exécution de Python',
      definition: { type: 'function', function: { name: 'python' } },
      run: async (args, _signal, onProgress) => {
        assert.deepEqual(args, { code: 'print(2*3)' })
        onProgress('Exécution dans le navigateur')
        return { output: '6', artifacts: [{ name: 'calcul.png', mime: 'image/png', url: image }] }
      },
    }],
  })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].thinking_budget_tokens, 8192)
  assert.match(calls[0].messages[0].content, /ne révèle ni le résultat final/)
  assert.deepEqual(calls[0].messages[1].content, [{ type: 'image_url', image_url: { url: image } }])
  assert.deepEqual(calls[1].messages.at(-1), { role: 'tool', tool_call_id: 'calc', content: '{"output":"6","fichiers":["calcul.png"]}' })
  assert.deepEqual(answer.artifacts, [{ name: 'calcul.png', mime: 'image/png', url: image }])
  assert.ok(updates.every(update => !update.text.includes('<think') && !update.text.includes('<thi')))
  assert.equal(answer.reasoning, 'Vérification')
  assert.equal(answer.text, 'Quel serait ton premier indice ?')
  assert.deepEqual(progress, [
    ['Envoi de la demande au modèle', false],
    ['En attente des premières données du modèle', false],
    ['Le modèle analyse la demande', false],
    ['Préparation de l’outil · Exécution de Python', false],
    ['Exécution de Python', true],
    ['Exécution de Python · Exécution dans le navigateur', false],
    ['Envoi des résultats des outils au modèle', false],
    ['En attente des premières données du modèle', false],
    ['Le modèle analyse les résultats des outils', false],
    ['Rédaction de la réponse', false],
  ])
})

test('les documents et fichiers générés restent accessibles au tour suivant', async ({ mock }) => {
  const scan = 'data:image/jpeg;base64,c2Nhbg=='
  const messages = [
    { role: 'user', text: '', documents: [{ name: 'Cours.pdf', text: 'Page 1\nLa charge est quantifiée.' }] },
    { role: 'assistant', text: 'Le cours parle de charge.', artifacts: [{ name: 'graphique.png', url: scan.replace('image/jpeg', 'image/png') }] },
    { role: 'user', text: 'Compare avec ce scan.', documents: [{ name: 'Exercice.pdf', text: '', pageImages: [{ number: 3, url: scan }] }] },
  ]
  let body
  mock.method(globalThis, 'fetch', async (url, options) => {
    body = JSON.parse(options.body)
    return stream({ delta: { content: 'Comparaison' }, finish_reason: 'stop' })
  })

  await runChat({
    config: defaultSettings, messages, tools: [], signal: new AbortController().signal,
    onUpdate: () => {},
  })

  assert.match(body.messages[1].content, /Pièce jointe "Cours.pdf"\nPage 1\nLa charge est quantifiée\./)
  assert.match(body.messages[2].content, /"graphique\.png" \(id generated-2-1\)/)
  assert.ok(!body.messages[2].content.includes('c2Nhbg=='))
  assert.deepEqual(body.messages.at(-1).content, [
    { type: 'text', text: 'Compare avec ce scan.' },
    { type: 'text', text: 'Pièce jointe "Exercice.pdf", page 3' },
    { type: 'image_url', image_url: { url: scan } },
  ])
})

test('les petits fichiers texte entrent dans la première requête et les gros restent dans le catalogue', async ({ mock }) => {
  let body
  const activity = []
  mock.method(globalThis, 'fetch', async (_url, options) => {
    body = JSON.parse(options.body)
    return stream({ delta: { content: 'Total calculé.' }, finish_reason: 'stop' })
  })
  const documents = [
    { id: 'petit', name: 'ventes.csv', blob: new Blob(['\uFEFFarticle;quantité\nÉcran;42'], { type: 'text/csv' }) },
    { id: 'grand', name: 'journal.txt', blob: new Blob(['Donnée volumineuse '.repeat(6000)]) },
  ]
  await runChat({
    config: defaultSettings, messages: [{ role: 'user', text: 'Calcule le total.', documents }], tools: [],
    signal: new AbortController().signal, onUpdate: () => {},
    onProgress: (label, record) => { if (record) activity.push(label) },
  })
  const prompt = body.messages.at(-1).content
  assert.ok(prompt.startsWith('Calcule le total.'))
  const excerpt = JSON.parse(prompt.split('\n').find(line => line.startsWith('{"name":')))
  assert.deepEqual(excerpt, { name: 'ventes.csv', id: 'petit', text: 'article;quantité\nÉcran;42' })
  assert.match(prompt, /journal\.txt/)
  assert.doesNotMatch(prompt, /Donnée volumineuse/)
  assert.match(body.messages[0].content, /données de référence/)
  assert.deepEqual(activity, ['Lecture de « ventes.csv »'])
})

test('la réflexion utilise uniquement low, medium et xhigh dès la première requête', async ({ mock }) => {
  const efforts = []
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `${defaultSettings.endpoint}/chat/completions`)
    const body = JSON.parse(options.body)
    efforts.push(body.reasoning_effort)
    assert.equal(body.chat_template_kwargs.enable_thinking, body.reasoning_effort !== 'low')
    return stream({ delta: { content: 'Réponse' }, finish_reason: 'stop' })
  })

  for (const effort of [defaultSettings.effort, 'low', 'medium', 'xhigh', 'high', 'none']) {
    await runChat({
      config: { ...defaultSettings, effort },
      messages: [{ role: 'user', text: 'Bonjour' }], tools: [], signal: new AbortController().signal,
      onUpdate: () => {},
    })
  }

  assert.deepEqual(efforts, ['xhigh', 'low', 'medium', 'xhigh', 'xhigh', 'low'])
})

test('une page de PDF devient une image vision après la réponse texte de l’outil', async ({ mock }) => {
  const image = 'data:image/jpeg;base64,cGFnZQ=='
  const requests = []
  mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body))
    if (requests.length === 1) return stream({ delta: { tool_calls: [{ id: 'page', function: { name: 'view_attachment', arguments: '{}' } }] }, finish_reason: 'tool_calls' })
    return stream({ delta: { content: 'La page montre un graphique.' }, finish_reason: 'stop' })
  })

  await runChat({ config: defaultSettings, messages: [{ role: 'user', text: 'Observe la page 3.', documents: [
    { id: 'pdf', name: 'cours.pdf', format: 'PDF', blob: new Blob(['PDF local uniquement']) },
  ] }], signal: new AbortController().signal, onUpdate: () => {}, tools: [{
    definition: { type: 'function', function: { name: 'view_attachment' } },
    run: async () => ({ image: 'cours.pdf — page 3', images: [{ label: 'cours.pdf — page 3', url: image }] }),
  }] })

  assert.match(requests[0].messages[1].content, /cours\.pdf/)
  assert.ok(!JSON.stringify(requests[0]).includes('PDF local uniquement'))
  assert.deepEqual(requests[1].messages.slice(-2), [
    { role: 'tool', tool_call_id: 'page', content: '{"image":"cours.pdf — page 3"}' },
    { role: 'user', content: [
      { type: 'text', text: 'Observation d’une pièce jointe : cours.pdf — page 3' },
      { type: 'image_url', image_url: { url: image } },
    ] },
  ])
})

test('le délai de génération repart à chaque bloc reçu du flux', async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const encoder = new TextEncoder()
  const first = Promise.withResolvers()
  const second = Promise.withResolvers()
  let streamController
  let requestSignal
  function send(content, finish_reason = null) {
    const choice = { delta: { content }, finish_reason }
    streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [choice] })}\n\n`))
  }
  mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    requestSignal = signal
    return new Response(new ReadableStream({
      start(controller) {
        streamController = controller
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
        send('Début')
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })
  })

  const answer = runChat({
    config: defaultSettings, messages: [{ role: 'user', text: 'Explique le TP.' }], tools: [],
    signal: new AbortController().signal, onUpdate: ({ text }) => {
      if (text === 'Début') first.resolve()
      if (text === 'Début et suite') second.resolve()
    },
  })
  await first.promise
  mock.timers.tick(240000)
  send(' et suite')
  await second.promise
  mock.timers.tick(240000)
  assert.equal(requestSignal.aborted, false)
  send('.', 'stop')
  streamController.close()
  assert.equal((await answer).text, 'Début et suite.')
})

test('un flux interrompu par cinq minutes de silence renvoie une erreur lisible', async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const connected = Promise.withResolvers()
  mock.method(globalThis, 'fetch', async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
      connected.resolve()
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } }))

  const answer = runChat({
    config: defaultSettings, messages: [{ role: 'user', text: 'Explique le TP.' }], tools: [],
    signal: new AbortController().signal, onUpdate: () => {},
  })
  const rejected = assert.rejects(answer, /n’a envoyé aucune donnée depuis cinq minutes/)
  await connected.promise
  mock.timers.tick(300000)
  await rejected
})
