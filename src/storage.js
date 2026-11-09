const ready = new Promise((resolve, reject) => {
  const request = indexedDB.open('ocean', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('workspace')
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
ready.catch(() => {})

async function access(mode, action) {
  const db = await ready
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', mode)
    const request = action(tx.objectStore('workspace'))
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () => reject(tx.error)
  })
}

export function loadWorkspace(id) {
  return Promise.all([
    access('readonly', store => store.get([id, 'settings'])),
    access('readonly', store => store.getAll(IDBKeyRange.bound([id, 'chat'], [id, 'chat', []]))),
  ])
}

export const saveSettings = (id, settings) => access('readwrite', store => store.put(settings, [id, 'settings']))
export const saveChat = (id, chat) => access('readwrite', store => store.put(chat, [id, 'chat', chat.id]))
export const deleteChat = (id, chatId) => access('readwrite', store => store.delete([id, 'chat', chatId]))
