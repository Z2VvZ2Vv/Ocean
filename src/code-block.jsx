import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, LoaderCircle, Pencil, Play, RotateCcw, Settings2, Square } from 'lucide-react'
import highlight from 'highlight.js/lib/common'
import { codeLanguage, codeLimit, inputLimit, programReadsInput, runCode } from './code.js'
import CodeFiles from './code-files.jsx'

const phases = new Map([
  ['browser', 'Exécution dans le navigateur…'], ['opening', 'Démarrage de la sandbox…'],
  ['setup', 'Préparation de l’environnement…'], ['compiling', 'Compilation…'],
  ['running', 'Exécution du programme…'], ['reading', 'Récupération du résultat…'],
])

export default function CodeBlock({ source, language, generating, sandboxEnabled }) {
  const target = codeLanguage(language)
  const grammar = target?.id || language
  const label = target?.label || language || 'Code'
  const [copied, setCopied] = useState(false)
  const [running, setRunning] = useState(false)
  const [input, setInput] = useState('')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [phase, setPhase] = useState('')
  const [dependencies, setDependencies] = useState('')
  const [result, setResult] = useState(null)
  const [draft, setDraft] = useState(null)
  const [editing, setEditing] = useState(false)
  const request = useRef(null)
  const program = draft ?? source
  const missingInput = !input && programReadsInput(language, program)
  const runnable = Boolean(target && program.trim() && program.length <= codeLimit)

  useEffect(() => () => request.current?.abort(), [])

  const markup = useMemo(() => {
    if (generating || editing || !grammar || !highlight.getLanguage(grammar) || program.length > 24000) return null
    return highlight.highlight(program, { language: grammar, ignoreIllegals: true }).value
  }, [program, grammar, generating, editing])

  function edit(value) {
    setDraft(value === source ? null : value)
    setCopied(false)
    setResult(null)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(program)
      setCopied(true)
    } catch { setCopied(false) }
  }

  async function execute() {
    if (request.current || !runnable) return
    const controller = new AbortController()
    request.current = controller
    setOptionsOpen(false)
    setPhase('')
    setRunning(true)
    setResult(null)
    try {
      const packages = dependencies.split(/[,\s]+/).filter(Boolean)
      setResult(await runCode({ language, code: program, stdin: input, packages }, sandboxEnabled, controller.signal, setPhase))
    } catch (error) {
      setResult({ error: controller.signal.aborted ? 'Exécution arrêtée.' : error.message || 'L’exécution a échoué.' })
    } finally {
      request.current = null
      setRunning(false)
    }
  }

  function start() {
    if (missingInput) {
      setOptionsOpen(true)
      return
    }
    void execute()
  }

  return <div className="code-block">
    <div className="code-bar">
      <span className="code-label">{label}</span>
      <div className="code-actions">
        {target && !generating && <button type="button" disabled={!running && !runnable}
          onClick={running ? () => request.current?.abort() : start}>
          {running ? <Square size={14} /> : <Play size={15} />}{running ? 'Arrêter' : 'Exécuter'}
        </button>}
        {target && !generating && <button type="button" aria-pressed={editing} disabled={running} onClick={() => setEditing(!editing)}>
          {editing ? <Check size={15} /> : <Pencil size={15} />}{editing ? 'Terminer' : 'Modifier'}
        </button>}
        {draft !== null && <button type="button" title="Rétablir le code original" aria-label="Rétablir le code original" disabled={running}
          onClick={() => edit(source)}><RotateCcw size={15} /></button>}
        {target && !generating && <button type="button" title="Options d’exécution" aria-label="Options d’exécution"
          aria-expanded={optionsOpen} disabled={running} onClick={() => setOptionsOpen(!optionsOpen)}><Settings2 size={16} /></button>}
        <button type="button" onClick={copy} aria-label={copied ? 'Code copié' : 'Copier le code'} title={copied ? 'Code copié' : 'Copier le code'}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </div>
    {editing ? <textarea className="code-editor" aria-label={`Modifier le code ${label}`} autoFocus spellCheck={false}
      autoCapitalize="off" autoComplete="off" value={program} disabled={running}
      rows={Math.min(20, Math.max(5, program.split('\n').length + 1))} onChange={event => edit(event.target.value)} />
      : <pre>{markup === null ? <code>{program}</code> : <code dangerouslySetInnerHTML={{ __html: markup }} />}</pre>}
    {target && !generating && program.length > codeLimit && <p className="code-limit small">Réduis le code à {codeLimit.toLocaleString('fr-FR')} caractères pour l’exécuter.</p>}
    {target && !generating && optionsOpen && <form className="code-input" onSubmit={event => {
      event.preventDefault()
      if (!missingInput) void execute()
    }}>
      <label>Valeurs à fournir au programme<textarea autoFocus value={input} maxLength={inputLimit} rows={2}
        onChange={event => setInput(event.target.value)} /></label>
      {target.id === 'python' && sandboxEnabled && <label>Paquets PyPI à installer
        <input value={dependencies} maxLength={680} placeholder="numpy, scikit-learn" onChange={event => setDependencies(event.target.value)} />
      </label>}
      <div className="code-input-actions">
        <button className="secondary-button" type="button" onClick={() => setOptionsOpen(false)}>Annuler</button>
        {missingInput && <button className="secondary-button" type="button" disabled={!runnable} onClick={execute}>Lancer sans entrée</button>}
        <button className="primary-button" type="submit" disabled={!runnable || missingInput}>Lancer</button>
      </div>
    </form>}
    {(running || result) && <div className="code-result" aria-live="polite">
      {running && <div className="generation-status" role="status"><LoaderCircle className="spinner" size={15} /> {phases.get(phase) || 'Exécution en cours…'}</div>}
      {result?.error && <p className="error">{result.error}</p>}
      {result?.output && <pre aria-label="Sortie du programme">{result.output}</pre>}
      {result && !result.output && !result.error && !result.artifacts?.length && <p className="small">Exécution terminée, sans sortie.</p>}
      <CodeFiles files={result?.artifacts} />
    </div>}
  </div>
}
