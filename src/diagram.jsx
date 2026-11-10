import { useEffect, useState, useSyncExternalStore } from 'react'
import CodeBlock from './code-block.jsx'

const darkPreference = matchMedia('(prefers-color-scheme: dark)')
const readDark = () => darkPreference.matches
function subscribeDark(listener) {
  darkPreference.addEventListener('change', listener)
  return () => darkPreference.removeEventListener('change', listener)
}

let engine
function loadEngine() {
  engine ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', htmlLabels: false, suppressErrorRendering: true,
      maxTextSize: 12000, maxEdges: 100,
    })
    return mermaid
  })
  return engine
}

export default function Diagram({ source, theme }) {
  const systemDark = useSyncExternalStore(subscribeDark, readDark)
  const dark = theme === 'dark' || theme === 'system' && systemDark
  const [result, setResult] = useState(null)

  useEffect(() => {
    let active = true
    async function render() {
      try {
        const definition = source.trim()
        if (!definition || definition.length > 12000 || /^---(?:\r?\n|$)|%%\s*\{|\b(?:img|icon)\s*:/im.test(definition)) {
          throw new Error('Diagramme non pris en charge.')
        }
        const mermaid = await loadEngine()
        if (!active) return
        const config = `---\nconfig:\n  theme: ${dark ? 'dark' : 'default'}\n---\n`
        const { svg } = await mermaid.render(`ocean-${crypto.randomUUID()}`, config + definition)
        if (active) setResult({ url: `data:image/svg+xml,${encodeURIComponent(svg)}` })
      } catch {
        if (active) setResult({ error: 'Ocean n’a pas pu afficher ce schéma.' })
      }
    }
    void render()
    return () => { active = false }
  }, [source, dark])

  if (!result) return <p className="small" role="status">Préparation du schéma…</p>
  return <figure className="diagram">
    {result.url && <img src={result.url} alt="Schéma généré par Ocean" />}
    {result.error && <figcaption className="small">{result.error}</figcaption>}
    <details open={result.error ? true : undefined}>
      <summary>Code du schéma</summary>
      <CodeBlock source={source} language="Mermaid" />
    </details>
  </figure>
}
