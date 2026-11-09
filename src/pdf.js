import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist'
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

const imageOperations = new Set([
  OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup,
  OPS.paintImageMaskXObjectRepeat,
])

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

export async function readPdf(file, imageLimit, textLimit, signal) {
  const task = getDocument({
    data: await file.arrayBuffer(),
    useWorkerFetch: false,
    BinaryDataFactory: PdfAssets,
    stopAtErrors: true,
    maxImageSize: 32_000_000,
  })
  try {
    const pdf = await task.promise
    if (pdf.numPages > 100) throw new Error('Le PDF dépasse 100 pages. Exporte les pages utiles dans un fichier plus court.')
    const parts = []
    const pageImages = []
    let length = 0
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted()
      const page = await pdf.getPage(number)
      try {
        const { items } = await page.getTextContent()
        const text = items.map(item => typeof item.str === 'string'
          ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim()
        if (text) {
          const part = `Page ${number}\n${text}`
          length += part.length + 2
          if (length > textLimit) throw new Error('Les pièces jointes contiennent trop de texte. Essaie avec un extrait.')
          parts.push(part)
        } else {
          const { fnArray } = await page.getOperatorList()
          if (!fnArray.some(operation => imageOperations.has(operation))) continue
          if (pageImages.length >= imageLimit) {
            throw new Error('Trop de pages scannées ou d’images pour ce message. Joins moins de pages à la fois.')
          }
          pageImages.push({ number, url: await renderPage(page) })
        }
      } finally {
        page.cleanup()
      }
    }
    return { text: parts.join('\n\n'), pageCount: pdf.numPages, pageImages }
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('Ce PDF est protégé par un mot de passe.')
    if (error.name === 'InvalidPDFException') throw new Error('Ce PDF est illisible ou endommagé.')
    throw error
  } finally {
    await task.destroy()
  }
}
