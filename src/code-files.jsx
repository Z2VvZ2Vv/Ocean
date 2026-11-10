import { ArrowDownToLine, Eye } from 'lucide-react'
import FilePreviewTrigger from './file-preview-trigger.jsx'
import { embeddedFileUrl, previewFormat } from './preview-data.js'

export default function CodeFiles({ files }) {
  if (!files?.length) return null
  return <div className="code-files">
    {files.map((file, index) => {
      const url = embeddedFileUrl(file)
      if (!url) return null
      const image = previewFormat(file) === 'image'
      return <figure key={`${file.name}-${index}`}>
        {image && <FilePreviewTrigger file={file} className="image-preview-trigger">
          <img src={url} alt={file.name} loading="lazy" />
        </FilePreviewTrigger>}
        <figcaption>
          <strong>{file.name}</strong>
          {!image && <FilePreviewTrigger file={file} className="file-action"><Eye size={16} /> Aperçu</FilePreviewTrigger>}
          <a href={url} download={file.name} className="file-action" aria-label={`Télécharger ${file.name}`}>
            <ArrowDownToLine size={16} /> Télécharger
          </a>
        </figcaption>
      </figure>
    })}
  </div>
}
