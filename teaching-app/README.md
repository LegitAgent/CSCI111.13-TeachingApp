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

Use `.env.example` for the required variable names. Keep real credentials in `.env.local` and Vercel's environment settings. The Admin SDK uses the service-account credentials above on Vercel.

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

Deploy the full Next.js app to Vercel. Firebase continues to handle authentication and Firestore; the authenticated APIs, AI streaming, and grading run on Vercel.

1. Commit and push the application, including `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `vercel.json`.
2. In Vercel, create a project by importing the GitHub repository. Use a personal Hobby account for this noncommercial project.
3. Set **Root Directory** to `teaching-app` and **Framework Preset** to **Next.js**. Leave install, build, and output settings at their defaults. `package.json` pins Node.js 26 and pnpm 12.18.0.
4. Add the Vercel environment variable `ENABLE_EXPERIMENTAL_COREPACK=1` as described in its [Corepack guide](https://vercel.com/docs/builds/configure-a-build#corepack). This ensures the build uses the pinned pnpm version and the committed build approvals.
5. Add `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and `MUSE_CODE_API` as environment variables for Production. Configure Preview too if you want preview deployments to access this Firebase project. `MUSE_MODEL` is optional. Enter values without dotenv's surrounding quotes; include the complete private key with its BEGIN/END lines.
6. Deploy. Keep Fluid compute enabled; the streaming chat route declares a 90-second maximum duration and limits the upstream AI request to 60 seconds.
7. Add the production hostname (without `https://` or a path) under **Firebase Console → Authentication → Settings → Authorized domains**.
8. Check email/Google sign-in, dashboard loading, tutor streaming, saved conversation after reload, and assessment submission on the deployed URL.

`vercel.json` places the server functions in Singapore (`sin1`), near the Firestore database configured in `asia-southeast1`. Static assets are served through Vercel's CDN.

Changing environment variables requires another deployment. The deployed app does not receive your local `.env.local` file. Secrets stay server-side; do not prefix these variable names with `NEXT_PUBLIC_`.

`firebase.json` continues to configure Firestore and authentication. Deploying the Vercel project does not deploy Firebase rules or indexes.

References: [Vercel project setup](https://vercel.com/docs/deployments/configure-a-build), [package managers](https://vercel.com/docs/package-managers), [function regions](https://vercel.com/docs/functions/configuring-functions/region), and [environment variables](https://vercel.com/docs/environment-variables).
