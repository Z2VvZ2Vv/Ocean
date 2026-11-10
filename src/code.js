const languages = {
  python: { label: 'Python', file: 'main.py', aliases: ['py', 'python3'] },
  javascript: { label: 'JavaScript', file: 'main.js', aliases: ['js', 'node', 'nodejs', 'node-js', 'node-javascript'] },
  typescript: { label: 'TypeScript', file: 'main.ts', aliases: ['ts', 'deno-ts'] },
  c: { label: 'C', file: 'main.c', aliases: [] },
  cpp: { label: 'C++', file: 'main.cpp', aliases: ['c++', 'cc', 'cxx'] },
  csharp: { label: 'C#', file: 'Program.cs', aliases: ['c#', 'cs', 'csharp-dotnet', 'csharp-mono'] },
  java: { label: 'Java', file: 'Main.java', aliases: [] },
  go: { label: 'Go', file: 'main.go', aliases: ['golang'] },
  rust: { label: 'Rust', file: 'main.rs', aliases: ['rs'] },
  ruby: { label: 'Ruby', file: 'main.rb', aliases: ['rb'] },
  php: { label: 'PHP', file: 'main.php', aliases: [] },
  bash: { label: 'Bash', file: 'main.sh', aliases: ['sh', 'shell', 'zsh'] },
}

const aliases = new Map(Object.entries(languages).flatMap(([id, language]) =>
  [id, ...language.aliases].map(alias => [alias, { ...language, id }]),
))

export const runnableLanguages = Object.keys(languages)
export const codeLimit = 12000
export const inputLimit = 8000
export const cloudRunTimeout = 100000
export const codeStreamType = 'application/x-ndjson'
export const artifactLimit = 3
export const artifactBytes = 750000
export const fileInputLimit = 32 * 1024 * 1024
export const cloudFileLimit = 2500000
export const inputFilename = /^[a-z0-9][a-z0-9_.-]{0,109}$/i
export const artifactTypes = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  csv: 'text/csv', txt: 'text/plain', json: 'application/json',
})

export function codeLanguage(label) {
  return typeof label === 'string' ? aliases.get(label.toLowerCase()) : undefined
}

const cInput = /\b(?:scanf|scanf_s|getchar|gets)\s*\(|\b(?:fgets|fscanf|fread|getc|fgetc)\s*\([^;\n]*\bstdin\b/
const jsInput = /\b(?:readLine\s*\(|(?:process\.)?stdin\b|readFileSync\s*\(\s*0\b)/i
const inputPatterns = {
  python: /\b(?:input\s*\(|stdin\b)/,
  javascript: jsInput,
  typescript: jsInput,
  c: cInput,
  cpp: /\bcin\b/,
  csharp: /\bConsole\s*\.\s*(?:Read|ReadLine|ReadKey)\s*\(/,
  java: /\bSystem\s*\.\s*in\b/,
  go: /\bfmt\s*\.\s*Scan(?:ln|f)?\s*\(|\bos\s*\.\s*Stdin\b/,
  rust: /\b(?:stdin|read_line)\s*\(/,
  ruby: /\bgets\b|\bSTDIN\b/,
  php: /\bSTDIN\b|\breadline\s*\(/i,
  bash: /(?:^|[;\n&|]\s*)\s*read\b/,
}

export function programReadsInput(language, code) {
  const id = codeLanguage(language)?.id
  return Boolean(inputPatterns[id]?.test(code) || id === 'cpp' && cInput.test(code))
}

export function safeInputName(name, index) {
  const clean = name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9_.-]+/gi, '-').replace(/^\.+/, '')
  const extension = clean.match(/\.[a-z0-9]{1,12}$/i)?.[0] || ''
  const stem = clean.slice(0, clean.length - extension.length).slice(0, 90) || 'fichier'
  return `${index + 1}-${stem}${extension}`
}

export function artifactType(name) {
  if (typeof name !== 'string' || !/^[\p{L}\p{N}_-][\p{L}\p{N}_. -]{0,90}\.[a-z0-9]{2,4}$/iu.test(name)) return undefined
  return artifactTypes[name.split('.').at(-1).toLowerCase()]
}

function normalizeArtifacts(files) {
  if (!Array.isArray(files)) return []
  return files.slice(0, artifactLimit).flatMap(file => {
    const mime = artifactType(file?.name)
    const data = file?.data
    if (!mime || typeof data !== 'string' || !data || data.length > Math.ceil(artifactBytes / 3) * 4 || !/^[\w+/]+={0,2}$/.test(data)) return []
    return [{ name: file.name, mime, url: `data:${mime};base64,${data}` }]
  })
}

function normalizeResult(data) {
  const output = typeof data?.output === 'string' ? data.output.slice(0, 12000) : ''
  const error = typeof data?.error === 'string' ? data.error.slice(0, 3000) : ''
  const artifacts = normalizeArtifacts(data?.artifacts)
  return { output, ...(error && { error }), ...(artifacts.length && { artifacts }) }
}

export function validateProgram(code, stdin) {
  if (typeof code !== 'string' || !code.trim() || code.length > codeLimit) {
    throw new Error(`Saisis un programme de 1 à ${codeLimit.toLocaleString('fr-FR')} caractères.`)
  }
  if (typeof stdin !== 'string' || stdin.length > inputLimit) throw new Error('L’entrée du programme est trop longue.')
}

function runInBrowser(language, code, stdin, signal, files = []) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.hidden = true
    frame.sandbox = 'allow-scripts'
    frame.src = `/${language}-sandbox.html`
    frame.title = `Exécution isolée · ${languages[language].label}`
    const channel = new MessageChannel()
    const seconds = language === 'javascript' ? 12 : 45
    const timeout = setTimeout(() => done(reject, new Error(`Exécution interrompue après ${seconds} secondes.`)), seconds * 1000)
    const abort = () => done(reject, signal.reason)

    function done(callback, value) {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      channel.port1.close()
      frame.remove()
      callback(value)
    }

    channel.port1.onmessage = ({ data }) => done(resolve, normalizeResult(data))
    signal.addEventListener('abort', abort, { once: true })
    frame.onload = () => frame.contentWindow.postMessage({ code, stdin, files }, '*', [channel.port2])
    document.body.append(frame)
  })
}

export function runPython({ code, stdin = '', files = [] }, signal) {
  validateProgram(code, stdin)
  return runInBrowser('python', code, stdin, signal, files)
}

export function validatePackages(packages) {
  if (!Array.isArray(packages) || packages.length > 8 || packages.some(name =>
    typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}(?:==[a-z0-9][a-z0-9.+!-]{0,39})?$/i.test(name),
  )) throw new Error('Indique jusqu’à 8 noms de paquets PyPI, éventuellement avec ==version.')
  return [...new Set(packages)]
}

const pypiNames = { PIL: 'Pillow', cv2: 'opencv-python-headless', sklearn: 'scikit-learn', yaml: 'PyYAML', bs4: 'beautifulsoup4' }

async function encodeCloudFiles(files, signal) {
  if (files.reduce((total, file) => total + file.blob.size, 0) > cloudFileLimit) {
    throw new Error('Les fichiers sélectionnés dépassent 2,5 Mo pour la sandbox Vercel. Utilise Python dans le navigateur ou sélectionne un extrait.')
  }
  const encoded = []
  for (const { name, blob } of files) {
    signal.throwIfAborted()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384))
    }
    encoded.push({ name, data: btoa(binary) })
  }
  return encoded
}

