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
- `MUSE_REASONING_EFFORT` (optional; defaults to `low`)

Use `.env.example` for the required variable names. Keep real credentials in `.env.local` and Vercel's environment settings. The Admin SDK uses the service-account credentials above on Vercel.

## Tutor behavior and model settings

The tutor assumes normal algebra prerequisites but introduces lesson-specific tools before using them. It connects names to purposes, explains why steps work, and tracks introduced terms separately from demonstrated mastery. Guided work cannot earn mastery; independent reasoning still needs evidence. Direct explanations may end without a new question, and requests such as “let me think” wait without calling the AI. Tutor replies support inline and displayed LaTeX through KaTeX, including fractions and small sign charts; read-aloud converts common notation into spoken words.

Spark 1.3 with `low` reasoning is the default balance. Set `MUSE_MODEL=muse-wonder-1.0` to try a stronger, slower model; set `MUSE_REASONING_EFFORT` to `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Higher reasoning effort increases latency and token use. Environment changes on Vercel require redeployment.

Run `node scripts/benchmark-tutor.mjs` to compare Spark low/medium and Wonder low using two synthetic teaching prompts with the real tutor instructions. It measures first visible reply and full completion, makes six billable API requests, and does not access student data or write progress. These small samples are diagnostic, not a general model-quality evaluation.

References: [Meta model selection](https://dev.meta.ai/docs/choose-a-model) and [reasoning effort](https://dev.meta.ai/docs/reasoning).

## Set-builder assessment questions

Assessments accept interval inputs and multiple-choice questions. When both formats are available, a fresh five-question test selects three interval problems and two MCQs, filling any shortage from the remaining bank. Existing attempts retain their original questions and private grading snapshots.

Five prepared MCQs in `scripts/data/set-builder-questions.json` cover ∈, the “such that” separator, bounded intervals, OR/union, and plain-language interpretation. Preview them locally:

```sh
node scripts/seed-set-builder.mjs
```

After deploying the MCQ support, add them to Firestore using your local Admin credentials:

```sh
node scripts/seed-set-builder.mjs --write
```

The script creates active documents under `lessons/rational-inequalities/questions/{id}` and private keys under `answerKeys/{id}-v1`. It does not overwrite different existing content or change student progress. An identical rerun makes no changes. Questions contain `format: "multiple-choice"` and `choices: [{ id, text }]`; keys contain `lessonId`, `questionId`, `questionVersion`, `correctChoiceId`, and `explanation`. Correct choices stay on the server until submission. This adds MCQ interpretation exercises; the typed-input checker remains an interval-notation checker.

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

1. Commit and push the application, including `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `vercel.json`. The application and its `package.json` remain in `teaching-app`; no repository-root manifest is needed.
2. In Vercel, create a project by importing the GitHub repository. Use a personal Hobby account for this noncommercial project.
3. Set **Root Directory** to `teaching-app` and **Framework Preset** to **Next.js**. Leave dashboard command overrides off so `vercel.json` supplies the commands. Node.js is pinned to 26; both install and build explicitly run pnpm 12.18.0 through `npx`.
4. If you previously added `ENABLE_EXPERIMENTAL_COREPACK` in Vercel, remove it. The explicit `npx` commands in `vercel.json` select pnpm 12.18.0 without Corepack or a repository-root manifest, and use the committed build approvals.
5. Add `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and `MUSE_CODE_API` as environment variables for Production. Configure Preview too if you want preview deployments to access this Firebase project. `MUSE_MODEL` is optional. Enter values without dotenv's surrounding quotes; include the complete private key with its BEGIN/END lines.
6. Deploy. Keep Fluid compute enabled; the streaming chat route declares a 90-second maximum duration and limits the upstream AI request to 60 seconds.
7. Add the production hostname (without `https://` or a path) under **Firebase Console → Authentication → Settings → Authorized domains**.
8. Check email/Google sign-in, dashboard loading, tutor streaming, saved conversation after reload, and assessment submission on the deployed URL.

`vercel.json` places the server functions in Singapore (`sin1`), near the Firestore database configured in `asia-southeast1`. Static assets are served through Vercel's CDN.

Changing environment variables requires another deployment. The deployed app does not receive your local `.env.local` file. Secrets stay server-side; do not prefix these variable names with `NEXT_PUBLIC_`.

`firebase.json` continues to configure Firestore and authentication. Deploying the Vercel project does not deploy Firebase rules or indexes.

If deployment reports that the lockfile contains multiple YAML documents, check that `vercel.json` has been pushed and the build log uses its pinned install command. pnpm 12 legitimately writes a leading package-manager document; an older pnpm installer cannot read it. Do not delete the lockfile or remove that document manually. A failed deployment retries the same commit when redeployed; deploy the new commit containing the configuration fix instead.

Firebase Admin currently pulls in `jwks-rsa@4.1.0`, whose CommonJS loader tries to require the ESM-only `jose` v6 package. The scoped override `jwks-rsa>jose: 5.10.0` in `pnpm-workspace.yaml` supplies a CommonJS-compatible version for this dependency. Other packages keep their own jose versions. Commit the workspace settings and updated lockfile together. Regression tests load Firebase Admin and exercise signing-key retrieval with `require(ESM)` disabled. Remove the override after upgrading to a release containing the [upstream loader fix](https://github.com/auth0/node-jwks-rsa/pull/508).

References: [Vercel project setup](https://vercel.com/docs/deployments/configure-a-build), [package managers](https://vercel.com/docs/package-managers), [function regions](https://vercel.com/docs/functions/configuring-functions/region), and [environment variables](https://vercel.com/docs/environment-variables).
