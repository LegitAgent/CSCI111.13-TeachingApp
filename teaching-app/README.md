# PreCalPal

A precalculus learning app built with Next.js App Router, React, TypeScript, Firebase Authentication, and Cloud Firestore. The Socratic tutor uses the Meta Model API; read-aloud audio uses the browser Web Speech API.

## Development

Run these commands from `teaching-app`:

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000.

## Checks

```sh
pnpm lint
pnpm build
node --test tests/*.test.mjs
```

Use `pnpm start` to run a production build locally after `pnpm build`.

## Environment

Set local server credentials in `.env.local`:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `MUSE_CODE_API`
- `MUSE_MODEL` (optional; defaults to `muse-spark-1.3`)

The Admin SDK also supports Application Default Credentials on Firebase App Hosting. Keep private credentials out of source control and browser code.

## Source structure

- `src/app`: routes, layouts, and API endpoints
- `src/components`: auth, dashboard, lessons, assessment, and tutor UI with associated CSS
- `src/hooks`: browser speech hook
- `src/lib`: shared utilities
- `src/server`: server-only tutor, model API, and assessment logic
- `src/styles`: global styles
- `src/types`: shared request and response types
- `firebase`: browser and Admin SDK initialization
- `tests`: server logic and grading tests

## Deployment

Deploy the full Next.js app to Firebase App Hosting. It needs a server runtime for authenticated APIs, AI streaming, and grading. Configure the backend with `teaching-app` as its application root.

`firebase.json` configures Firestore and authentication. App Hosting deployment is configured separately.
