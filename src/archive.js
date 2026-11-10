import { BlobReader, ZipReader } from '@zip.js/zip.js'

const pageSize = 20
const expandedLimit = 32 * 1024 * 1024

async function inspectArchive(blob, signal, visit) {
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false })
  try {
    let index = 0
    for await (const entry of reader.getEntriesGenerator()) {
      signal.throwIfAborted()
      if (entry.directory) continue
      index++
      if (await visit(entry, index)) break
    }
  } finally { await reader.close() }
}

export async function listArchive(blob, offset, signal) {
  const entries = []
  let more = false
  await inspectArchive(blob, signal, (entry, index) => {
    if (index <= offset) return false
    if (entries.length === pageSize) {
      more = true
      return true
    }
    entries.push({ entry: index, name: entry.filename.slice(0, 250), bytes: entry.uncompressedSize, encrypted: entry.encrypted })
    return false
  })
  return { entries, ...(more && { next_offset: offset + pageSize }) }
}

export async function extractArchiveEntry(blob, wanted, signal) {
  let result
  await inspectArchive(blob, signal, async (entry, index) => {
    if (index !== wanted) return false
    if (entry.encrypted) throw new Error('Cette entrée ZIP est protégée par un mot de passe.')
    if (entry.uncompressedSize > expandedLimit) throw new Error('Cette entrée ZIP dépasse 32 Mio après décompression.')

    const chunks = []
    let size = 0
    const stream = new WritableStream({
      write(chunk) {
        size += chunk.byteLength
        if (size > expandedLimit) throw new Error('Cette entrée ZIP dépasse 32 Mio après décompression.')
        chunks.push(chunk.slice())
      },
    })
    await entry.getData(stream, { checkSignature: true, signal })
    const name = entry.filename.split(/[/\\]/).at(-1) || `fichier-${index}`
    result = { name, blob: new Blob(chunks) }
    return true
  })
  if (!result) throw new Error('Entrée introuvable dans cette archive ZIP.')
  return result
}
