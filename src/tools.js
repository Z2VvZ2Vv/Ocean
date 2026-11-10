import { runCode, runnableLanguages } from './code.js'
import { fileTools } from './file-tools.js'

async function searchWeb({ query }, signal) {
  if (typeof query !== 'string' || !query.trim() || query.length > 400) throw new Error('Requête web invalide.')
  const response = await fetch('/api/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Recherche web indisponible.')
  return data
}

export function chatTools(searchEnabled, sandboxEnabled, messages = []) {
  const attachments = fileTools(messages)
  const tools = [{
    label: 'Exécution de Python',
    definition: {
      type: 'function',
      function: {
        name: 'python',
        description: (sandboxEnabled
          ? 'Exécute du Python 3 isolé. Pour des bibliothèques PyPI hors du navigateur, renseigne packages avec leurs noms de distribution.'
          : 'Exécute du Python 3 isolé dans le navigateur.')
          + ' Utilise print pour les résultats texte, Matplotlib pour un graphique et artifacts/ pour écrire les fichiers à télécharger (PNG, JPEG, WebP, CSV, TXT, JSON, ZIP).'
          + (attachments.hasFiles ? ' Sélectionne les pièces jointes et les fichiers déjà produits dans files via leur file_id. Ils sont montés sous des noms numérotés dans attachments/. Utilise os.listdir("attachments") pour les trouver. Pour créer un ZIP avec zipfile, utilise le fichier monté et donne son nom d’origine en arcname.' : ''),
        parameters: {
          type: 'object', properties: {
            code: { type: 'string' }, stdin: { type: 'string' },
            ...(sandboxEnabled && { packages: { type: 'array', items: { type: 'string' }, maxItems: 8 } }),
            ...(attachments.hasFiles && { files: { type: 'array', maxItems: 32, items: {
              type: 'object', properties: attachments.selectors, required: ['file_id'], additionalProperties: false,
            } } }),
          }, required: ['code'], additionalProperties: false,
        },
      },
    },
    run: async ({ files = [], ...args }, signal) => runCode({
      ...args, language: 'python', files: await attachments.mount(files, signal),
    }, sandboxEnabled, signal),
  }, {
    label: 'Exécution du code',
    definition: {
      type: 'function',
      function: {
        name: 'run_code',
        description: sandboxEnabled
          ? 'Compile ou exécute un programme complet. Donne le code et, si nécessaire, son entrée standard. Écris les fichiers PNG, CSV, TXT, JSON ou ZIP à transmettre dans le dossier artifacts/. Pour Java, utilise une classe Main.'
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
  return [...tools, ...attachments.tools]
}
