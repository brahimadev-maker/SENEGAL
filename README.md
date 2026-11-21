# AgriVoix

Annonces agricoles à la voix (dioula / français / anglais), mise en relation acheteurs–vendeurs,
et assistant agricole.

```
SENEGAL/
├── backend/                  API Python (FastAPI)
│   ├── server.py             routes HTTP
│   ├── pipeline.py           chaîne vocale : Djelia ASR → traduction → Claude → traduction → voix
│   ├── langues.py            détection de la langue parlée, transcription fr/en (Whisper)
│   ├── glossaire.py          dictionnaire agricole français–dioula
│   ├── dictionnaire_agricole.json
│   ├── annonces_db.py        accès Supabase (utilisateurs, annonces, messages, audios)
│   ├── requirements.txt
│   ├── secrets.env           clés (non versionné)
│   └── venv/                 environnement Python (non versionné)
└── frontend/                 application web (Next.js)
```

## Langues

La langue de chaque vocal est détectée automatiquement sur le serveur (faster-whisper, modèle
`small`, sans clé API ; téléchargé au premier démarrage) :

- **français / anglais** : transcrits par Whisper ; Claude répond dans la même langue ; la réponse
  est lue par la synthèse vocale native du navigateur ;
- **tout le reste = dioula** : transcription Djelia (sunjata-1), traduction, réponse lue par la voix Djelia.

Les annonces sont toujours enregistrées avec une version française (pour la mise en relation).
Variables facultatives : `WHISPER_MODEL` (base, small…), `LANG_MIN_PROB` (défaut 0.6).

## Lancer en local

1. Backend (port 8000) :
   ```
   cd backend
   venv\Scripts\python.exe -m pip install -r requirements.txt
   venv\Scripts\python.exe -m uvicorn server:app --port 8000
   ```
   Relancer après toute modification de `server.py` ou de `secrets.env`.
2. Frontend (port 3000) :
   ```
   cd frontend
   npm install
   npm run dev
   ```
3. Ouvrir http://localhost:3000

`backend/secrets.env` : `DJELIA_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY` (et facultatif `DJELIA_ASR_MODEL`, défaut `sunjata-1`).

## Routes du backend

Sauf `health`, `localite` et `inscription`, chaque appel porte l'en-tête `X-User-Token`
(jeton de session reçu à l'inscription, gardé dans le navigateur).

| Route | Rôle |
|---|---|
| `GET /api/health` | état : modèle, ASR, ffmpeg, base configurée |
| `GET /api/localite?lat=&lng=` | nom de la localité (OpenStreetMap) |
| `POST /api/inscription` | `name`, `phone`, `lat`/`lng` (GPS) ou `place` → `{token, profile}` |
| `GET /api/moi` | profil |
| `POST /api/connexion` | téléphone + code à 4 chiffres → nouvelle session (5 essais, puis 15 min de blocage) |
| `POST /api/deconnexion` | ferme la session de cet appareil |
| `POST /api/code` | crée / change le code (comptes inscrits avant son introduction) |
| `POST /api/assistant` | conseiller (texte, photo, vocal dioula / français / anglais) ; les vocaux sont archivés |
| `POST /api/annonces` | `text` ou `audio` → audio stocké, transcription, analyse, matching |
| `GET /api/annonces` | mes annonces + correspondance (nom, téléphone, lieu) + nb de messages |
| `DELETE /api/annonces/{id}` | annule ; la correspondance d'en face repart en attente |
| `GET/POST /api/annonces/{id}/messages` | conversation avec la correspondance (texte ou vocal) |

## Base de données (Supabase, projet « agrivoix »)

| Table | Contenu |
|---|---|
| `profiles` | nom, téléphone (unique), position GPS, localité, hash du jeton |
| `sessions` | une session par appareil connecté (hash du jeton) ; le code est haché (bcrypt) dans `profiles` |
| `annonces` | transcription fr (+ dioula), intention, produit, quantité, lieu, chemin de l'audio, statut, annonce liée |
| `messages` | messages texte / vocaux entre les deux personnes d'une correspondance |
| `assistant_vocaux` | questions vocales posées à l'assistant : audio, transcription dioula, traduction, réponse |

**Stockage** : bucket privé `audios` (mp3, convertis par ffmpeg) — dossiers `annonces/`,
`messages/`, `assistant/`, un sous-dossier par utilisateur. Lecture par liens signés (6 h).

**Matching** (fonction SQL, atomique) : annonce en attente de sens opposé, même produit,
d'un autre utilisateur, la plus ancienne d'abord. « Autre » n'est pas apparié.

**Sécurité** : RLS activé sans politique ; tout passe par des fonctions SQL réservées à la
clé secrète du backend, qui vérifient le jeton et les droits (ses annonces, ses conversations).

## Limites connues

- Pas de vérification du numéro par SMS : un numéro ne peut être inscrit qu'une fois, et
  la session est liée au navigateur (vider ses données = perdre l'accès au compte).
- Les nouveautés (correspondances, messages) sont récupérées par interrogation régulière
  (10 s pour la liste, 4 s dans une conversation), pas en temps réel.
- Les discussions avec l'assistant restent dans le navigateur (seuls les vocaux sont archivés).
- La langue d'origine d'une annonce n'est pas stockée en base : seule sa version française
  (et la transcription dioula le cas échéant) l'est ; l'audio reste disponible.
