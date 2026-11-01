# Gpeit

A personal workspace for useful tools: private tasks, reminders, a food journal, tool messages, and optional GPT analysis. Built with Node 24's HTTP server and SQLite, with a responsive vanilla JavaScript frontend. No third-party runtime packages or build step.

## Run

```sh
cd /workspace/gpeit
node --version # Node 24 or newer
npm test
npm start
```

Port defaults to 3000. Create an account in the app. Data persists in `data/app.sqlite` (ignored by Git); `DATA_DIR` overrides its directory. Do not commit database files or `.env`. Use `npm run dev` for server restart on file changes. The reminder worker runs every 30 seconds as part of the server; overdue reminders are processed on restart. Do not rely on a stopped development server to deliver reminders.

## Optional services

Copy `.env.example` to `.env`, fill values securely, and restart the server. Core accounts, tasks, journals, in-app messages and in-app reminders need no external credentials. Settings shows connection status. Never paste credentials into chat or commit them.

- **GPT:** set `GPT_API_KEY` to an OpenAI API key. `GPT_MODEL` defaults to `gpt-4.1-mini`. Explicitly pressing AI analysis sends the selected user's task data (up to 100 tasks) or selected day's food entries to OpenAI's Responses API. The analysis is saved in the private inbox. Required HTTPS host: `api.openai.com`.
- **Google Calendar:** enable Google Calendar API in Google Cloud and create a Web OAuth client. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `APP_URL` to the exact externally reachable app origin. Register `${APP_URL}/api/google/callback` as an authorized redirect URI (e.g. `http://localhost:3000/api/google/callback` for local use). Add test users if the consent app is in testing. Each user connects their own calendar in Settings. The calendar icon copies a dated task into their primary calendar as a 30-minute event, with a popup reminder when provided. This is one-way event creation, not bidirectional synchronization; subsequent task edits, completion and deletion do not update the event. Access hosts: `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`.
- **Email:** set `RESEND_API_KEY` and `EMAIL_FROM` using a sender verified with Resend. Messages can be sent only to the signed-in user's registered address. Scheduled task reminders are emailed automatically when configured; all reminders appear in-app regardless. Email failures appear in the inbox and are not automatically retried. Required HTTPS host: `api.resend.com`.

Use the inherited platform proxy and TLS trust when running in the managed environment. Optional service hosts must be allowed in environment networking before those integrations can run. With proxy-backed secrets, bind `GPT_API_KEY` to `api.openai.com`, `GOOGLE_CLIENT_SECRET` to `oauth2.googleapis.com`, and `RESEND_API_KEY` to `api.resend.com`. This app intentionally uses `GPT_API_KEY` because some platform `OPENAI_` variable names are reserved.

## Extend tools

`tools.js` is the server-owned tool registry. Add an ID, display name, icon, description and analysis prompt. Implement the tool's user-scoped SQLite table/routes and UI, then add its data source to `/api/analyze`. Shared sessions, private messaging, inbox and GPT request handling can be reused. The registry is the extension point; arbitrary third-party plugins are not executed.

Every data query must include the authenticated user ID from the server session, never a user ID supplied by the browser. Use parameterized SQL. Validate data server-side and escape user-controlled content before rendering. Add cross-user API checks when adding a tool.

## Validation

`npm test` exercises real HTTP requests against a temporary database: account creation/login/logout, unauthorized requests, task completion, cross-user access denial, CSRF origin rejection, calorie totals and date isolation, preferences, messages, idempotent reminder processing, integration configuration errors, and frontend serving. No external API calls are made by the suite. A browser smoke check was also run against Chromium for registration, task creation/completion, food logging, messaging, and a 390px-wide layout.

## Before public deployment

This is a working MVP, not a completed production identity system. Email ownership verification, password recovery, and account/data deletion remain to be implemented. Only register addresses you control. Authentication uses scrypt password hashes, hashed random session tokens, HttpOnly SameSite cookies, same-origin mutation checks and in-process rate limits. For deployment, use HTTPS and set `APP_URL` to the exact HTTPS origin so cookies are Secure.

SQLite and refresh tokens are stored on the server filesystem. Use restricted filesystem permissions, encrypted storage and backups; implement application-level refresh-token encryption before handling public users. Run one instance of the embedded reminder worker; multiple replicas need a shared durable database and a queue with atomic reminder claims. The reminder transaction and email delivery are not exactly-once across crashes. For larger scale, migrate to PostgreSQL and a durable job worker, and use shared rate limiting. No email verification or real Google/OpenAI/Resend service calls have been validated without credentials.
