# LowCardScore (LowScore)

A real-time multiplayer strategic **Low-Sum Card Game** built with **Next.js 15**, **React 19**, **TypeScript**, and **Tailwind CSS**. Create private rooms with 5-character share codes, challenge friends or smart AI bots, and aim for the lowest hand sum before hitting the elimination threshold.

## Features

- **Multiplayer Private Tables**: Create or join 2–8 player rooms using a 5-character lobby code or direct invite link (`/?join=CODE`), with built-in WhatsApp share and lobby/in-game chat.
- **Configurable Match Rules**: Customize elimination score (`50–300`), starting hand size (`3–7` cards), max players (`2–8`), turn timer (`15–90s`), and Easy/Hard AI bots.
- **Full Card Game Engine**: Supports 1-card drops, Pairs, 3-card Sequences, Four of a Kind, 5-card Sequences, and 5-card Flushes, plus **Declare** and **Undercut** (`+20 + diff`) scoring.
- **Smart Assistance & Rejoin**: Built-in optimal move Hint & Auto-Play toggle, 5-minute temporary "Step Away" rejoin window where a bot plays your turns, Spectator mode after elimination, and synthesized Web Audio sound effects.
- **Optional Supabase Auth**: Uses Supabase Auth when configured via environment variables, or falls back to a built-in temporary store + instant Guest Play.

## Tech Stack

- **Framework**: Next.js 15 (App Router + API Route Handlers)
- **UI**: React 19, Tailwind CSS, Lucide Icons, custom SVG 52-card deck
- **Auth (Optional)**: `@supabase/supabase-js`
- **CI**: GitHub Actions (`.github/workflows/ci.yml`)

## Local Development

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment variables (optional)**

   Copy `.env.example` to `.env.local` if you want to enable Supabase Authentication. Never commit `.env.local` or any real keys.

   ```bash
   cp .env.example .env.local
   ```

   | Variable | Required | Purpose |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Optional | Supabase project URL for user login/signup |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional | Supabase public anon key (used if service role key is not set) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Optional | Server-only Supabase key for `/api/auth` (keep secret) |

3. **Run the development server**

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000`.

4. **Verify typecheck & production build**

   ```bash
   npx tsc --noEmit
   npm run build
   ```

## Free Deployment Architecture Notes

- **Important State Note (`src/lib/serverStore.ts`)**: Currently, active game rooms and fallback users are stored in Node.js process memory (`globalThis`) and `/tmp/*.json`.
  - **Single-container free hosts** (such as **Render** Free Web Service) share one Node process while awake, so in-memory multiplayer works out of the box (though free instances sleep after inactivity and wipe `/tmp` on restarts).
  - **Edge / Serverless free hosts** (such as **Cloudflare Workers** via `@opennextjs/cloudflare` or **Vercel** Hobby) isolate memory and `/tmp` across requests/edge locations. For reliable multi-device gameplay on Cloudflare Workers Free Tier, back `serverStore.ts` with **Cloudflare Durable Objects (SQLite)** for room state and **Cloudflare D1** or **Supabase** for user accounts.

## License

Private/personal project repository.
