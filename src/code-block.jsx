import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, LoaderCircle, Play, Square } from 'lucide-react'
import highlight from 'highlight.js/lib/common'
import { codeLanguage, codeLimit, inputLimit, runCode } from './code.js'
import CodeFiles from './code-files.jsx'

export default function CodeBlock({ source, language, generating, sandboxEnabled }) {
  const target = codeLanguage(language)
  const grammar = target?.id || language
  const label = target?.label || language || 'Code'
  const [copied, setCopied] = useState(false)
  const [running, setRunning] = useState(false)
  const [input, setInput] = useState('')
  const [dependencies, setDependencies] = useState('')
  const [result, setResult] = useState(null)
  const request = useRef(null)

  useEffect(() => () => request.current?.abort(), [])

  const markup = useMemo(() => {
    if (generating || !grammar || !highlight.getLanguage(grammar) || source.length > 24000) return null
    return highlight.highlight(source, { language: grammar, ignoreIllegals: true }).value
  }, [source, grammar, generating])

  async function copy() {
    try {
      await navigator.clipboard.writeText(source)
      setCopied(true)
    } catch { setCopied(false) }
  }

  async function execute() {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setRunning(true)
    setResult(null)
    try {
      const packages = dependencies.split(/[,\s]+/).filter(Boolean)
      setResult(await runCode({ language, code: source, stdin: input, packages }, sandboxEnabled, controller.signal))
    } catch (error) {
      setResult({ error: controller.signal.aborted ? 'Exécution arrêtée.' : error.message || 'L’exécution a échoué.' })
    } finally {
      request.current = null
      setRunning(false)
    }
  }

  return <div className="code-block">
    <div className="code-bar">
      <span className="code-label">{label}</span>
      <div className="code-actions">
        {target && !generating && <button type="button" disabled={source.length > codeLimit || !source.trim()}
          onClick={running ? () => request.current?.abort() : execute}>
          {running ? <Square size={14} /> : <Play size={15} />}{running ? 'Arrêter' : 'Exécuter'}
        </button>}
        <button type="button" onClick={copy} aria-label={copied ? 'Code copié' : 'Copier le code'} title={copied ? 'Code copié' : 'Copier le code'}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </div>
    <pre>{markup === null ? <code>{source}</code> : <code dangerouslySetInnerHTML={{ __html: markup }} />}</pre>
    {target && !generating && <details className="code-input">
      <summary>Entrées du programme</summary>
      <label>Entrée standard (stdin)<textarea value={input} maxLength={inputLimit} rows={2} disabled={running} onChange={event => setInput(event.target.value)} /></label>
      {target.id === 'python' && sandboxEnabled && <label>Paquets PyPI à installer
        <input value={dependencies} maxLength={680} disabled={running} placeholder="numpy, scikit-learn" onChange={event => setDependencies(event.target.value)} />
      </label>}
    </details>}
    {(running || result) && <div className="code-result" aria-live="polite">
      {running && <div className="generation-status" role="status"><LoaderCircle className="spinner" size={15} /> Exécution en cours…</div>}
      {result?.error && <p className="error">{result.error}</p>}
      {result?.output && <pre aria-label="Sortie du programme">{result.output}</pre>}
      {result && !result.output && !result.error && !result.artifacts?.length && <p className="small">Exécution terminée, sans sortie.</p>}
      <CodeFiles files={result?.artifacts} />
    </div>}
  </div>
}
