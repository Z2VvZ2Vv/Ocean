const maxBytes = 8 * 1024 * 1024
const allowed = /^image\/(png|jpeg|webp|gif)$/i
const inlineImage = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/]+=*$/i

export const canInlineImage = file => allowed.test(file.type) && file.size <= maxBytes

function fileUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Impossible de lire l’image.'))
    reader.readAsDataURL(file)
  })
}

export async function readImages(files) {
  return Promise.all(files.map(async file => {
    if (!allowed.test(file.type)) throw new Error('Utilise une image PNG, JPEG, WebP ou GIF.')
    if (file.size > maxBytes) throw new Error('Chaque image doit peser au maximum 8 Mo.')
    return { id: crypto.randomUUID(), url: await fileUrl(file), name: file.name || 'Capture d’écran' }
  }))
}

export function pastedImages(clipboard) {
  if (!clipboard) return null
  const items = [...(clipboard.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/'))
  const files = items.map(item => item.getAsFile()).filter(Boolean)
  if (files.length) return readImages(files)
  const fallback = [...(clipboard.files || [])].filter(file => file.type.startsWith('image/'))
  if (fallback.length) return readImages(fallback)
  const html = clipboard.getData('text/html')
  if (html && html.length < maxBytes * 6) {
    const template = document.createElement('template')
    template.innerHTML = html
    const imageTags = template.content.querySelectorAll('img[src]')
    const urls = [...new Set([...imageTags].map(img => img.getAttribute('src')))]
      .filter(url => url.length <= Math.ceil(maxBytes / 3) * 4 + 30 && inlineImage.test(url))
    if (urls.length) return Promise.resolve(urls.map(url => ({ id: crypto.randomUUID(), url, name: 'Capture d’écran' })))
    if (imageTags.length) return Promise.reject(new Error('Le navigateur n’a pas reçu les pixels de l’image. Fais une capture avec Win+Maj+S, puis colle-la.'))
  }
  if (items.length) return Promise.reject(new Error('Le presse-papiers annonce une image, mais le navigateur ne fournit pas ses données.'))
  return null
}
