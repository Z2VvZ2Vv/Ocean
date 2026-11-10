import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

const assetRoot = '/node_modules/pdfjs-dist'
const assetFolders = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' }

class PdfAssets {
  async fetch({ kind, filename }) {
    if (!Object.hasOwn(assetFolders, kind) || !/^[a-z0-9_-]+\.(bcmap|pfb|ttf|wasm)$/i.test(filename)) {
      throw new Error('Ressource PDF invalide.')
    }
    const path = `${assetRoot}/${assetFolders[kind]}/${filename}`
    const url = import.meta.env.DEV ? path : (await import('./pdf-assets.js')).default[path]
    if (!url) throw new Error('Ressource PDF introuvable.')
    const response = await fetch(url)
    if (!response.ok) throw new Error('Ressource PDF inaccessible.')
    return new Uint8Array(await response.arrayBuffer())
  }
}

async function renderPage(page) {
  const original = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: 1600 / Math.max(original.width, original.height) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  try {
    await page.render({ canvas, viewport }).promise
    return canvas.toDataURL('image/jpeg', 0.9)
  } finally {
    canvas.width = canvas.height = 0
  }
}

async function openPdf(file, signal, inspect) {
  signal.throwIfAborted()
  const data = await file.arrayBuffer()
  signal.throwIfAborted()
  const task = getDocument({
    data,
    useWorkerFetch: false,
    BinaryDataFactory: PdfAssets,
    stopAtErrors: true,
    maxImageSize: 32_000_000,
  })
  let cleanup
  const destroy = () => { cleanup ??= task.destroy().catch(() => {}) }
  signal.addEventListener('abort', destroy, { once: true })
  try {
    const pdf = await task.promise
    signal.throwIfAborted()
    return await inspect(pdf)
  } catch (error) {
    signal.throwIfAborted()
    if (error.name === 'PasswordException') throw new Error('Ce PDF est protégé par un mot de passe.')
    if (error.name === 'InvalidPDFException') throw new Error('Ce PDF est illisible ou endommagé.')
    throw error
  } finally {
    signal.removeEventListener('abort', destroy)
    destroy()
    await cleanup
  }
}

export function readPdfPages(file, start, count, offset, signal) {
  return openPdf(file, signal, async pdf => {
    if (start > pdf.numPages) throw new Error(`Ce PDF contient ${pdf.numPages} pages.`)
    const end = Math.min(pdf.numPages, start + count - 1)
    const limit = Math.floor(12000 / (end - start + 1))
    const pages = []
    for (let number = start; number <= end; number++) {
      signal.throwIfAborted()
      const page = await pdf.getPage(number)
      try {
        const { items } = await page.getTextContent()
        const text = items.map(item => typeof item.str === 'string'
          ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim()
        const from = number === start ? offset : 0
        pages.push({
          page: number, text: text.slice(from, from + limit),
          ...(text.length > from + limit && { next_offset: from + limit }),
          ...(!text && { note: 'Aucun texte sélectionnable. Utilise view_attachment pour examiner cette page.' }),
        })
      } finally { page.cleanup() }
    }
    return { page_count: pdf.numPages, pages, ...(end < pdf.numPages && { next_page: end + 1 }) }
  })
}

export function viewPdfPage(file, number, signal) {
  return openPdf(file, signal, async pdf => {
    if (number > pdf.numPages) throw new Error(`Ce PDF contient ${pdf.numPages} pages.`)
    const page = await pdf.getPage(number)
    try { return await renderPage(page) }
    finally { page.cleanup() }
  })
}
