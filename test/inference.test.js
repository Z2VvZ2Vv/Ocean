import assert from 'node:assert/strict'
import test from 'node:test'
import { apiBase, defaultSettings, runChat } from '../src/inference.js'

test('une adresse GGUF ne peut pas être utilisée comme API', () => {
  assert.throws(() => apiBase('http://model.ts.net/etc/model.gguf'), /fichier GGUF/)
  assert.equal(apiBase('https://model.ts.net/v1/models/'), 'https://model.ts.net/v1')
  assert.equal(apiBase('https://model.ts.net/inference/'), 'https://model.ts.net/inference/v1')
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
