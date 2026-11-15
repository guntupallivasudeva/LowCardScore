# LowScore — Strategic Low-Sum Card Game

A mobile-friendly multiplayer card game built with **Next.js 15 App Router**, **TypeScript**, **Tailwind CSS**, **Better Auth**, and **Cloudflare Workers + Cloudflare D1** (Free Tier).

## Architecture (100% Cloudflare Free Stack)

- **Hosting & Runtime**: Cloudflare Workers + Workers Static Assets via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare)
- **Database (Free Tier SQL)**: Cloudflare D1 (`lowscore-db` binding `DB`) storing:
  - **Better Auth** tables (`user`, `session`, `account`, `verification`)
  - **`player_preferences`** (per-player sound mute/unmute & display name)
  - **`game_rooms`** (active multiplayer lobby & table state, 24h TTL)
- **Authentication**: [`better-auth`](https://www.better-auth.com/) with Email/Password (`PBKDF2-SHA256` WebCrypto hashing under `<1ms` CPU to fit cleanly inside Cloudflare Workers Free Tier's 10ms CPU limit) + instant **Guest Mode**.
- **Anti-Cache & Refresh Continuity**: API routes enforce `force-dynamic` and `Cache-Control: no-store, no-cache, must-revalidate`. Refreshing mid-game reconnects seamlessly via URL `?room=CODE` + saved room/table state (`autoPlay`, card selection, draw choice, panel state).

---

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create local Wrangler secrets (gitignored `.dev.vars`):
   ```bash
   cp .env.example .dev.vars
   # Put a random 32+ char hex secret into BETTER_AUTH_SECRET inside .dev.vars
   openssl rand -hex 32
   ```

3. Apply D1 SQL migrations locally:
   ```bash
   npm run db:migrate:local
   ```

4. Start Next.js dev server (connected to local Wrangler/Miniflare D1 via `initOpenNextCloudflareForDev()`):
   ```bash
   npm run dev
   ```

5. Preview directly inside local Cloudflare `workerd` runtime:
   ```bash
   npm run cf:preview
   ```

---

## Deploying to Cloudflare (Free Tier)

No credit card or R2 bucket is needed — everything runs on **Cloudflare Workers Free Plan** + **Cloudflare D1 Free Plan**.

1. Authenticate Wrangler with your Cloudflare account:
   ```bash
   npx wrangler login
   ```

2. Configure the D1 database (`lowscore-db` is already provisioned and linked in [`wrangler.jsonc`](wrangler.jsonc) with [`migrations/0001_init.sql`](migrations/0001_init.sql); if deploying to a different Cloudflare account, create a new DB and replace `database_id`):
   ```bash
   npx wrangler d1 create lowscore-db
   npm run db:migrate:remote
   ```

3. Set your production Better Auth secret (required before signing up/signing in in production):
   ```bash
   openssl rand -hex 32 | npx wrangler secret put BETTER_AUTH_SECRET
   ```

4. Build & deploy the OpenNext Worker to Cloudflare:
   ```bash
   npm run cf:deploy
   ```

5. Optional: set `BETTER_AUTH_URL` to your deployed `https://<your-worker>.<subdomain>.workers.dev` URL (or custom domain) in Cloudflare Dashboard → Worker Settings → Variables and Secrets, or via `npx wrangler secret put BETTER_AUTH_URL`. When omitted, auth origins fall back automatically to the incoming HTTPS request host.

---

## CI/CD Pipeline

Every push and pull request targeting `main` runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

1. `npm ci` + `npx tsc --noEmit`
2. `npm run cf:build` (Next.js production build + OpenNext Cloudflare Workers bundle)
3. `npx wrangler deploy --dry-run` (validates `wrangler.jsonc`, static assets, D1 binding, and 3 MiB Free Tier bundle limit without credentials)
4. `npm audit --audit-level=high` (advisory security audit)

### Option A: Auto-Deploy via GitHub Actions

Add these **Repository Secrets** in **GitHub → Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API Token with *Workers Scripts: Edit*, *Workers Routes: Edit*, *Account Settings: Read*, and *D1: Edit*
- `CLOUDFLARE_ACCOUNT_ID` — Your Cloudflare Account ID
- `BETTER_AUTH_SECRET` — A 32+ byte random hex secret (`openssl rand -hex 32`)

Once set, pushes to `main` automatically apply D1 migrations, deploy the OpenNext Worker, and sync `BETTER_AUTH_SECRET`.

### Option B: Auto-Deploy via Cloudflare Workers Builds (Zero Tokens in GitHub)

In the **Cloudflare Dashboard → Workers & Pages → Create → Workers → Import a repository**, connect `guntupallivasudeva/LowCardScore` (`main`) with:

- **Build command**: `npm run cf:build`
- **Deploy command**: `npx opennextjs-cloudflare deploy`
- **Runtime Secrets**: Add `BETTER_AUTH_SECRET` under Worker **Settings → Variables and Secrets**.

---

## Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Local Next.js dev server with Cloudflare D1 bindings |
| `npm run build` | Standard Next.js production build |
| `npm run cf:build` | Build `.open-next` Cloudflare Workers bundle |
| `npm run cf:preview` | Build & preview locally inside Cloudflare `workerd` |
| `npm run cf:deploy` | Build & deploy to Cloudflare Workers |
| `npm run db:migrate:local` | Apply `migrations/*.sql` to local D1 |
| `npm run db:migrate:remote` | Apply `migrations/*.sql` to production D1 |
| `npm run cf:typegen` | Regenerate `cloudflare-env.d.ts` from `wrangler.jsonc` |
