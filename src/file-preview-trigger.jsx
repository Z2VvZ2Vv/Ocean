import { lazy, Suspense, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LoaderCircle } from 'lucide-react'
import { canOpenFile } from './preview-data.js'

const FilePreview = lazy(() => import('./file-preview.jsx'))

export default function FilePreviewTrigger({ file, children, className = '' }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef(null)
  if (!canOpenFile(file)) return <span className={className}>{children}</span>
  const label = `Ouvrir l’aperçu de ${file.name}`

  function close() {
    setOpen(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }

  return <>
    <button type="button" ref={trigger} className={className} aria-haspopup="dialog" aria-label={label} title={label}
      onClick={() => setOpen(true)}>{children}</button>
    {open && createPortal(<Suspense fallback={<div className="preview-launch-status" role="status">
      <LoaderCircle className="spinner" size={17} /> Ouverture de l’aperçu…
    </div>}><FilePreview file={file} onClose={close} /></Suspense>, document.body)}
  </>
}
