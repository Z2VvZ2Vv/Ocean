# Ocean

Assistant IA local avec une interface recréée à partir de [Gemini Web dans Mobbin](https://mobbin.com/screens/0540401f-b84d-4661-a885-7bf9205d5d38). Le navigateur envoie les messages et les images directement à l’API du modèle. Les discussions et les réglages sont conservés dans ce navigateur, séparément pour chaque compte Google.

## Démarrer sur ton PC

Avec Node.js 22, lance les commandes suivantes depuis le dossier du projet.

```powershell
npm ci
npm run dev
```

Ouvre http://localhost:5173. Le bouton **Ouvrir l’aperçu local** donne accès à l’interface en développement, avec la même connexion directe au modèle. Pour essayer aussi l’authentification, copie `.env.example` dans `.env.local` et remplis les variables ci-dessous.

## Déployer sur Vercel

1. Pousse ce dossier dans un dépôt Git, puis importe le dépôt dans Vercel. Le projet est configuré pour Vite et Node.js 22.
2. Dans Google Cloud, crée un **ID client OAuth de type Application Web**. Ajoute l’origine exacte de ton site, par exemple `https://ocean-exemple.vercel.app`, aux **origines JavaScript autorisées**. Ajoute aussi `http://localhost:5173` pour le développement. Si le projet Google est en test, ajoute ton compte aux utilisateurs de test.
3. Configure les variables d’environnement dans Vercel, puis lance ou relance le déploiement.

| Variable | Valeur |
| --- | --- |
| `GOOGLE_CLIENT_ID` | ID client OAuth Web se terminant par `.apps.googleusercontent.com`. |
| `SESSION_SECRET` | Secret aléatoire d’au moins 32 octets. Génère-le avec `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. |
| `ALLOWED_GOOGLE_EMAILS` | Facultatif. Adresses autorisées séparées par des virgules. Pour un usage personnel avec la recherche web, ajoute ton adresse afin de limiter l’accès à ton quota. |
| `BRAVE_SEARCH_API_KEY` | Facultatif. Active la recherche web avec Brave. La requête de recherche choisie par le modèle passe par Vercel vers Brave. |

Chaque domaine de preview utilisé avec Google doit être déclaré comme origine JavaScript autorisée. Voir [Google Identity Services](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) et [Vite sur Vercel](https://vercel.com/docs/frameworks/frontend/vite).
