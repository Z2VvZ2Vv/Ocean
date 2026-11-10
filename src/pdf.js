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

export async function loadPdf(file, signal) {
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
  function close() {
    signal.removeEventListener('abort', close)
    return cleanup ??= task.destroy().catch(() => {})
  }
  signal.addEventListener('abort', close, { once: true })
  try {
    const pdf = await task.promise
    signal.throwIfAborted()
    return { pdf, close }
  } catch (error) {
    await close()
    signal.throwIfAborted()
    if (error.name === 'PasswordException') throw new Error('Ce PDF est protégé par un mot de passe.')
    if (error.name === 'InvalidPDFException') throw new Error('Ce PDF est illisible ou endommagé.')
    throw error
  }
}

async function openPdf(file, signal, inspect) {
  const { pdf, close } = await loadPdf(file, signal)
  try { return await inspect(pdf) }
  finally { await close() }
}

async function readPageText(pdf, number, signal) {
  signal.throwIfAborted()
  const page = await pdf.getPage(number)
  try {
    const { items } = await page.getTextContent()
    signal.throwIfAborted()
    return items.map(item => typeof item.str === 'string'
      ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim()
  } finally { page.cleanup() }
}

export function readSmallPdf(file, maxPages, maxText, signal) {
  return openPdf(file, signal, async pdf => {
    if (pdf.numPages > maxPages) return null
    const pages = []
    let remaining = maxText
    for (let number = 1; number <= pdf.numPages; number++) {
      const text = await readPageText(pdf, number, signal)
      remaining -= text.length
      if (remaining < 0) return null
      pages.push({ page: number, text })
    }
    return pages.some(page => page.text) ? { page_count: pdf.numPages, pages } : null
  })
}

export function readPdfPages(file, start, count, offset, signal) {
  return openPdf(file, signal, async pdf => {
    if (start > pdf.numPages) throw new Error(`Ce PDF contient ${pdf.numPages} pages.`)
    const end = Math.min(pdf.numPages, start + count - 1)
    const limit = Math.floor(12000 / (end - start + 1))
    const pages = []
    for (let number = start; number <= end; number++) {
      const text = await readPageText(pdf, number, signal)
      const from = number === start ? offset : 0
      pages.push({
        page: number, text: text.slice(from, from + limit),
        ...(text.length > from + limit && { next_offset: from + limit }),
        ...(!text && { note: 'Aucun texte sélectionnable. Utilise view_attachment pour examiner cette page.' }),
      })
    }
    return { page_count: pdf.numPages, pages, ...(end < pdf.numPages && { next_page: end + 1 }) }
  })
}

function searchWords(text) {
  return Array.from(text.matchAll(/\p{L}[\p{L}\p{M}]*|\p{N}+/gu), word => ({
    text: word[0].normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase(),
    start: word.index,
    end: word.index + word[0].length,
  }))
}

function findExcerpt(text, wanted) {
  const words = searchWords(text)
  const index = words.findIndex((_, start) => wanted.every((word, offset) => words[start + offset]?.text === word))
  if (index < 0) return null
  const start = Math.max(0, words[index].start - 160)
  const end = Math.min(text.length, words[index + wanted.length - 1].end + 240)
  return `${start ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

export function searchPdf(file, query, start, signal, onProgress) {
  const wanted = searchWords(query).map(word => word.text)
  if (!wanted.length) throw new Error('Indique un mot ou un titre à rechercher.')
  return openPdf(file, signal, async pdf => {
    if (start > pdf.numPages) throw new Error(`Ce PDF contient ${pdf.numPages} pages.`)
    const end = Math.min(pdf.numPages, start + 99)
    const matches = []
    let pagesWithoutText = 0
    let number = start
    for (; number <= end && matches.length < 8; number++) {
      if ((number - start) % 10 === 0) onProgress?.(`Page ${number} sur ${pdf.numPages}`)
      const text = await readPageText(pdf, number, signal)
      if (!text) pagesWithoutText++
      const excerpt = text && findExcerpt(text, wanted)
      if (excerpt) matches.push({ page: number, excerpt })
    }
    return {
      page_count: pdf.numPages,
      searched_from: start,
      searched_to: number - 1,
      matches,
      ...(number <= pdf.numPages && { next_page: number }),
      ...(pagesWithoutText && { pages_without_text: pagesWithoutText }),
      ...(pagesWithoutText === number - start && { note: 'Les pages recherchées sont sans texte sélectionnable. Examine les pages utiles avec view_attachment.' }),
    }
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
