import { useEffect, useId, useState } from 'react'
import { Brain, ChevronDown, Clock3, Code2, FilePlus2, FileSearch, FileText, LoaderCircle, Radio, Search, Sparkles, Wrench } from 'lucide-react'

function StepIcon({ label, ...props }) {
  let Icon = Wrench
  if (/^Lecture|^Examen visuel/.test(label)) Icon = FileText
  else if (/^Recherche dans/.test(label)) Icon = FileSearch
  else if (/^Recherche/.test(label)) Icon = Search
  else if (/^Création/.test(label)) Icon = FilePlus2
  else if (/^Exécution|^Compilation|^Préparation de l’environnement/.test(label)) Icon = Code2
  else if (/^Le modèle analyse/.test(label)) Icon = Brain
  else if (/^Rédaction/.test(label)) Icon = Sparkles
  else if (/^Envoi|^En attente/.test(label)) Icon = Radio
  else if (/^Préparation de la demande/.test(label)) Icon = LoaderCircle
  return <Icon {...props} aria-hidden="true" />
}

export default function AnswerActivity({ steps = [], progress, generating }) {
  const [expanded, setExpanded] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const panelId = useId()
  const open = expanded ?? generating
  useEffect(() => {
    if (!generating || !progress) return
    const timer = setInterval(() => setElapsed(Math.floor((performance.now() - progress.startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [generating, progress?.startedAt])
  if (!generating && !steps.length) return null

  const current = generating ? progress?.label || 'Préparation de la demande' : ''
  const history = current && steps.length && current.startsWith(steps.at(-1)) ? steps.slice(0, -1) : steps
  const visible = generating ? history.slice(-4) : history
  const duration = elapsed < 60 ? `${elapsed} s` : `${Math.floor(elapsed / 60)} min ${elapsed % 60} s`
  return <section className="answer-activity" data-running={generating || undefined}>
    <button className="activity-toggle" type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setExpanded(!open)}>
      <span className="activity-emblem"><Sparkles size={15} aria-hidden="true" /></span>
      <span>Activité</span>
      {generating && <span className="activity-badge">En cours</span>}
      {generating && elapsed >= 2 && <span className="activity-duration" aria-hidden="true"><Clock3 size={12} /> {duration}</span>}
      <ChevronDown className="activity-chevron" size={16} aria-hidden="true" />
    </button>
    {open && <div className="activity-panel" id={panelId}>
      <ol className="activity-timeline">
        {visible.map((label, index) => <li key={`${index}-${label}`}>
          <span className="activity-step-icon"><StepIcon label={label} size={15} /></span>
          <span>{label}</span>
        </li>)}
        {generating && <li className="activity-current" role="status">
          <span className="activity-step-icon"><StepIcon label={current} size={15} /></span>
          <span>{current}<span className="activity-dots" aria-hidden="true">…</span></span>
        </li>}
      </ol>
    </div>}
  </section>
}
