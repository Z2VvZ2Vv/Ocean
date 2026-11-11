import { createElement, useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from './remark-latex-math.js'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { IconButton, Modal } from './ui.jsx'
import { embeddedFileUrl, formatFileSize, previewFormat, readFilePreview } from './preview-data.js'
import { previewMathParts } from './preview-math.js'

const documentTags = new Set('a b blockquote br caption code dd div dl dt em h1 h2 h3 h4 h5 h6 hr i img li ol p pre s span strong sub sup table tbody td th thead tr u ul'.split(' '))
const markdownElements = {
  a: ({ children }) => <span>{children}</span>,
  img: ({ alt }) => <span>{alt}</span>,
}

function readDocumentNodes(content, imageUrls) {
  let remaining = 6000
  function read(node, key, depth, literal = false) {
    if (depth > 40 || --remaining < 0) return null
    if (node.nodeType === 3) return literal ? node.textContent : previewMathParts(node.textContent).map((part, index) => (
      part.html ? <span key={index} className={part.display ? 'preview-math-block' : 'preview-math'} dangerouslySetInnerHTML={{ __html: part.html }} /> : part.text
    ))
    const tag = node.localName
    if (!documentTags.has(tag)) return null
    if (tag === 'img') {
      const src = node.getAttribute('src')
      return imageUrls.includes(src) ? <img key={key} src={src} alt={node.getAttribute('alt') || ''} loading="lazy" /> : null
    }
    if (tag === 'br' || tag === 'hr') return createElement(tag, { key })
    const props = { key }
    if (tag === 'td' || tag === 'th') {
      props.colSpan = Math.min(Number(node.getAttribute('colspan')) || 1, 24)
      props.rowSpan = Math.min(Number(node.getAttribute('rowspan')) || 1, 100)
    }
    const children = Array.from(node.childNodes, (child, index) => read(child, index, depth + 1, literal || tag === 'code' || tag === 'pre'))
    return createElement(tag === 'a' ? 'span' : tag, props, children)
  }
  const nodes = Array.from(content.childNodes, (node, index) => read(node, index, 0))
  return { nodes, truncated: remaining < 0 }
}

function Loading({ children = 'Préparation de l’aperçu…' }) {
  return <p className="preview-status" role="status"><LoaderCircle className="spinner" size={17} /> {children}</p>
}

function PdfPage({ pdf, number, zoom }) {
  const canvas = useRef(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let page, render
    const output = canvas.current
    async function draw() {
      try {
        page = await pdf.getPage(number)
        if (!active) return
        const original = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: 1800 / Math.max(original.width, original.height) })
        output.width = Math.ceil(viewport.width)
        output.height = Math.ceil(viewport.height)
        render = page.render({ canvas: output, viewport })
        await render.promise
        if (active) setReady(true)
      } catch (problem) {
        if (active) setError(problem.message || 'Impossible d’afficher cette page.')
      } finally { page?.cleanup() }
    }
    void draw()
    return () => { active = false; render?.cancel() }
  }, [pdf, number])
  return <>
    {error ? <p className="error" role="alert">{error}</p> : !ready && <Loading>Rendu de la page…</Loading>}
    <canvas ref={canvas} role="img" aria-label={`Page ${number} du PDF`} hidden={!ready} style={{ width: `${zoom}%` }} />
  </>
}

function PdfPreview({ pdf, images = [] }) {
  const [index, setIndex] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [pageInput, setPageInput] = useState(null)
  const pages = pdf?.numPages ?? images.length
  const number = pdf ? index + 1 : images[index].number
  function jump() {
    const page = Number(pageInput)
    if (Number.isInteger(page) && page >= 1 && page <= pages) setIndex(page - 1)
    setPageInput(null)
  }
  return <>
    <div className="preview-toolbar">
      <IconButton label="Page précédente" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={19} /></IconButton>
      {pdf ? <label className="preview-page-control">Page <input aria-label="Numéro de page" type="number" min={1} max={pages}
        value={pageInput ?? number} onChange={event => setPageInput(event.target.value)} onBlur={jump}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); jump() }
        }} /> / {pages}</label> : <span aria-live="polite">Page {number} · {index + 1}/{pages}</span>}
      <IconButton label="Page suivante" disabled={index >= pages - 1} onClick={() => setIndex(index + 1)}><ChevronRight size={19} /></IconButton>
      <div className="preview-zoom">
        <IconButton label="Réduire le zoom" disabled={zoom <= 75} onClick={() => setZoom(zoom - 25)}><Minus size={17} /></IconButton>
        <span aria-live="polite">{zoom} %</span>
        <IconButton label="Agrandir le zoom" disabled={zoom >= 200} onClick={() => setZoom(zoom + 25)}><Plus size={17} /></IconButton>
      </div>
    </div>
    <div className="preview-scroll preview-pages" key={index} tabIndex={0} aria-label={`Aperçu de la page ${number}`}>
      {pdf ? <PdfPage pdf={pdf} number={number} zoom={zoom} />
        : <img src={images[index].url} alt={`Page ${number} du PDF`} style={{ width: `${zoom}%` }} />}
    </div>
  </>
}

