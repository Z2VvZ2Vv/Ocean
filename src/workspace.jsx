import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, EllipsisVertical, ExternalLink, LoaderCircle, Menu, Pencil, RotateCw, SquarePen, Trash2 } from 'lucide-react'
import { Composer, FileChip, IconButton, Modal, ModelControl, Setup, Sidebar } from './ui.jsx'
import { defaultSettings, runChat } from './inference.js'
import { chatTools } from './tools.js'
import { deleteChat, loadWorkspace, saveChat, saveSettings } from './storage.js'

const Markdown = lazy(() => import('./markdown.jsx'))
const emptyAttachments = { images: [], documents: [] }

function Answer({ message, generating, progress }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return <article className="answer">
    <div className="answer-mark"><img src="/ocean.svg" alt="Ocean" /></div>
    <div className="answer-body">
      {generating && <div className="generation-status" role="status"><LoaderCircle className="spinner" size={16} /> {progress}</div>}
      {message.reasoning && <details className="reflection">
        <summary>Réflexion <ChevronDown size={14} /></summary>
        <p>{message.reasoning}</p>
      </details>}
      {message.text && <div className="markdown">
        <Suspense fallback={<p>{message.text}</p>}><Markdown text={message.text} /></Suspense>
      </div>}
      {!generating && !!message.sources?.length && <details className="sources">
        <summary>Sources consultées <ChevronDown size={14} /></summary>
        <ul>{message.sources.map(source => <li key={source.url}>
          <a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url} <ExternalLink size={13} /></a>
        </li>)}</ul>
      </details>}
      {!generating && message.text && <div className="answer-actions">
        <IconButton label={copied ? 'Réponse copiée' : 'Copier la réponse'} onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}</IconButton>
      </div>}
    </div>
  </article>
}

function UserMessage({ message }) {
  return <article className="user-message" aria-label="Ton message">
    {!!message.images?.length && <div className="user-images">
      {message.images.map(image => <img key={image.id} src={image.url} alt={image.name} />)}
    </div>}
    {!!message.documents?.length && <div className="user-files">
      {message.documents.map(file => <FileChip key={file.id} file={file} />)}
    </div>}
    {message.text && <div className="user-bubble">{message.text}</div>}
  </article>
}

