import { runCode, runnableLanguages } from './code.js'

async function searchWeb({ query }, signal) {
  if (typeof query !== 'string' || !query.trim() || query.length > 400) throw new Error('Requête web invalide.')
  const response = await fetch('/api/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Recherche web indisponible.')
  return data
}

export function chatTools(searchEnabled, sandboxEnabled) {
  const tools = [{
    label: 'Exécution de Python',
    definition: {
      type: 'function',
      function: {
        name: 'python',
        description: sandboxEnabled
          ? 'Exécute du Python 3 isolé. Pour des bibliothèques PyPI hors du navigateur, renseigne packages avec leurs noms de distribution et enregistre les fichiers dans artifacts/. Sinon, utilise Matplotlib ou écris les fichiers dans le dossier courant. Utilise print pour les résultats texte.'
          : 'Exécute du Python 3 isolé dans le navigateur. Utilise print pour les résultats texte. Pour produire un graphique ou un fichier, utilise Matplotlib ou écris un PNG, CSV, TXT ou JSON dans le dossier courant.',
        parameters: {
          type: 'object', properties: {
            code: { type: 'string' }, stdin: { type: 'string' },
            ...(sandboxEnabled && { packages: { type: 'array', items: { type: 'string' }, maxItems: 8 } }),
          }, required: ['code'], additionalProperties: false,
        },
      },
    },
    run: (args, signal) => runCode({ ...args, language: 'python' }, sandboxEnabled, signal),
  }, {
    label: 'Exécution du code',
    definition: {
      type: 'function',
      function: {
        name: 'run_code',
        description: sandboxEnabled
          ? 'Compile ou exécute un programme complet. Donne le code et, si nécessaire, son entrée standard. Écris les fichiers PNG, CSV, TXT ou JSON à transmettre dans le dossier artifacts/. Pour Java, utilise une classe Main.'
          : 'Exécute du JavaScript dans le navigateur, sans Node.js. Utilise console.log pour renvoyer le résultat et readLine() pour lire une ligne de stdin.',
        parameters: {
          type: 'object', properties: {
            language: { type: 'string', enum: sandboxEnabled ? runnableLanguages.filter(id => id !== 'python') : ['javascript'] },
            code: { type: 'string' }, stdin: { type: 'string' },
          }, required: ['language', 'code'], additionalProperties: false,
        },
      },
    },
    run: (args, signal) => runCode(args, sandboxEnabled, signal),
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
