import { codePhases, runCode, runnableLanguages } from './code.js'
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

function reportCodePhase(onProgress) {
  if (!onProgress) return undefined
  return phase => {
    const label = codePhases.get(phase)
    if (label) onProgress(label)
  }
}

export function chatTools(searchEnabled, sandboxEnabled, messages = []) {
  const attachments = fileTools(messages)
  const tools = [{
    label: 'Création du fichier',
    definition: {
      type: 'function',
      function: {
        name: 'create_file',
        description: 'Crée un fichier téléchargeable dans le navigateur. Pour .docx, donne le texte en Markdown avec titres, paragraphes, listes et tableaux dans content. Pour .md, .txt ou .json, donne le contenu exact dans content. Pour .xlsx, .csv ou .tsv, donne les lignes et cellules dans rows. Le nom doit se terminer par l’extension demandée.',
        parameters: {
          type: 'object', properties: {
            name: { type: 'string', description: 'Nom avec extension, par exemple bilan.docx ou mesures.xlsx.' },
            content: { type: 'string', maxLength: 100000 },
            rows: {
              type: 'array', maxItems: 500, items: {
                type: 'array', maxItems: 40, items: { type: ['string', 'number', 'boolean', 'null'] },
              },
            },
            header: { type: 'boolean', description: 'Pour XLSX, mettre en forme et figer la première ligne. Par défaut : true.' },
          }, required: ['name'], additionalProperties: false,
        },
      },
    },
    detail: args => typeof args?.name === 'string' ? `« ${args.name.slice(0, 100)} »` : '',
    run: async (args, signal) => (await import('./create-file.js')).createFile(args, signal),
  }, {
    label: 'Exécution de Python',
    definition: {
      type: 'function',
      function: {
        name: 'python',
        description: (sandboxEnabled
          ? 'Exécute du Python 3 isolé. Pour des bibliothèques PyPI hors du navigateur, renseigne packages avec leurs noms de distribution (reportlab pour PDF, python-docx pour Word, openpyxl pour Excel).'
          : 'Exécute du Python 3 isolé dans le navigateur. Pour créer un PDF, utilise matplotlib.backends.backend_pdf.PdfPages.')
          + ' Utilise print pour les résultats texte, Matplotlib pour un graphique et artifacts/ pour écrire les fichiers à télécharger (PNG, JPEG, WebP, PDF, DOCX, XLSX, PPTX, CSV, TSV, MD, TXT, JSON, ZIP).'
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
    run: async ({ files = [], ...args }, signal, onProgress) => runCode({
      ...args, language: 'python', files: await attachments.mount(files, signal),
    }, sandboxEnabled, signal, reportCodePhase(onProgress)),
  }, {
    label: 'Exécution du code',
    definition: {
      type: 'function',
      function: {
        name: 'run_code',
        description: sandboxEnabled
          ? 'Compile ou exécute un programme complet. Donne le code et, si nécessaire, son entrée standard. Écris les fichiers à transmettre dans artifacts/. Pour Java, utilise une classe Main.'
          : 'Exécute du JavaScript dans le navigateur, sans Node.js. Utilise console.log pour renvoyer le résultat et readLine() pour lire une ligne de stdin.',
        parameters: {
          type: 'object', properties: {
            language: { type: 'string', enum: sandboxEnabled ? runnableLanguages.filter(id => id !== 'python') : ['javascript'] },
            code: { type: 'string' }, stdin: { type: 'string' },
          }, required: ['language', 'code'], additionalProperties: false,
        },
      },
    },
    run: (args, signal, onProgress) => runCode(args, sandboxEnabled, signal, reportCodePhase(onProgress)),
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