export function Workspace({ user, searchEnabled, onSignOut, theme, onThemeChange }) {
  const [settings, setSettings] = useState(defaultSettings)
  const [chats, setChats] = useState([])
  const [activeId, setActiveId] = useState('')
  const [sideOpen, setSideOpen] = useState(() => matchMedia('(min-width: 850px)').matches)
  const [ready, setReady] = useState(false)
  const [setup, setSetup] = useState('')
  const [menu, setMenu] = useState('')
  const [dialog, setDialog] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState(emptyAttachments)
  const [reading, setReading] = useState(false)
  const [learning, setLearning] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(null)
  const [live, setLive] = useState(null)
  const [progress, setProgress] = useState('')
  const request = useRef(null)
  const attachmentRead = useRef(null)
  const transcript = useRef(null)
  const follow = useRef(true)
  const activeChat = chats.find(chat => chat.id === activeId)
  const busy = live !== null
  const messages = live ? [...(activeChat?.messages || []), live] : activeChat?.messages

  useEffect(() => {
    let active = true
    loadWorkspace(user.id).then(([savedSettings, savedChats]) => {
      if (!active) return
      if (savedSettings) setSettings({ ...defaultSettings, ...savedSettings })
      else setSetup('onboarding')
      setChats(savedChats.sort((a, b) => b.updatedAt - a.updatedAt))
    }).catch(() => { if (active) setError('Impossible de lire l’historique local du navigateur.') })
      .finally(() => { if (active) setReady(true) })
    return () => {
      active = false
      attachmentRead.current?.abort()
      attachmentRead.current = null
      request.current?.abort()
    }
  }, [user.id])

  useEffect(() => {
    if (!menu) return
    const close = event => { if (!event.target.closest('[data-menu]')) setMenu('') }
    const escape = event => { if (event.key === 'Escape') setMenu('') }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [menu])

  useEffect(() => {
    if (follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight
  }, [activeId, activeChat?.messages, live, progress, error])

  function storageError() { setError('Le navigateur n’a pas pu enregistrer les données localement.') }

  function storeChat(chat) {
    setChats(current => [chat, ...current.filter(other => other.id !== chat.id)].sort((a, b) => b.updatedAt - a.updatedAt))
    void saveChat(user.id, chat).catch(storageError)
  }

  function changeSettings(changes) {
    const next = { ...settings, ...changes }
    setSettings(next)
    void saveSettings(user.id, next).catch(storageError)
  }

  function changeLearning(enabled) {
    setLearning(enabled)
    if (activeChat) storeChat({ ...activeChat, learning: enabled })
  }

  async function attach(read) {
    if (request.current || attachmentRead.current) return false
    const controller = new AbortController()
    attachmentRead.current = controller
    setReading(true)
    setError('')
    try {
      const next = await read(attachments, controller.signal)
      if (controller.signal.aborted) return false
      setAttachments(next)
      return true
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem.message)
      return false
    } finally {
      if (attachmentRead.current === controller) {
        attachmentRead.current = null
        setReading(false)
      }
    }
  }

  function openSettings() {
    setMenu('')
    setSetup('settings')
    if (matchMedia('(max-width: 849px)').matches) setSideOpen(false)
  }

  function openChat(id = '') {
    if (request.current || id && id === activeId) return
    const chat = chats.find(item => item.id === id)
    follow.current = true
    setActiveId(id)
    setLearning(Boolean(chat?.learning))
    setValue('')
    attachmentRead.current?.abort()
    attachmentRead.current = null
    setReading(false)
    setAttachments(emptyAttachments)
    setError('')
    setRetry(null)
    setMenu('')
    if (matchMedia('(max-width: 849px)').matches) setSideOpen(false)
  }

  async function generate(chat) {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    follow.current = true
    const blank = { id: crypto.randomUUID(), role: 'assistant', text: '', reasoning: '' }
    let latest = blank
    setLive(blank)
    setProgress('Ocean réfléchit…')
    setError('')
    setRetry(null)
    try {
      const response = await runChat({
        config: settings, messages: chat.messages, learning: chat.learning,
        tools: chatTools(searchEnabled), signal: controller.signal,
        onUpdate: update => {
          latest = { ...blank, ...update, reasoning: chat.learning ? '' : update.reasoning }
          setLive(latest)
        },
        onTool: tool => setProgress(`${tool}…`),
      })
      storeChat({ ...chat, messages: [...chat.messages, { ...blank, ...response, reasoning: chat.learning ? '' : response.reasoning }], updatedAt: Date.now() })
    } catch (problem) {
      if (latest.text.trim()) storeChat({ ...chat, messages: [...chat.messages, latest], updatedAt: Date.now() })
      if (!controller.signal.aborted) setError(problem.message || 'La génération a échoué.')
      setRetry(chat)
    } finally {
      setLive(null)
      request.current = null
    }
  }

  function submit() {
    const text = value.trim()
    const { images, documents } = attachments
    if (request.current || attachmentRead.current || !ready || (!text && !images.length && !documents.length)) return
    const title = (text || documents[0]?.name || 'Capture d’écran').replace(/\s+/g, ' ').slice(0, 54)
    const chat = activeChat || { id: crypto.randomUUID(), title, messages: [] }
    const message = { id: crypto.randomUUID(), role: 'user', text, ...attachments }
    const next = { ...chat, learning, updatedAt: Date.now(), messages: [...chat.messages, message] }
    setActiveId(next.id)
    storeChat(next)
    setValue('')
    setAttachments(emptyAttachments)
    setMenu('')
    void generate(next)
  }

  function retryResponse() {
    if (attachmentRead.current) return
    const chat = { ...retry, learning }
    storeChat(chat)
    void generate(chat)
  }

  function handleDialog(event) {
    event.preventDefault()
    if (dialog === 'rename') {
      if (!titleDraft.trim()) return
      storeChat({ ...activeChat, title: titleDraft.trim() })
    } else {
      setChats(current => current.filter(chat => chat.id !== activeId))
      void deleteChat(user.id, activeId).catch(storageError)
      openChat()
    }
    setDialog('')
  }

  async function signOut() {
    try {
      request.current?.abort()
      await onSignOut()
    } catch {
      setError('Impossible de te déconnecter. Réessaie.')
    }
  }

  const modelProps = { settings, changeSettings, openSettings, busy: busy || !ready, menu, setMenu }
  return <div className={`workspace ${sideOpen ? 'nav-open' : ''}`}>
    <Sidebar user={user} open={sideOpen} toggle={() => setSideOpen(!sideOpen)}
      chats={chats} activeId={activeId} onNew={() => openChat()} onOpen={openChat} onSettings={openSettings}
      onSignOut={signOut} busy={busy} menu={menu} setMenu={setMenu} />
    {sideOpen && <button className="mobile-overlay" type="button" aria-label="Réduire le menu" onClick={() => setSideOpen(false)} />}
    <main className={`stage ${activeChat ? 'conversation' : 'home'}`}>
      {!activeChat && <div className="halo" />}
      <header className="stage-header">
        <IconButton label="Ouvrir le menu" className="mobile-header-control" onClick={() => setSideOpen(!sideOpen)} aria-expanded={sideOpen}><Menu size={23} /></IconButton>
        <ModelControl {...modelProps} inHeader />
        <IconButton label="Nouvelle discussion" className="mobile-header-control header-new-chat" onClick={() => openChat()} disabled={busy}><SquarePen size={21} /></IconButton>
        {activeChat && <div className="chat-menu-control" data-menu>
          <IconButton label="Options de la discussion" onClick={() => setMenu(menu === 'chat' ? '' : 'chat')} aria-expanded={menu === 'chat'} disabled={busy}><EllipsisVertical size={21} /></IconButton>
          {menu === 'chat' && <div className="popover chat-menu">
            <button type="button" className="menu-row" onClick={() => { setTitleDraft(activeChat.title); setDialog('rename'); setMenu('') }}><Pencil size={16} /> Renommer</button>
            <button type="button" className="menu-row danger-text" onClick={() => { setDialog('delete'); setMenu('') }}><Trash2 size={16} /> Supprimer</button>
          </div>}
        </div>}
      </header>
      {activeChat && <div ref={transcript} className="transcript" onScroll={event => {
        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
        follow.current = scrollHeight - scrollTop - clientHeight < 90
      }}>
        <div className="messages">
          {messages.map(message => message.role === 'user'
            ? <UserMessage key={message.id} message={message} />
            : <Answer key={message.id} message={message} generating={message.id === live?.id} progress={progress} />)}
          {!busy && <p className="mobile-disclaimer">Ocean peut se tromper. Pense à vérifier ses réponses.</p>}
        </div>
      </div>}
      <div className="composer-dock">
        {!activeChat && <h1>{learning ? 'Qu’aimerais-tu apprendre ?' : 'Par quoi commencer ?'}</h1>}
        {error && <div className="chat-error" role="alert">{error}</div>}
        {retry && !busy && <button type="button" className="retry-button" onClick={retryResponse} disabled={reading}><RotateCw size={15} /> Réessayer</button>}
        {ready ? <Composer value={value} setValue={setValue} attachments={attachments} setAttachments={setAttachments}
          onAttach={attach} reading={reading} learning={learning} setLearning={changeLearning} onSubmit={submit}
          onStop={() => request.current?.abort()} busy={busy} menu={menu} setMenu={setMenu} modelControl={<ModelControl {...modelProps} />} />
          : <LoaderCircle className="spinner" size={22} aria-label="Chargement" />}
      </div>
      {activeChat && <footer className="chat-footer">Ocean peut se tromper. Pense à vérifier ses réponses.</footer>}
    </main>
    {setup && <Setup settings={settings} initial={setup === 'onboarding'} theme={theme} onThemeChange={onThemeChange} onSave={next => { changeSettings(next); setSetup('') }}
      onClose={() => { if (setup === 'onboarding') changeSettings(settings); setSetup('') }} />}
    {dialog && <Modal title={dialog === 'rename' ? 'Renommer la discussion' : 'Supprimer la discussion ?'} onClose={() => setDialog('')}>
      <form className="confirm-form" onSubmit={handleDialog}>
        <h2>{dialog === 'rename' ? 'Renommer la discussion' : 'Supprimer la discussion ?'}</h2>
        {dialog === 'rename'
          ? <input aria-label="Titre" autoFocus required maxLength={120} value={titleDraft} onChange={event => setTitleDraft(event.target.value)} />
          : <p className="muted">« {activeChat.title} » sera supprimée de ce navigateur.</p>}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={() => setDialog('')}>Annuler</button>
          <button className={dialog === 'rename' ? 'primary-button' : 'delete-button'} type="submit">{dialog === 'rename' ? 'Enregistrer' : 'Supprimer'}</button>
        </div>
      </form>
    </Modal>}
  </div>
}