function cellText(value) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : String(value ?? '')
}

function ImagePreview({ url, name }) {
  const [error, setError] = useState(false)
  return error ? <p className="error" role="alert">Impossible d’afficher cette image.</p>
    : <div className="preview-scroll preview-image"><img src={url} alt={name} onError={() => setError(true)} /></div>
}

function TablePreview({ sheets }) {
  const [index, setIndex] = useState(0)
  const sheet = sheets[index]
  return <>
    {sheets.length > 1 && <div className="preview-toolbar">
      <label>Feuille <select aria-label="Feuille du classeur" value={index} onChange={event => setIndex(Number(event.target.value))}>
        {sheets.map((item, position) => <option key={position} value={position}>{item.sheet}</option>)}
      </select></label>
    </div>}
    <div className="preview-scroll" key={index} tabIndex={0} aria-label="Aperçu du tableau">
      {!sheet?.rows.length ? <p className="preview-status">Tableau vide.</p> : <table className="preview-table" aria-label={sheet.sheet || 'Données'}>
        <tbody>{sheet.rows.map((row, position) => <tr key={position}>
          <th scope="row">{position + 1}</th>{row.map((value, column) => <td key={column}>{cellText(value)}</td>)}
        </tr>)}</tbody>
      </table>}
    </div>
    {sheet?.truncated && <p className="preview-status">Aperçu partiel. Le téléchargement contient le tableau complet.</p>}
  </>
}

function ArchivePreview({ blob, onOpenEntry }) {
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [extracting, setExtracting] = useState(false)
  const extraction = useRef(null)
  useEffect(() => {
    const controller = new AbortController()
    import('./archive.js').then(({ listArchive }) => listArchive(blob, offset, controller.signal))
      .then(result => { if (!controller.signal.aborted) setData({ ...result, offset }) })
      .catch(problem => { if (!controller.signal.aborted) setError(problem.message) })
    return () => { controller.abort(); extraction.current?.abort() }
  }, [blob, offset])

  async function open(entry) {
    if (extraction.current) return
    const controller = new AbortController()
    extraction.current = controller
    setExtracting(true)
    setError('')
    try {
      const { extractArchiveEntry } = await import('./archive.js')
      const file = await extractArchiveEntry(blob, entry, controller.signal)
      if (!controller.signal.aborted) onOpenEntry(file)
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem.message)
    } finally {
      extraction.current = null
      if (!controller.signal.aborted) setExtracting(false)
    }
  }

  if (data?.offset !== offset) return error ? <p className="error" role="alert">{error}</p> : <Loading>Lecture de l’archive…</Loading>
  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {extracting && <Loading>Extraction du fichier…</Loading>}
    <div className="preview-scroll" tabIndex={0} aria-label="Contenu de l’archive">
      {!data.entries.length ? <p className="preview-status">L’archive est vide.</p> : <ul className="preview-entries">
        {data.entries.map(entry => <li key={entry.entry}><button className="menu-row" type="button"
          disabled={extracting || entry.encrypted} onClick={() => void open(entry.entry)}>
          <span>{entry.name}</span><small>{entry.encrypted ? 'Protégé' : formatFileSize(entry.bytes)}</small><ChevronRight size={16} />
        </button></li>)}
      </ul>}
    </div>
    {(offset > 0 || data.next_offset !== undefined) && <div className="preview-toolbar">
      <IconButton label="Entrées précédentes" disabled={extracting || offset === 0} onClick={() => { setError(''); setOffset(Math.max(0, offset - 20)) }}><ChevronLeft size={19} /></IconButton>
      <span>Fichiers {offset + 1}–{offset + data.entries.length}</span>
      <IconButton label="Entrées suivantes" disabled={extracting || data.next_offset === undefined} onClick={() => { setError(''); setOffset(data.next_offset) }}><ChevronRight size={19} /></IconButton>
    </div>}
  </>
}

