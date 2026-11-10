import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp, BookOpen, Check, ChevronDown, CircleHelp, FileText, LoaderCircle,
  LogOut, Monitor, Moon, Network, PanelLeft, Paperclip, Plus, Search, Settings2, Square, SquarePen, Sun, Trash2, X,
} from 'lucide-react'
import { maxImages, pastedImages } from './clipboard.js'
import { attachmentTypes, imageSlots, readAttachments } from './attachments.js'
import { apiBase, effortLevels, getEffortLevel, listModels, modelName } from './inference.js'

export function Brand() {
  return <span className="brand"><img src="/ocean.svg" alt="" /> Ocean</span>
}

export function IconButton({ label, className = '', children, ...props }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>
}

export function Sidebar({ user, open, toggle, chats, activeId, onNew, onOpen, onDelete, onSettings, onSignOut, busy, menu, setMenu }) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const shownChats = chats.filter(chat => !query || chat.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <aside className={`sidebar ${open ? 'expanded' : ''}`}>
    <div className="sidebar-head">
      {open && <Brand />}
      <IconButton label={open ? 'Réduire le menu' : 'Ouvrir le menu'} className="sidebar-toggle" onClick={toggle} aria-expanded={open}>
        {open ? <PanelLeft size={19} /> : <img src="/ocean.svg" alt="" />}
      </IconButton>
    </div>
    <nav aria-label="Conversations">
      <button className={`nav-button ${activeId ? '' : 'selected'}`} type="button" title="Nouvelle discussion" disabled={busy} onClick={onNew}>
        <SquarePen size={18} />{open && <span>Nouvelle discussion</span>}
      </button>
      <button className={`nav-button ${searching && open ? 'selected' : ''}`} type="button" title="Rechercher des discussions"
        onClick={() => { if (!open) toggle(); setSearching(!open || !searching); setQuery('') }}>
        <Search size={18} />{open && <span>Rechercher des discussions</span>}
      </button>
    </nav>
    {open && <div className="history">
      {searching && <input className="history-search" aria-label="Rechercher des discussions" autoFocus placeholder="Rechercher…" value={query} onChange={event => setQuery(event.target.value)} />}
      <div className="sidebar-caption">{searching ? 'Résultats' : 'Récentes'}</div>
      {shownChats.map(chat => <div key={chat.id} className={`history-row ${activeId === chat.id ? 'selected' : ''}`}>
        <button type="button" className="history-button" aria-current={activeId === chat.id ? true : undefined}
          title={chat.title} disabled={busy && chat.id !== activeId} onClick={() => onOpen(chat.id)}>{chat.title}</button>
        <IconButton label={`Supprimer « ${chat.title} »`} className="history-delete" disabled={busy} onClick={() => onDelete(chat.id)}>
          <Trash2 size={16} />
        </IconButton>
      </div>)}
      {!shownChats.length && <p className="empty-history">{query ? 'Aucun résultat' : 'Aucune discussion pour le moment'}</p>}
    </div>}
    <div className="sidebar-bottom">
      <button type="button" title="Paramètres" className="nav-button" onClick={onSettings} disabled={busy}>
        <Settings2 size={18} />{open && <span>Paramètres</span>}
      </button>
      <div data-menu className="account">
        <button type="button" title="Compte" aria-label="Compte" className="account-button" onClick={() => setMenu(menu === 'account' ? '' : 'account')} aria-expanded={menu === 'account'}>
          {user.avatar ? <img className="avatar" src={user.avatar} referrerPolicy="no-referrer" alt="" /> : <span className="avatar">{user.name[0]?.toUpperCase()}</span>}
          {open && <span className="account-label"><strong>{user.name.split(' ')[0]}</strong><small>IA locale</small></span>}
        </button>
        {menu === 'account' && <div className="popover account-menu">
          <div className="menu-account-name"><strong>{user.name}</strong>{user.email && <small>{user.email}</small>}</div>
          <button type="button" className="menu-row" onClick={onSignOut}><LogOut size={17} /> Se déconnecter</button>
        </div>}
      </div>
    </div>
  </aside>
}

