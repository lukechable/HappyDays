# Happy Days

Practice operations for Barbara Fraser & Associates: mail on the live Gmail API, Cliniko bookings paid through
Stripe, tasks, court matters with subpoena export, file delivery by download code, PDF signing and markup, and a
table that says which invoices are paid and which reports are delivered.

Happy Days stores metadata only. Email bodies and attachments stay in Gmail, patient records stay in Cliniko,
money stays in Stripe. The exception is the practice's own uploaded documents (reports, signed forms).

Stack: Next.js 16 · Convex · Clerk · Tailwind v4 + shadcn (Base UI) · Stripe · Gmail API · Cliniko API · Claude.
Design system ported from the EventBase admin panel. Plan and decisions: [docs/PLAN.md](docs/PLAN.md).

## Run locally

```bash
pnpm install
npx convex dev          # pushes functions to the dev deployment and watches
pnpm dev                # http://localhost:3000
```

`.env.local` needs `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
Everything else is set on the Convex deployment (`npx convex env set NAME value`); the Settings → Setup tab in
the app shows which ones are still missing.

## One-time setup

1. **Clerk**: create an application, enable Google sign-in only, restrict to `barbarafraser.net`. Add a JWT
   template named `convex`; put its issuer in Convex as `CLERK_JWT_ISSUER_DOMAIN`. Put the publishable and
   secret keys on Railway (and in `.env.local`).
2. **Google**: in Google Cloud, create an OAuth client (Web) on the Workspace project, user type *Internal*,
   redirect URI `https://<app>/api/google/callback`, scopes gmail.modify, gmail.send, gmail.compose,
   userinfo.email. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` (32 random bytes,
   base64) and `APP_URL`. Optional push: a Pub/Sub topic with `gmail-api-push@system.gserviceaccount.com` as
   publisher and a push subscription to `https://<deployment>.convex.site/gmail/push?token=<random>`; set
   `GOOGLE_PUBSUB_TOPIC` and `GOOGLE_PUBSUB_VERIFICATION_TOKEN`.
3. **Cliniko**: `CLINIKO_API_KEY` (Luke's key), `CLINIKO_SHARD=au1`, `CLINIKO_SUBDOMAIN=barbara-fraser-and-associates`.
4. **Stripe**: `STRIPE_SECRET_KEY`; a webhook to `https://<deployment>.convex.site/stripe/webhook` for
   `invoice.*`, `checkout.session.*`, `payment_intent.*`; `STRIPE_WEBHOOK_SECRET`.
5. **Claude**: `ANTHROPIC_API_KEY` for tag suggestions, smart-inbox fallback, AI auto-reply conditions and
   reply drafting.

## Deploy

Railway staging builds the Next app from `main` (`railway up` from the repo, or connect the GitHub repo);
Convex functions are pushed with `npx convex dev --once`. See docs/PLAN.md §7.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm build
```