function ActiveFile({ file, goBack, onOpenEntry }) {
  const [state, setState] = useState(null)
  const format = previewFormat(file)
  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const url = file.blob ? URL.createObjectURL(file.blob) : embeddedFileUrl(file)
    let preview
    function dispose() {
      void preview?.close?.()
      preview?.urls?.forEach(image => URL.revokeObjectURL(image))
      preview = null
    }

    async function prepare() {
      setState({ url })
      try {
        if (!url) {
          const images = (file.pageImages || []).filter(page => /^data:image\/(png|jpeg|gif|webp);base64,/i.test(page.url))
          preview = images.length ? { kind: 'pages', images } : { kind: 'text', text: file.text, legacy: true }
        } else if (file.blob?.size > 64 * 1024 * 1024) preview = { kind: 'unsupported', note: 'Aperçu limité à 64 Mio.' }
        else if (format === 'image') preview = { kind: 'image' }
        else {
          const blob = file.blob || await (await fetch(url, { signal })).blob()
          preview = await readFilePreview(blob, format, signal)
          if (preview.kind === 'zip') preview.blob = blob
          if (preview.kind === 'document') {
            Object.assign(preview, readDocumentNodes(preview.content, preview.urls))
            delete preview.content
          }
        }
        if (signal.aborted) dispose()
        else setState({ url, preview })
      } catch (problem) {
        if (!signal.aborted) setState({ url, error: problem.message || 'Impossible de lire le fichier.' })
      }
    }

    void prepare()
    return () => {
      controller.abort()
      dispose()
      if (file.blob) URL.revokeObjectURL(url)
    }
  }, [file, format])

  const bytes = file.size ?? file.blob?.size
  const { url, preview, error } = state || {}
  return <>
    <div className="preview-header">
      {goBack && <IconButton label="Revenir à l’archive" onClick={goBack}><ArrowLeft size={20} /></IconButton>}
      <div><h2>{file.name}</h2><p className="muted">{format.toUpperCase()}{bytes !== undefined ? ` · ${formatFileSize(bytes)}` : ''}</p></div>
    </div>
    {url && <div className="preview-actions"><a href={url} download={file.name} className="secondary-button">
      <ArrowDownToLine size={17} /> Télécharger
    </a></div>}
    {error ? <p className="error" role="alert">{error}</p> : !preview ? <Loading /> : <>
      {preview.kind === 'unsupported' && <p className="preview-status">{preview.note || 'Ce type de fichier est disponible en téléchargement.'}</p>}
      {preview.kind === 'image' && <ImagePreview url={url} name={file.name} />}
      {preview.kind === 'pdf' && <PdfPreview pdf={preview.pdf} />}
      {preview.kind === 'pages' && <><p className="preview-status">Pages conservées dans l’historique.</p><PdfPreview images={preview.images} /></>}
      {preview.kind === 'table' && <TablePreview sheets={preview.sheets} />}
      {preview.kind === 'zip' && <ArchivePreview blob={preview.blob} onOpenEntry={onOpenEntry} />}
      {preview.kind === 'document' && <div className="preview-scroll preview-document" tabIndex={0} aria-label="Aperçu du document">
        {preview.nodes.length ? preview.nodes : <p>Document vide.</p>}
      </div>}
      {preview.kind === 'text' && <div className="preview-scroll" tabIndex={0} aria-label="Aperçu du texte">
        {format === 'md' || format === 'markdown' ? <div className="preview-document">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownElements} skipHtml>{preview.text}</ReactMarkdown>
        </div> : <pre className="preview-text">{preview.text || 'Fichier vide.'}</pre>}
      </div>}
      {preview.legacy && <p className="preview-status">Extrait conservé dans l’historique.</p>}
      {preview.truncated && <p className="preview-status">Aperçu partiel. Le fichier complet reste téléchargeable.</p>}
    </>}
  </>
}

export default function FilePreview({ file, onClose }) {
  const [path, setPath] = useState([])
  const selected = path.at(-1) || file
  return <Modal title={`Aperçu de ${selected.name}`} onClose={onClose} className="file-preview">
    <ActiveFile key={path.length} file={selected} onOpenEntry={entry => setPath([...path, entry])}
      goBack={path.length ? () => setPath(path.slice(0, -1)) : undefined} />
  </Modal>
}
