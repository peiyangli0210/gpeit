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

## Deploy to Render

[Deploy to Render](https://render.com/deploy?repo=https://github.com/peiyangli0210/gpeit)

The repository includes `render.yaml`, which configures Node 24, a single Starter web instance, a 1 GB persistent disk at `/var/data`, the startup command, and a build-time integration test. **The web instance and disk are paid resources. Review Render’s current price before confirming deployment.** The disk is required to preserve accounts, tasks, and food records across deployments; do not switch to an ephemeral filesystem for real data.

Open the deployment link, sign into Render, authorize GitHub access if requested, and review/create the Blueprint. Render assigns the app an HTTPS address, which the server reads from `RENDER_EXTERNAL_URL` automatically for secure cookies, request-origin checks and OAuth callbacks. You do not need to manually copy the generated address into `APP_URL`. For a custom domain, set `APP_URL` to its exact HTTPS origin and update the Google OAuth redirect URI. The initial deployment creates an empty database; local development accounts are not transferred.

After Render marks the service live, open its HTTPS URL and create an account, add/complete a task, log a food entry and verify its calorie total. Restart the service and confirm your data remains. Deployment is not verified until these checks pass on the hosted service. This is intended for private MVP testing; see the production limitations below before public signups.

Add optional integration credentials through Render’s secure environment-variable settings; never place real keys in `render.yaml`. The core tools work before integrations are configured. Enable backups for the persistent data and keep the service at one instance until the database and worker are redesigned for multiple replicas.

## Optional services

Copy `.env.example` to `.env`, fill values securely, and restart the server. Core accounts, tasks, journals, in-app messages and in-app reminders need no external credentials. Settings shows connection status. Never paste credentials into chat or commit them.

- **Personal OpenAI connections:** each user can open **Settings → AI connection**, enter their OpenAI API key and a model ID, and click **Verify and save**. Saving makes a model-access check without generating paid analysis. Available model suggestions are editable; the selected model must support the Responses API. The key field is blank after saving; leave it blank to keep the current key while changing models. Enter a new key to replace it, or choose **Remove connection** to delete the saved connection. Removing it here does not revoke it at OpenAI.
  - OpenAI API billing is separate from ChatGPT Free, Plus or Pro. Those subscriptions do not supply API credits. Analysis is billed to the personal API account whenever a personal connection exists. An invalid personal connection fails clearly; it never silently falls back to shared billing.
  - **Required production setup:** configure `AI_KEY_ENCRYPTION_SECRET` as a long random server secret (at least 32 characters) before accepting personal keys. `render.yaml` generates it for new Blueprint deployments. For an existing service, sync the Blueprint or add this variable in **Render → service → Environment** using a password-manager-generated random value, save and redeploy. Keep this value unchanged across deployments and back it up securely. The server needs its actual bytes; a proxy-injected API credential placeholder is not suitable for encryption.
  - Personal keys are encrypted with AES-256-GCM and bound to the user ID before storage in SQLite. The server returns only connection status/model/source, never the saved key or ciphertext. User keys are sent only to the fixed OpenAI API destination and are never stored in browser storage. The browser clears the key field on submission. Do not enable request-body or authorization-header logging on the host. An administrator with server access can decrypt keys; this is server-side encryption, not end-to-end encryption.
  - Outside production, a development-only encryption key is created at `DATA_DIR/ai-encryption.key` with owner-only permissions. Preserve that file alongside local database backups to retain local connections. Production never falls back to a disk key. Changing the production encryption secret invalidates saved connections; restore the original secret or have users replace their keys. Restored database backups can contain old encrypted keys; revoke them at OpenAI if needed.
- **Optional shared GPT connection:** set `GPT_API_KEY` and optionally `GPT_MODEL` (default `gpt-4.1-mini`). It is used only for users without a personal connection. Removing a personal connection restores this shared fallback if configured; the UI states the active source. Pressing AI analysis sends only the current user's selected tool data (up to 100 tasks or the selected day's food entries) to OpenAI's Responses API and saves the answer in their private inbox. Required HTTPS host: `api.openai.com`.
- **Google Calendar + Gmail:** enable both **Google Calendar API** and **Gmail API** in the same Google Cloud project, then create a Web OAuth client. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The app uses `RENDER_EXTERNAL_URL` automatically on Render; set `APP_URL` only for a custom origin. Register your exact `https://YOUR-HOST/api/google/callback` as an authorized redirect URI. In Google Auth Platform → Data Access, add `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/gmail.send`. Add your Google email as a test user while the consent app is in Testing.
  - **Reconnect existing accounts:** In the app's Settings, click **Connect Google: Calendar & Gmail** and approve both permissions. Old Calendar connections keep working, but cannot send Gmail until the user grants the new scope. Google may require app verification before broad external use. External test-user refresh tokens for these permissions can expire after seven days; reconnect if access expires.
  - **Calendar:** Adding a task with a due date automatically creates a 30-minute event in the connected user's primary calendar. Deleting it removes the linked event. Connecting Google also schedules existing dated tasks. Undated tasks remain local. Changes made in Google Calendar do not change app tasks; completing a task does not delete its calendar event.
  - **Reliable retries:** Create/delete jobs are saved in SQLite in the same transaction as task changes. Failed Calendar requests retry automatically while the server runs, with increasing delays up to one hour. The to-do view shows pending changes and offers **Retry sync**. Deletion jobs survive deleting the local task, service restarts and Google disconnections. Reconnect to resume them. Event IDs prevent duplicate creation after a lost response. Keep one app instance/worker.
  - **Gmail messages:** In either tool select **Send a note → Delivery → Send through my Gmail**. Set a recipient, subject and message. Email is sent from the Google account you connected, and a copy is saved in your private app inbox. Task reminders are emailed to your app account's registered address through Gmail when Gmail is connected. The app requests sending permission only; it does not read your Gmail inbox. Gmail errors do not record a message as successfully sent; check Gmail Sent before retrying a timed-out message because delivery may already have occurred.
  - Required HTTPS hosts: `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`, `gmail.googleapis.com`.
