function runPython({ code }, signal) {
  if (typeof code !== 'string' || !code.trim() || code.length > 12000) throw new Error('Code Python invalide.')
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.hidden = true
    frame.sandbox = 'allow-scripts'
    frame.src = '/python-sandbox.html'
    frame.title = 'Exécution Python isolée'
    const channel = new MessageChannel()
    const timeout = setTimeout(() => done(reject, new Error('Exécution Python interrompue après 45 secondes.')), 45000)
    const abort = () => done(reject, signal.reason)

    function done(callback, value) {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      channel.port1.close()
      frame.remove()
      callback(value)
    }

    channel.port1.onmessage = ({ data }) => {
      const output = typeof data?.output === 'string' ? data.output.slice(0, 12000) : ''
      const error = typeof data?.error === 'string' ? data.error.slice(0, 3000) : ''
      done(resolve, error ? { output, error } : { output })
    }
    signal.addEventListener('abort', abort, { once: true })
    frame.onload = () => frame.contentWindow.postMessage({ code }, '*', [channel.port2])
    document.body.append(frame)
  })
}

async function searchWeb({ query }, signal) {
  if (typeof query !== 'string' || !query.trim() || query.length > 400) throw new Error('Requête web invalide.')
  const response = await fetch('/api/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Recherche web indisponible.')
  return data
}

export function chatTools(searchEnabled) {
  const tools = [{
    label: 'Exécution de Python',
    definition: {
      type: 'function',
      function: {
        name: 'python',
        description: 'Exécute du Python 3 isolé pour vérifier un calcul ou transformer des données. Utilise print pour renvoyer le résultat. Bibliothèque standard disponible.',
        parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'], additionalProperties: false },
      },
    },
    run: runPython,
  }]
  if (searchEnabled) tools.push({
    label: 'Recherche sur le web',
    definition: {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Recherche des pages publiques sur le web. Retourne leurs titres, URL et extraits. Formule une requête concise et évite les données privées.',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
      },
    },
    run: searchWeb,
  })
  return tools
}
