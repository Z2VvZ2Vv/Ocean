import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LoaderCircle } from 'lucide-react'
import '@fontsource-variable/inter'
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

function SignIn({ session, onSignIn, onPreview, error }) {
  const button = useRef(null)
  const [signInError, setError] = useState('')
  const [working, setWorking] = useState(false)
  const callback = useRef(onSignIn)
  callback.current = onSignIn
  useEffect(() => {
    if (!session?.clientId) return
    let active = true
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
      google.renderButton(button.current, { type: 'standard', size: 'large', shape: 'pill', text: 'continue_with', locale: 'fr' })
    }).catch(problem => { if (active) setError(problem.message) })
    return () => { active = false }
  }, [session])

  return <div className="signin">
    <header><Brand /></header>
    <main className="signin-center">
      <div className="halo" />
      <div className="signin-content">
        <img className="signin-star" src="/ocean.svg" alt="" />
        <h1>Bienvenue sur Ocean</h1>
        <p>Connecte-toi pour discuter avec ton IA locale.</p>
        <div className="google-button" ref={button} />
        {!session && !error && <LoaderCircle className="spinner" size={22} aria-label="Chargement" />}
        {working && <p role="status">Connexion en cours…</p>}
        {session && !session.clientId && <p className="small">La connexion Google reste à configurer.</p>}
        {(error || signInError) && <p className="error" role="alert">{error || signInError}</p>}
        {import.meta.env.DEV && <button className="secondary-button" onClick={onPreview}>Ouvrir l’aperçu local</button>}
      </div>
    </main>
    <footer>Ocean · Assistant IA local</footer>
  </div>
}

function App() {
  const [session, setSession] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { auth().then(setSession).catch(() => setError('Le service de connexion est inaccessible.')) }, [])

  async function signOut() {
    if (!session.preview) await auth('logout')
    setSession(await auth())
  }

  if (session?.user) return <Workspace key={session.user.id} user={session.user} searchEnabled={session.search} onSignOut={signOut} />
  return <SignIn session={session} error={error} onSignIn={setSession}
    onPreview={() => setSession({ preview: true, user: { id: 'ocean-local-preview', name: 'Geoff' } })} />
}

createRoot(document.getElementById('root')).render(<App />)
