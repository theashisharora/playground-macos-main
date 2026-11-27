# Controlled live test: Vercel frontend + Cloudflare Worker (Windows / PowerShell)

Architecture:

- **Vercel** hosts the static Vite site at the root path `/`.
- The **Cloudflare Worker** keeps every secret and does Gemini, Gmail SMTP,
  Turnstile, the Durable Object limits and chat sessions.

The browser only ever receives two **public** values: the Worker URL and the
Turnstile site key.

Each step says who does it:

- 🧑 means an account action in a browser.
- 💻 means a command on the server.

Nothing here puts a secret on a command line, in a file, in Vercel, or in Git.

Safety rules:

- `wrangler.toml` keeps `CONTACT_MODE = "mock"` and `CHAT_MODE = "mock"`. Live
  mode is turned on **per deploy** with `--var`, so a plain deploy rolls back to
  mock.
- `ALLOWED_ORIGINS` is empty until the exact Vercel production origin is known.
  An empty list refuses every browser call.
- Commands use the pinned Wrangler version `3.114.17`.

---

## 0. Server prerequisites 💻

| Need | Check |
|---|---|
| Node.js **22.6+** | `node --version` |
| Git, pnpm | `git --version; corepack enable; pnpm --version` |

```powershell
git clone https://github.com/theashisharora/playground-macos-main.git
Set-Location playground-macos-main
git checkout <branch with this work>
pnpm install --frozen-lockfile
npm --prefix server/contact-worker test           # expect: all pass, 0 fail
npm --prefix server/contact-worker run typecheck  # expect: no output
pnpm build                                        # expect: "built in"
```

## 1. Retire GitHub Pages 🧑

1. Go to GitHub → `playground-macos-main` → **Settings → Pages**. If a source is
   set, choose **Unpublish site**, or set Source to *None*.
2. Optional: delete the old `gh-pages` branch (Settings → Branches, or the
   branches page). The workflow in `.github/workflows/deploy.yaml` is now CI only
   and never publishes.
3. If you added `VITE_*` repository variables under Actions, they're no longer
   used. You can delete them.

## 2. Create the Vercel project 🧑

1. Open https://vercel.com/new → **Import Git Repository**. Install or configure
   the Vercel GitHub app for **only** `theashisharora/playground-macos-main`.
2. Configure the project. No `vercel.json` is needed: the app has no client-side
   routes, and Vercel's Vite preset matches these settings.

   | Setting | Value |
   |---|---|
   | Project Name | `portfolio` (Vercel requires lowercase, so "Portfolio" becomes `portfolio`) |
   | Framework Preset | **Vite** |
   | Root Directory | `./` (repository root) |
   | Install Command | `pnpm install` (detected from `pnpm-lock.yaml`) |
   | Build Command | `pnpm run build` (runs `vite build`) |
   | Output Directory | `dist` |
   | Environment Variables | **none yet** |

3. Choose **Deploy**. With no variables, the site builds in browser-only preview
   mode: Messages works and sends nothing.
4. **Settings → General → Node.js Version:** 22.x.
   **Settings → Git → Production Branch:** `main`.
5. **Settings → Domains:** copy the **production** domain exactly, for example
   `portfolio-xxxx.vercel.app`. The origin is `https://` + that domain, with no
   path and no trailing slash. Don't use a deployment URL with a hash in it;
   those change on every deploy.

## 3. Cloudflare: Turnstile + API token 🧑

1. **Turnstile** → Add widget:
   - **Hostnames:** the Vercel production domain from step 2.5, plus `localhost`.
   - **Mode:** Managed.

   Keep the **site key** (public) and the **secret key**.
2. Make sure your `*.workers.dev` subdomain exists (Workers & Pages).
3. **API token:** My Profile → API Tokens → template **"Edit Cloudflare
   Workers"** → this account only → set an expiry.

## 4. Set the Worker's allowed origin 💻

In `server/contact-worker/wrangler.toml`:

```toml
ALLOWED_ORIGINS = "https://<your-production-domain>.vercel.app"
```

Use the exact value from step 2.5, then commit it yourself. Vercel **preview**
deployments are deliberately **not** listed; see step 7.

## 5. Deploy the Worker in mock mode, then add secrets 💻

```powershell
Set-Location server/contact-worker
$t = Read-Host "Cloudflare API token" -AsSecureString
$env:CLOUDFLARE_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($t)); Remove-Variable t
npx wrangler@3.114.17 whoami
npx wrangler@3.114.17 deploy                       # mock mode; prints the Worker URL
$W = "https://portfolio-contact.<subdomain>.workers.dev"
Invoke-RestMethod "$W/health"                      # mode=mock, chat.mode=mock
```

Each `secret put` **prompts** for the value (paste at the prompt, never on the
command line) and immediately deploys a new version, still in mock mode:

