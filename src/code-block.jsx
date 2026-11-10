import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, LoaderCircle, Pencil, Play, RotateCcw, Settings2, Square } from 'lucide-react'
import highlight from 'highlight.js/lib/common'
import { codeLanguage, codeLimit, codePhases, inputLimit, programReadsInput, runCode, sendCodeInput } from './code.js'
import CodeFiles from './code-files.jsx'

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
  const [terminalSession, setTerminalSession] = useState('')
  const [terminalOutput, setTerminalOutput] = useState('')
  const [line, setLine] = useState('')
  const [sending, setSending] = useState(false)
  const [inputError, setInputError] = useState('')
  const [draft, setDraft] = useState(null)
  const [editing, setEditing] = useState(false)
  const request = useRef(null)
  const pendingInput = useRef(null)
  const terminalInput = useRef(null)
  const program = draft ?? source
  const missingInput = !input && programReadsInput(language, program)
  const runnable = Boolean(target && program.trim() && program.length <= codeLimit)
  const terminalReady = running && terminalSession && phase === 'running'
  const visibleOutput = terminalOutput || result?.output

  useEffect(() => () => request.current?.abort(), [])

  const markup = useMemo(() => {
    if (generating || editing || !grammar || !highlight.getLanguage(grammar) || program.length > 24000) return null
    return highlight.highlight(program, { language: grammar, ignoreIllegals: true }).value
  }, [program, grammar, generating, editing])

  function edit(value) {
    setDraft(value === source ? null : value)
    setCopied(false)
    setResult(null)
    setTerminalOutput('')
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(program)
      setCopied(true)
    } catch { setCopied(false) }
  }

  async function execute(interactive = false) {
    if (request.current || !runnable) return
    const controller = new AbortController()
    request.current = controller
    setOptionsOpen(false)
    setPhase('')
    setRunning(true)
    setResult(null)
    setTerminalSession('')
    setTerminalOutput('')
    setLine('')
    setSending(false)
    setInputError('')
    try {
      const packages = dependencies.split(/[,\s]+/).filter(Boolean)
      const terminal = interactive ? {
        onSession: setTerminalSession,
        onOutput: text => setTerminalOutput(current => (current + text).slice(-24000)),
      } : undefined
      setResult(await runCode({ language, code: program, stdin: interactive ? '' : input, packages },
        sandboxEnabled, controller.signal, setPhase, terminal))
    } catch (error) {
      setResult({ error: controller.signal.aborted ? 'Exécution arrêtée.' : error.message || 'L’exécution a échoué.' })
    } finally {
      request.current = null
      setTerminalSession('')
      setRunning(false)
    }
  }

  function start() {
    if (missingInput) {
      if (sandboxEnabled) void execute(true)
      else setOptionsOpen(true)
      return
    }
    void execute()
  }

  async function submitLine(value) {
    const controller = request.current
    if (!controller || !terminalReady || pendingInput.current === controller) return
    pendingInput.current = controller
    setSending(true)
    setInputError('')
    if (value !== null) setTerminalOutput(current => `${current}${value}\n`.slice(-24000))
    try {
      await sendCodeInput(terminalSession, value, controller.signal)
      if (request.current !== controller) return
      if (value === null) setTerminalSession('')
      else {
        setLine('')
        terminalInput.current?.focus()
      }
    } catch (error) {
      if (request.current === controller && !controller.signal.aborted) {
        setInputError(error.message || 'Impossible de confirmer l’envoi de la saisie.')
      }
    } finally {
      if (pendingInput.current === controller) pendingInput.current = null
      if (request.current === controller) setSending(false)
    }
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
      <label>Valeurs préparées à l’avance<textarea autoFocus value={input} maxLength={inputLimit} rows={2}
        placeholder="Une valeur par ligne, selon le programme"
        onChange={event => setInput(event.target.value)} /></label>
      {target.id === 'python' && sandboxEnabled && <label>Paquets PyPI à installer
        <input value={dependencies} maxLength={680} placeholder="numpy, scikit-learn" onChange={event => setDependencies(event.target.value)} />
      </label>}
      <div className="code-input-actions">
        <button className="secondary-button" type="button" onClick={() => setOptionsOpen(false)}>Annuler</button>
        {sandboxEnabled && <button className="secondary-button" type="button" disabled={!runnable} onClick={() => execute(true)}>Lancer en direct</button>}
        {missingInput && <button className="secondary-button" type="button" disabled={!runnable} onClick={() => execute()}>Lancer sans entrée</button>}
        <button className="primary-button" type="submit" disabled={!runnable || missingInput}>Lancer</button>
      </div>
    </form>}
    {(running || result) && <div className="code-result" aria-live="polite">
      {running && !terminalReady && <div className="generation-status" role="status"><LoaderCircle className="spinner" size={15} /> {codePhases.get(phase) || 'Exécution en cours'}…</div>}
      {result?.error && <p className="error">{result.error}</p>}
      {!!result?.artifactWarnings?.length && <ul className="artifact-warnings small">
        {result.artifactWarnings.map((warning, index) => <li key={index}>{warning}</li>)}
      </ul>}
      {visibleOutput && <pre aria-label="Sortie du programme">{visibleOutput}</pre>}
      {terminalReady && <form className="code-terminal" onSubmit={event => {
        event.preventDefault()
        void submitLine(line)
      }}>
        <input ref={terminalInput} aria-label="Réponse au programme" autoFocus autoComplete="off" placeholder="Ta réponse au programme"
          maxLength={inputLimit} readOnly={sending} value={line} onChange={event => setLine(event.target.value)} />
        <button type="submit" className="primary-button" disabled={sending}>Envoyer</button>
        <button type="button" className="secondary-button" disabled={sending} onClick={() => submitLine(null)}>Fin de saisie</button>
      </form>}
      {terminalReady && inputError && <p className="error">{inputError}</p>}
      {result && !visibleOutput && !result.error && !result.artifacts?.length && <p className="small">Exécution terminée, sans sortie.</p>}
      <CodeFiles files={result?.artifacts} />
    </div>}
  </div>
}
