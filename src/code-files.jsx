export default function CodeFiles({ files }) {
  if (!files?.length) return null
  return <div className="code-files">
    {files.map((file, index) => <figure key={`${file.name}-${index}`}>
      {file.mime.startsWith('image/') && <img src={file.url} alt={file.name} loading="lazy" />}
      <figcaption><a href={file.url} download={file.name}>Télécharger {file.name}</a></figcaption>
    </figure>)}
  </div>
}