export function FileChip({ file, onRemove }) {
  const pages = file.pageCount === 1 ? ' · 1 page' : file.pageCount ? ` · ${file.pageCount} pages` : ''
  return <div className="file-chip" title={file.name}>
    <span className="file-symbol"><FileText size={19} /></span>
    <span className="file-label">
      <strong>{file.name}</strong>
      <small>{file.format}{pages}{file.pageImages?.length ? ' · Vision' : ''}</small>
    </span>
    {onRemove && <IconButton label={`Retirer ${file.name}`} onClick={onRemove}><X size={15} /></IconButton>}
  </div>
}

export function Composer({
  value, setValue, attachments, setAttachments, onAttach, reading, learning, setLearning,
  onSubmit, onStop, busy, menu, setMenu, modelControls,
}) {
  const { images, documents } = attachments
  const field = useRef(null)
  const fileInput = useRef(null)
  useEffect(() => {
    const input = field.current
    input.style.height = '0'
    input.style.height = `${Math.min(input.scrollHeight, 168)}px`
  }, [value, images.length, documents.length, learning, reading])

  function focus() { field.current?.focus() }
  function toggle(id) { setMenu(menu === id ? '' : id) }
  async function attach(read) {
    if (await onAttach(read)) focus()
  }

  function attachFiles(files) {
    if (files.length && !busy && !reading) void attach((current, signal) => readAttachments(files, current, signal))
  }

  function paste(event) {
    if (reading) { event.preventDefault(); return }
    const pending = pastedImages(event.clipboardData, imageSlots(attachments))
    if (!pending) return
    event.preventDefault()
    void attach(async current => {
      const added = await pending
      if (!added.length) throw new Error(`Jusqu’à ${maxImages} images ou pages scannées par message.`)
      return { ...current, images: [...current.images, ...added] }
    })
  }

  function remove(type, id) {
    setAttachments(current => ({ ...current, [type]: current[type].filter(item => item.id !== id) }))
  }

  const hasAttachments = images.length > 0 || documents.length > 0
  const multiline = value.includes('\n') || value.length > 45 || hasAttachments || learning || reading
  return <form className={`composer ${multiline ? 'multiline' : ''}`} onSubmit={event => { event.preventDefault(); onSubmit() }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
    onDrop={event => {
      if (!event.dataTransfer.files.length) return
      event.preventDefault()
      attachFiles([...event.dataTransfer.files])
    }}>
    <input ref={fileInput} type="file" aria-label="Ajouter des fichiers" accept={attachmentTypes} multiple hidden
      onChange={event => {
        const files = [...event.target.files]
        event.target.value = ''
        attachFiles(files)
      }} />
    {(hasAttachments || reading) && <div className="draft-attachments">
      {images.map(image => <div className="draft-image" key={image.id}>
        <img src={image.url} alt={image.name} />
        <IconButton label={`Retirer ${image.name}`} disabled={reading} onClick={() => remove('images', image.id)}><X size={14} /></IconButton>
      </div>)}
      {documents.map(file => <FileChip key={file.id} file={file} onRemove={reading ? undefined : () => remove('documents', file.id)} />)}
      {reading && <span className="attachment-status" role="status"><LoaderCircle size={16} className="spinner" /> Lecture des fichiers…</span>}
    </div>}
    <div className="composer-tools" data-menu>
      <IconButton label="Ajouter ou choisir un outil" aria-expanded={menu === 'tools'} onClick={() => toggle('tools')} disabled={busy || reading}><Plus size={23} /></IconButton>
      {learning && <button className="learning-chip" type="button" title="Désactiver l’apprentissage guidé" onClick={() => setLearning(false)} disabled={busy}>
        <BookOpen size={15} /> Apprentissage <X size={13} />
      </button>}
      {menu === 'tools' && <div className="popover tools-menu">
        <button type="button" className="menu-row" onClick={() => { setMenu(''); fileInput.current.click() }}>
          <Paperclip size={18} /> Ajouter des fichiers
        </button>
        <button type="button" className="menu-row" onClick={() => { setLearning(!learning); setMenu(''); focus() }}>
          <BookOpen size={18} /> Apprentissage guidé {learning && <Check className="menu-check" size={16} />}
        </button>
      </div>}
    </div>
    <textarea ref={field} aria-label={learning ? 'Que veux-tu apprendre ?' : 'Demander à Ocean'}
      placeholder={learning ? 'Que veux-tu apprendre ?' : 'Demander à Ocean'}
      rows={1} value={value} onChange={event => setValue(event.target.value)} onPaste={paste} disabled={busy}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          onSubmit()
        }
      }} />
    <div className="composer-actions">
      {modelControls}
      {busy ? <IconButton label="Arrêter la génération" className="send-button" onClick={onStop}><Square size={14} fill="currentColor" /></IconButton>
        : <button className="icon-button send-button" type="submit" aria-label="Envoyer" title="Envoyer" disabled={reading || (!value.trim() && !hasAttachments)}><ArrowUp size={21} /></button>}
    </div>
  </form>
}