- **Optional alternative email service:** set `RESEND_API_KEY` and `EMAIL_FROM` using a sender verified with Resend. Select the email-service delivery option to send a note to your registered address. Reminders use this service only when Gmail is not connected. Failures appear in the app inbox and are not automatically retried. Required HTTPS host: `api.resend.com`.

Use the inherited platform proxy and TLS trust when running in the managed environment. Optional service hosts must be allowed in environment networking before those integrations can run. With proxy-backed secrets, bind `GPT_API_KEY` to `api.openai.com`, `GOOGLE_CLIENT_SECRET` to `oauth2.googleapis.com`, and `RESEND_API_KEY` to `api.resend.com`. This app intentionally uses `GPT_API_KEY` because some platform `OPENAI_` variable names are reserved.

## Extend tools

`tools.js` is the server-owned tool registry. Add an ID, display name, icon, description and analysis prompt. Implement the tool's user-scoped SQLite table/routes and UI, then add its data source to `/api/analyze`. Shared sessions, private messaging, inbox and GPT request handling can be reused. The registry is the extension point; arbitrary third-party plugins are not executed.

Every data query must include the authenticated user ID from the server session, never a user ID supplied by the browser. Use parameterized SQL. Validate data server-side and escape user-controlled content before rendering. Add cross-user API checks when adding a tool.

## Validation

`npm test` exercises real HTTP requests against a temporary database: account creation/login/logout, unauthorized requests, task completion, cross-user access denial, CSRF origin rejection, calorie totals and date isolation, preferences, messages, idempotent reminder processing, integration configuration errors, and frontend serving. The Google integration checks mock token exchanges, Gmail MIME messages and errors, OAuth scopes, automatic Calendar creates/deletes, retries, reconnection and cross-user ownership. Personal AI tests cover encrypted storage, per-user credentials/data/model isolation, safe failed verification, replacement, model changes, removal, production encryption prerequisites and avoiding implicit billing fallbacks. No live external API calls are made by the suite. A browser smoke check was also run against Chromium for registration, task creation/completion, food logging, messaging, and a 390px-wide layout.

## Before public deployment

This is a working MVP, not a completed production identity system. Email ownership verification, password recovery, and account/data deletion remain to be implemented. Only register addresses you control. Authentication uses scrypt password hashes, hashed random session tokens, HttpOnly SameSite cookies, same-origin mutation checks and in-process rate limits. For deployment, use HTTPS and set `APP_URL` to the exact HTTPS origin so cookies are Secure.

SQLite and Google refresh tokens are stored on the server filesystem. Personal OpenAI keys use the encryption described above; Google refresh tokens still require separate hardening. Use restricted filesystem permissions, encrypted storage and backups; implement application-level refresh-token encryption before handling public users. Run one instance of the embedded reminder worker; multiple replicas need a shared durable database and a queue with atomic reminder claims. The reminder transaction and email delivery are not exactly-once across crashes. For larger scale, migrate to PostgreSQL and a durable job worker, and use shared rate limiting. No email verification or real Google Calendar/Gmail/OpenAI/Resend service calls have been validated without credentials.
