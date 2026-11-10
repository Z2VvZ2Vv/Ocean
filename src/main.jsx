import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LoaderCircle } from 'lucide-react'
import '@fontsource-variable/google-sans'
import './styles.css'
import { Workspace } from './workspace.jsx'
import { Brand } from './ui.jsx'

async function auth(action, credential) {
  const options = action ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, credential }),
  } : { cache: 'no-store' }
  const response = await fetch('/api/auth', options)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Connexion indisponible.')
  return data
}

let googleScript
function loadGoogle() {
  return googleScript ||= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve(window.google.accounts.id)
    script.onerror = () => reject(new Error('Impossible de charger la connexion Google.'))
    document.head.append(script)
  })
}

function SignIn({ session, onSignIn, onPreview, error, theme }) {
  const button = useRef(null)
  const [signInError, setError] = useState('')
  const [working, setWorking] = useState(false)
  const callback = useRef(onSignIn)
  callback.current = onSignIn
  useEffect(() => {
    if (!session?.clientId) return
    let active = true
    let renderButton
    const system = matchMedia('(prefers-color-scheme: dark)')
    loadGoogle().then(google => {
      if (!active) return
      google.initialize({
        client_id: session.clientId,
        nonce: session.nonce,
        callback: async ({ credential }) => {
          setWorking(true)
          setError('')
          try { callback.current(await auth('login', credential)) }
          catch (problem) { setError(problem.message) }
          finally { setWorking(false) }
        },
      })
      renderButton = () => {
        const dark = theme === 'dark' || (theme === 'system' && system.matches)
        button.current.replaceChildren()
        google.renderButton(button.current, {
          type: 'standard',
          theme: dark ? 'outline_dark' : 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          locale: 'fr',
        })
      }
      renderButton()
      if (theme === 'system') system.addEventListener('change', renderButton)
    }).catch(problem => { if (active) setError(problem.message) })
    return () => {
      active = false
      if (renderButton) system.removeEventListener('change', renderButton)
    }
  }, [session, theme])

  return <div className="signin">
    <header><Brand /></header>
    <main className="signin-center">
      <div className="signin-content">
        <img className="signin-star" src="/ocean.svg" alt="" />
        <h1>Bienvenue sur Ocean</h1>
        <p className="signin-lead">Ton assistant IA local.</p>
        <div className="signin-actions">
          <div className="google-button" ref={button} />
          {!session && !error && <LoaderCircle className="spinner" size={22} aria-label="Chargement" />}
          {working && <p className="small" role="status">Connexion en cours…</p>}
          {session && !session.clientId && <p className="small">La connexion Google reste à configurer.</p>}
          {(error || signInError) && <p className="error" role="alert">{error || signInError}</p>}
        </div>
        {import.meta.env.DEV && <button className="secondary-button" onClick={onPreview}>Ouvrir l’aperçu local</button>}
      </div>
    </main>
  </div>
}

function savedTheme() {
  try {
    const value = localStorage.getItem('ocean-theme')
    if (value === 'light' || value === 'dark') return value
  } catch {}
  return 'system'
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  const dark = theme === 'dark' || theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches
  document.querySelector('meta[name="theme-color"]').content = dark ? '#000000' : '#faf8f8'
}

function App() {
  const [session, setSession] = useState(null)
  const [error, setError] = useState('')
  const [theme, setTheme] = useState(savedTheme)
  useEffect(() => { auth().then(setSession).catch(() => setError('Le service de connexion est inaccessible.')) }, [])
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)')
    const update = () => applyTheme(theme)
    update()
    system.addEventListener('change', update)
    return () => system.removeEventListener('change', update)
  }, [theme])

  function changeTheme(value) {
    applyTheme(value)
    setTheme(value)
    try { localStorage.setItem('ocean-theme', value) } catch {}
  }

  async function signOut() {
    if (!session.preview) await auth('logout')
    setSession(await auth())
  }

  if (session?.user) return <Workspace key={session.user.id} user={session.user} searchEnabled={session.search} sandboxEnabled={session.codeSandbox} onSignOut={signOut}
    theme={theme} onThemeChange={changeTheme} />
  return <SignIn session={session} error={error} onSignIn={setSession} theme={theme}
    onPreview={() => setSession({ preview: true, user: { id: 'ocean-local-preview', name: 'Geoff' } })} />
}

applyTheme(savedTheme())
createRoot(document.getElementById('root')).render(<App />)