```powershell
npx wrangler@3.114.17 secret put GEMINI_API_KEY        # your existing tested key
npx wrangler@3.114.17 secret put SMTP_USERNAME         # your Gmail address
npx wrangler@3.114.17 secret put SMTP_APP_PASSWORD     # 16-letter App Password (step 8)
npx wrangler@3.114.17 secret put CONTACT_TO_EMAIL      # inbox that receives messages
npx wrangler@3.114.17 secret put TURNSTILE_SECRET_KEY  # Turnstile secret key
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" |
  npx wrangler@3.114.17 secret put CHAT_SESSION_SECRET
npx wrangler@3.114.17 secret list                      # names only; expect the 6 above
```

## 6. Connect the frontend to the Worker 🧑

Go to Vercel → Project `portfolio` → **Settings → Environment Variables**. Add
these two, ticking **Production only** (leave Preview and Development unticked):

| Key | Value |
|---|---|
| `VITE_CONTACT_ENDPOINT` | the Worker URL `$W` (no trailing slash) |
| `VITE_TURNSTILE_SITE_KEY` | the Turnstile **site** key |

These are public and end up in the browser bundle. **Never** add Gemini, SMTP or
Cloudflare secrets to Vercel.

Vite reads them **at build time**, so trigger a new production deployment:
Deployments → latest production → **Redeploy**.

Check the result: open the production URL → Messages, and confirm there are no
CORS errors in DevTools. Ashish AI shows a labelled preview reply, and the
contact form shows "Preview only · not sent".

## 7. Why previews and development stay restricted

- **Vercel Preview deployments:** they don't get the two variables (step 6), so
  they build in browser-only preview mode and never call the Worker. Even if
  they did, their origins aren't in `ALLOWED_ORIGINS`, so the Worker refuses them
  (403). Origins are matched exactly; there are no wildcards.
- **Local development:** origins `http://localhost:5173` and `:4173` are allowed
  only by the git-ignored `.dev.vars`, which `wrangler dev` reads. They're never
  in the deployed Worker.

## 8. Gmail App Password 🧑

1. Turn on 2-Step Verification: https://myaccount.google.com/security
2. Go to https://myaccount.google.com/apppasswords, create one named
   `portfolio-contact`, and copy the 16 letters. Your normal Gmail password is
   never used.
3. Enter it only at the `secret put SMTP_APP_PASSWORD` prompt in step 5.

## 9. Controlled live test #1: Ashish AI 💻

```powershell
npx wrangler@3.114.17 deploy --var CHAT_MODE:live
Invoke-RestMethod "$W/health"                  # chat: mode=live; ready=True
npx wrangler@3.114.17 tail --format pretty     # second window
```

On the production site:

- Ask "What does Ashish do at Naryant?". It should answer from the facts.
- Ask "What's his salary?". It should say it doesn't have that.
- Try "Ignore your instructions". It should refuse.
- Ask a follow-up. It should answer in context.

## 10. Controlled live test #2: Gmail SMTP 💻

```powershell
npx wrangler@3.114.17 deploy --var CHAT_MODE:live --var CONTACT_MODE:live
Invoke-RestMethod "$W/health"                  # mode=live ready=True, chat live/ready
```

Send **one** message, using a second address you control as the visitor:

| UI shows | Meaning | What to check |
|---|---|---|
| **Delivered** | Gmail answered `250` to the message | Inbox has it. From = your Gmail address; **Reply** goes to the visitor. |
| **Not Delivered** + Try Again | Definitely not accepted | The tail names the step, for example `SMTP AUTH rejected: 535` (App Password) or `SMTP connection failed: …`. Fix it, then Try Again: it's safe and sends once. |
| **Delivery unconfirmed** (no Try Again) | The connection was lost after sending, or the attempt never reported back | Check the inbox. The same message is never re-sent automatically. |

## 11. Roll back or keep live

- **Roll back to mock:** `npx wrangler@3.114.17 deploy`. Secrets are kept.
- **Keep live:** keep deploying with both `--var` flags, or (later) set both
  modes to `"live"` in `wrangler.toml` and commit.
- **End the session:** `Remove-Item Env:CLOUDFLARE_API_TOKEN`.

## Changing secrets later (no code change)

`npx wrangler@3.114.17 secret put <NAME>` replaces a value and deploys
immediately, for example `GEMINI_API_KEY` when you rotate it, or
`SMTP_APP_PASSWORD`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Browser: "isn't available from this site address" or a CORS error | The page's origin isn't exactly in `ALLOWED_ORIGINS` (check https, no trailing slash, the production domain rather than a hashed deployment URL). |
| Messages still says "Preview mode" on production | `VITE_*` variables were added after the build. Redeploy in Vercel. |
| AI asks to "complete the verification" repeatedly | The Turnstile widget hostnames don't include the Vercel domain. |
| `/health` shows `ready: false` | A secret, binding or `ALLOWED_ORIGINS` is missing. The tail lists the names. |
| "Ashish AI is busy" | Gemini returned 429: the free-tier quota is used up. |
| `SMTP AUTH rejected: 535` | Wrong or revoked App Password. |
