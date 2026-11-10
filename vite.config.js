import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import auth from './api/auth.js'
import code from './api/code.js'
import search from './api/search.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'ALLOWED_GOOGLE_EMAILS', 'BRAVE_SEARCH_API_KEY', 'OCEAN_CODE_SANDBOX', 'VERCEL_OIDC_TOKEN']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key]
  }

  function mountApi(server) {
    server.middlewares.use('/api/auth', (req, res) => auth(req, res))
    server.middlewares.use('/api/code', (req, res) => code(req, res))
    server.middlewares.use('/api/search', (req, res) => search(req, res))
  }

  return {
    plugins: [react(), { name: 'ocean-api', configureServer: mountApi, configurePreviewServer: mountApi }],
    server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' } },
  }
})
