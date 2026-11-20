# AgriVoix — frontend (Next.js)

```
npm install
npm run dev        # http://localhost:3000
```

Le backend Python doit tourner (voir `../backend`). Les appels `/api/*` lui sont relayés par
`src/app/api/[...path]/route.ts` (variable `BACKEND_URL`, par défaut `http://127.0.0.1:8000`).

```
src/
├── app/            écrans : Vocal (/), Mes vocaux (/notes), Assistant (/assistant)
├── components/     boutons, bulles, lecteur audio, barre de saisie, inscription
├── hooks/          enregistrement vocal, « maintenir pour parler »
├── lib/            appels API, types, stockage local
└── store/          session (inscription) et annonces
```