export function ModelControl({ settings, changeSettings, openSettings, busy, menu, setMenu, inHeader = false }) {
  const availableModels = settings.models.length ? settings.models : [settings.model]
  const menuId = inHeader ? 'header-model' : 'model'
  return <div className={`model-control ${inHeader ? 'header-model' : 'composer-model'}`} data-menu>
    <button className="model-button" type="button" aria-label="Choisir le modèle" aria-expanded={menu === menuId}
      onClick={() => setMenu(menu === menuId ? '' : menuId)} disabled={busy}>
      {inHeader && <strong>Ocean</strong>} <span>{modelName(settings.model)}</span> <ChevronDown size={16} />
    </button>
    {menu === menuId && <div className="popover model-menu">
      <div className="menu-heading">Modèle local</div>
      {availableModels.map(model => <button type="button" className="menu-row" key={model} title={model}
        onClick={() => { changeSettings({ model }); setMenu('') }}>
        <span className="model-option">{modelName(model)}{model !== modelName(model) && availableModels.length > 1 && <small>{model}</small>}</span>
        {settings.model === model && <Check className="menu-check" size={16} />}
      </button>)}
      <div className="menu-divider" />
      <button type="button" className="menu-row" onClick={openSettings}><Settings2 size={17} /> Paramètres</button>
    </div>}
  </div>
}

export function EffortControl({ settings, changeSettings, busy, menu, setMenu }) {
  const trigger = useRef(null)
  const selected = getEffortLevel(settings.effort)
  const expanded = menu === 'effort'

  function select(id) {
    changeSettings({ effort: id })
    setMenu('')
    trigger.current?.focus()
  }

  return <div data-menu onKeyDown={event => { if (expanded && event.key === 'Escape') trigger.current?.focus() }}>
    <button ref={trigger} className="model-button" type="button" aria-label={`Niveau de réflexion : ${selected.label}`}
      aria-expanded={expanded} aria-controls={expanded ? 'effort-options' : undefined}
      onClick={() => setMenu(expanded ? '' : 'effort')} disabled={busy}>
      {selected.label} <ChevronDown size={16} />
    </button>
    {expanded && <div className="popover effort-menu" id="effort-options" role="group" aria-label="Niveau de réflexion">
      {effortLevels.map(level => <button key={level.id} type="button" className="menu-row effort-option"
        aria-pressed={selected.id === level.id} onClick={() => select(level.id)}>
        {selected.id === level.id && <Check size={22} aria-hidden="true" />}
        <span className="effort-option-label">{level.label}<small>{level.description}</small></span>
      </button>)}
    </div>}
  </div>
}