async function readCodeResponse(response, onProgress) {
  if (!response.headers.get('content-type')?.includes(codeStreamType) || !response.body) return response.json().catch(() => null)
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let pending = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return null
      pending += value
      let end
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end)
        pending = pending.slice(end + 1)
        if (!line.trim()) continue
        const event = JSON.parse(line)
        if (event.result) return event.result
        if (typeof event.phase === 'string') onProgress?.(event.phase)
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function runCode({ language, code, stdin = '', packages = [], files = [] }, sandboxEnabled, signal, onProgress) {
  const target = codeLanguage(language)
  if (!target) throw new Error('Ce langage ne peut pas être exécuté dans Ocean.')
  validateProgram(code, stdin)
  packages = validatePackages(packages)
  if (target.id === 'python' && !packages.length) {
    onProgress?.('browser')
    const local = await runPython({ code, stdin, files }, signal)
    const missing = local.error?.match(/ModuleNotFoundError: No module named ['"]([A-Za-z][\w]*)['"]/)
    if (!missing) return local
    if (!sandboxEnabled) return { ...local, error: `${local.error}\nActive la sandbox Vercel pour installer d’autres modules Python.` }
    packages = [Object.hasOwn(pypiNames, missing[1]) ? pypiNames[missing[1]] : missing[1]]
  }
  if (!sandboxEnabled && target.id === 'javascript') {
    onProgress?.('browser')
    return runInBrowser('javascript', code, stdin, signal)
  }
  if (!sandboxEnabled) throw new Error('Ce langage nécessite l’activation de la sandbox sur Vercel.')

  const inputs = files.length ? await encodeCloudFiles(files, signal) : undefined
  onProgress?.('opening')
  const deadline = AbortSignal.timeout(cloudRunTimeout)
  try {
    const response = await fetch('/api/code', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(onProgress && { Accept: codeStreamType }) },
      body: JSON.stringify({ language: target.id, code, stdin, packages, ...(inputs && { files: inputs }) }), signal: AbortSignal.any([signal, deadline]),
    })
    const result = await readCodeResponse(response, onProgress)
    signal.throwIfAborted()
    deadline.throwIfAborted()
    if (!response.ok || !result) throw new Error(result?.error || 'La sandbox Vercel n’a pas répondu.')
    return normalizeResult(result)
  } catch (error) {
    signal.throwIfAborted()
    if (deadline.aborted) throw new Error('La sandbox Vercel n’a pas répondu dans le délai imparti. Relance l’exécution.')
    throw error
  }
}
