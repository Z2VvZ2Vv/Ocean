# Ocean

Assistant IA local avec une interface recréée à partir de [Gemini Web dans Mobbin](https://mobbin.com/screens/0540401f-b84d-4661-a885-7bf9205d5d38). Le navigateur envoie les messages, le contenu extrait des fichiers et les images directement à l’API du modèle. Les discussions et les réglages du modèle sont conservés dans ce navigateur, séparément pour chaque compte Google.

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
| `OCEAN_CODE_SANDBOX` | Facultatif. Mets `1` pour l’exécution cloud des programmes, avec `ALLOWED_GOOGLE_EMAILS` renseigné. |

Chaque domaine de preview utilisé avec Google doit être déclaré comme origine JavaScript autorisée. Voir [Google Identity Services](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) et [Vite sur Vercel](https://vercel.com/docs/frameworks/frontend/vite).

## Relier Qwen à Ocean sur Tailscale

Le fichier `Swift-1.5-Qwen3.8-27B-Q8_0.gguf` contient les poids. Une API d’inférence doit le charger et exposer les routes `GET /models` et `POST /chat/completions` depuis son URL de base. Si tu as déjà ce service, ajoute l’origine Ocean à ses origines CORS et saisis l’URL de l’API dans **Paramètres**.

Exemple sur Pop!_OS avec une version récente de llama.cpp, si le fichier GGUF se trouve au chemin indiqué. Adapte les paramètres de contexte et d’accélération à la machine.

```bash
llama-server \
  --model /etc/ajean/models/Swift-1.5-Qwen3.8-27B-Q8_0.gguf \
  --alias Qwen3.8 --host 127.0.0.1 --port 8081 \
  --ctx-size 32768 --jinja --reasoning-format deepseek \
  --cors-origins 'https://ocean-exemple.vercel.app,http://localhost:5173' \
  --cors-headers 'Authorization,Content-Type' --no-cors-credentials
```

Pour analyser les captures, utilise un modèle vision et ajoute son projecteur compatible avec `--mmproj /chemin/vers/mmproj.gguf`. Pour protéger l’API côté modèle, configure une clé llama.cpp (`LLAMA_API_KEY` ou `--api-key-file`) et renseigne-la dans Ocean.

Dans un autre terminal sur Pop!_OS, rends l’API accessible en HTTPS aux appareils du tailnet. Si le port HTTPS 443 est déjà utilisé par Tailscale Serve, choisis un port Serve dédié et ajoute-le à l’URL dans Ocean.

```bash
tailscale serve --bg http://127.0.0.1:8081
```

L’adresse préremplie dans Ocean est `http://pop-os-comfyui.tail917fd3.ts.net:8080`. Si tu utilises Tailscale Serve, tu peux saisir l’URL HTTPS qu’il affiche. Clique sur **Détecter les modèles** et autorise l’accès réseau local si le navigateur te le demande. Le PC où Ocean est ouvert doit être connecté à Tailscale. Voir [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [l’accès réseau local dans Chrome](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access) et [la configuration de llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

## Utiliser les outils

- **Apprentissage guidé** se trouve dans le menu **+**. Il demande au modèle de donner un indice à la fois et d’attendre la tentative de l’élève. Le respect de cette consigne dépend du modèle chargé.
- **Réflexion** se trouve dans le menu du modèle. **Bas** demande à Qwen une réponse directe. **Moyen** et **Élevé** activent la réflexion. **Élevé** est le réglage par défaut et correspond à `xhigh` côté API.
- **Python** s’exécute dans un worker isolé du navigateur. Le moteur Pyodide est téléchargé depuis jsDelivr au besoin. **Recherche web** utilise la clé Brave si elle est configurée. Le modèle choisit d’appeler les outils via son template de function calling.
- **Schémas et code**. Ocean affiche les blocs Mermaid comme des schémas ou des graphiques. Les blocs de code identifiés par leur langage sont colorés et copiables. Clique sur **Modifier** pour tester ta version d’un programme avec **Exécuter**. L’icône de réinitialisation rétablit le code de la réponse. Python et JavaScript de base fonctionnent dans le navigateur.
- **OneNote**. Colle dans le champ du chat. Quand le navigateur reçoit une image avec le texte ou le HTML de la sélection, Ocean joint uniquement l’image. Si OneNote fournit exclusivement du texte au navigateur, utilise une capture Windows (`Win+Maj+S`) et colle-la.
- **Fichiers**. Utilise **+ → Ajouter des fichiers** ou dépose-les sur le champ de saisie. Clique sur un fichier dans le chat pour le prévisualiser ou télécharger l’original. Le navigateur conserve les fichiers dans l’historique selon l’espace de stockage disponible.
- **Apparence**. Choisis **Clair**, **Sombre** ou **Système** dans les paramètres. Ocean mémorise le choix dans le navigateur.

Pour les petits PDF, DOCX, XLSX et fichiers texte joints au message, Ocean peut inclure le texte dès la première requête au modèle. Pour les longs PDF, le modèle peut rechercher un titre ou un passage puis ouvrir les pages correspondantes. Il peut aussi examiner les figures ou les scans en image et ouvrir les entrées d’un ZIP. L’examen visuel par le modèle exige la compatibilité vision. Les fichiers des anciennes discussions étaient enregistrés sous forme d’extraits. Joins de nouveau un PDF ancien pour examiner une autre page.

Demande un document Word, un tableau Excel ou CSV, ou un fichier texte à Ocean. L’outil de création simple produit le fichier dans le navigateur. Les téléchargements apparaissent dès que l’outil les a créés.

Pendant une réponse, Ocean indique si le navigateur lit un fichier, attend le modèle, exécute un outil ou reçoit le texte de la réponse. La section **Activité** garde les lectures et les appels d’outils de la réponse.

`npm test` vérifie le protocole d’inférence avec un serveur simulé. `npm run build` compile la version de production.

## Activer la sandbox de code

Sur Vercel, ajoute `OCEAN_CODE_SANDBOX=1` à l’environnement **Production** et renseigne les comptes autorisés dans `ALLOWED_GOOGLE_EMAILS`, puis redéploie. Le projet utilise l’authentification OIDC de Vercel. Si elle a été désactivée dans les paramètres du projet, réactive-la. [Authentification Vercel Sandbox](https://vercel.com/docs/sandbox/concepts/authentication)

La sandbox exécute JavaScript (Node.js), TypeScript, Bash, C, C++, C#, Java, Go, Rust, Ruby et PHP. Python bascule vers la sandbox si un module manque dans le navigateur ou si tu renseignes **Paquets PyPI à installer** dans le bloc. Indique les noms des paquets ou des versions exactes comme `numpy==2.2.6`. Ocean installe les distributions binaires disponibles sur PyPI avant d’exécuter le programme. Le code exécuté dans la sandbox est envoyé à Vercel. Ton navigateur contacte directement le modèle IA via Tailscale.

Pour un programme qui demande des valeurs, **Exécuter** ouvre une console dans la sandbox. Réponds ligne par ligne à ses invites. **Fin de saisie** signale qu’il n’y a plus de données. Les options du bloc permettent aussi de lancer manuellement la console ou de fournir toutes les valeurs à l’avance.

Python peut renvoyer des graphiques Matplotlib et des fichiers PNG, JPEG, WebP, PDF, DOCX, XLSX, PPTX, CSV, TSV, MD, TXT, JSON et ZIP. Enregistre-les dans `artifacts/`. Matplotlib peut produire des PDF dans le navigateur. Pour les bibliothèques documentaires comme ReportLab, python-docx et openpyxl, utilise la sandbox cloud. Ocean garde jusqu’à trois fichiers de 750 ko chacun par réponse. Le plan Hobby inclut un quota de sandbox. [Quotas Vercel Sandbox](https://vercel.com/docs/sandbox/pricing)

L’outil Python peut ouvrir dans `attachments/` les pièces jointes et les fichiers produits dans les réponses précédentes, y compris un fichier extrait d’un ZIP. Traite les gros lots en plusieurs exécutions. Le navigateur monte jusqu’à 32 Mio par exécution et la sandbox Vercel jusqu’à 2,5 Mo par requête. Seuls les fichiers sélectionnés pour une exécution cloud sont envoyés à Vercel.