export function Modal({ title, onClose, children, className = '' }) {
  const dialog = useRef(null)
  useEffect(() => { dialog.current.showModal() }, [])
  return <dialog className={`modal ${className}`} ref={dialog} aria-label={title}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <IconButton label="Fermer" className="close-modal" onClick={onClose}><X size={20} /></IconButton>
    {children}
  </dialog>
}

const themes = [
  { value: 'system', label: 'Système', Icon: Monitor },
  { value: 'light', label: 'Clair', Icon: Sun },
  { value: 'dark', label: 'Sombre', Icon: Moon },
]

export function Setup({ settings, initial, theme, onThemeChange, onSave, onClose }) {
  const [draft, setDraft] = useState(settings)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const request = useRef(null)
  useEffect(() => () => request.current?.abort(), [])

  function edit(changes) {
    setDraft(value => ({ ...value, ...changes, models: [], model: value.model || 'Qwen3.8' }))
    setNotice('')
    setError('')
  }

  async function test() {
    setError('')
    setNotice('')
    setTesting(true)
    const controller = new AbortController()
    request.current = controller
    try {
      const models = await listModels(draft, controller.signal)
      const model = models.includes(draft.model) ? draft.model : models.find(id => modelName(id) === 'Qwen3.8') || models[0]
      setDraft({ ...draft, models, model })
      setNotice(models.length === 1 ? '1 modèle détecté' : `${models.length} modèles détectés`)
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem.message)
    } finally {
      if (!controller.signal.aborted) setTesting(false)
    }
  }

  function save(event) {
    event.preventDefault()
    try {
      const endpoint = apiBase(draft.endpoint)
      const model = draft.model.trim()
      if (!model) throw new Error('Choisis un modèle ou saisis son identifiant.')
      onSave({ ...draft, endpoint, model, key: draft.key.trim() })
    } catch (problem) {
      setError(problem.message)
    }
  }

  const title = initial ? 'Choisis ton IA' : 'Paramètres'
  return <Modal title={title} onClose={onClose} className="setup-modal">
    <div className="setup-symbol"><Network size={23} /></div>
    <h2>{title}</h2>
    <p className="muted">Ocean se connecte à ton serveur depuis ce navigateur.</p>
    {!initial && <fieldset className="theme-picker">
      <legend>Apparence</legend>
      <div className="theme-options">
        {themes.map(({ value, label, Icon }) => <button type="button" key={value} aria-pressed={theme === value} onClick={() => onThemeChange(value)}>
          <Icon size={16} /> {label}
        </button>)}
      </div>
    </fieldset>}
    <form className="setup-form" onSubmit={save}>
      <label htmlFor="endpoint">Adresse de l’API locale</label>
      <input id="endpoint" value={draft.endpoint} onChange={event => edit({ endpoint: event.target.value })}
        placeholder="https://machine.ts.net" required disabled={testing} spellCheck={false} />
      <label htmlFor="api-key">Clé de l’API <span>facultative</span></label>
      <input id="api-key" type="password" autoComplete="off" value={draft.key} onChange={event => edit({ key: event.target.value })} disabled={testing} />
      <div className="model-field-heading">
        <label htmlFor="model-id">Modèle</label>
        <button type="button" className="text-button" disabled={testing} onClick={test}>
          {testing && <LoaderCircle size={14} className="spinner" />} {testing ? 'Connexion…' : 'Détecter les modèles'}
        </button>
      </div>
      {draft.models.length
        ? <select id="model-id" value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} disabled={testing}>
          {draft.models.map(model => <option key={model} value={model}>{model}</option>)}
        </select>
        : <input id="model-id" value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} disabled={testing} required spellCheck={false} />}
      <p className="setup-hint"><CircleHelp size={15} /> Détecte les modèles pour récupérer leur identifiant. Les captures nécessitent un modèle compatible vision.</p>
      {notice && <p className="success" role="status"><Check size={15} /> {notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>{initial ? 'Plus tard' : 'Annuler'}</button>
        <button type="submit" className="primary-button" disabled={testing}>{initial ? 'Continuer' : 'Enregistrer'}</button>
      </div>
    </form>
  </Modal>
}
