# Henine Boutique — runbook

What to do, step by step, for the things that go wrong or need care. Commands run from the repository
root unless written otherwise. Live shop: https://henineboutique.com (old address henine-boutique.karimmaticmz.workers.dev redirects to it; Worker
`henine-boutique`, D1 `henine-boutique-db`, R2 `henine-media`).

## 1. Deploy

One path only (audit DEP-1). Either:

- **GitHub (recommended):** Settings → Secrets and variables → Actions: secrets `CLOUDFLARE_API_TOKEN`
  (Workers Scripts: Edit, D1: Edit, Account Settings: Read), `CLOUDFLARE_ACCOUNT_ID`, optional
  `BACKUP_PASSPHRASE`; variables `PUBLIC_ORIGIN` and `DEPLOY_ENABLED = true`. Every push to `main`
  that passes CI (typecheck, lint, tests, build, browser tests) then: backs up and restore-tests the
  database (if `BACKUP_PASSPHRASE`), checks the migration history, applies migrations, deploys, and
  checks the new build is live. **Then turn off Cloudflare's own Git build** (Cloudflare dashboard →
  Workers & Pages → henine-boutique → Settings → Builds → disconnect, or set it to non-production
  branches only), otherwise every push is deployed twice, once without tests or migrations.
- **By hand:**
  ```sh
  npm run build
  npm run check:migrations                       # history matches the files
  cd apps/worker && npx wrangler d1 migrations apply henine-boutique-db --remote
  npx wrangler deploy && cd ../..
  npm run verify:deploy                          # health OK + the live home page is this build
  ```
  `verify:deploy` matters: twice a deploy reported success while the old version kept serving.

  **Removing a table or column: two releases** (expand / contract). Release 1: the code stops
  using it. Release 2 (after release 1 is live): a migration named `…_contract_….sql` drops it.
  `check-migrations` refuses a drop in a file without « contract » in its name, or while
  `apps/worker/src` still mentions the name, because migrations are applied before the new code is live.
  If it fails after 3 minutes, deploy again; if it still fails, roll back (§2).

## 2. Roll back

```sh
cd apps/worker
npx wrangler deployments list        # the versions, newest last
npx wrangler rollback                # back to the previous version, in seconds
npx wrangler rollback <version-id>   # or a chosen one
```
A rollback changes the code, not the database. If the bad version ran a migration, the old code must
still work with the new schema (migrations here only add columns/tables, which old code ignores). A
migration that removes or renames something needs its own reverse migration — write it, test it
locally (`npm run db:migrate:local`), then deploy it.

## 3. Restore data

**Recent mistake (less than 7 days): D1 Time Travel**, nothing to prepare:
```sh
cd apps/worker
npx wrangler d1 time-travel info henine-boutique-db --timestamp=2026-10-14T09:00:00+01:00
npx wrangler d1 time-travel restore henine-boutique-db --timestamp=2026-10-14T09:00:00+01:00
```
This replaces the whole database with its state at that moment: orders placed since are lost —
note them first (Admin → Commandes → Export CSV).

**Older than 7 days: the weekly backup** (GitHub → Actions → Backup → a run → artifact
`backup-N`, kept 8 weeks; or `npm run backup` by hand). Each file is encrypted; you need
`BACKUP_PASSPHRASE`.
```sh
BACKUP_PASSPHRASE=… node scripts/restore-drill.mjs backups/henine-….sql.enc          # proves it restores
BACKUP_PASSPHRASE=… node scripts/restore-drill.mjs --decrypt backups/henine-….sql.enc restore.sql
cd apps/worker
npx wrangler d1 create henine-restore                 # a new, empty database
npx wrangler d1 execute henine-restore --remote --file ../../restore.sql
```
Then point `wrangler.jsonc` → `d1_databases[0].database_id` to the new database, record the
migrations as applied (`INSERT INTO d1_migrations (name, applied_at) VALUES ('0000_….sql', datetime('now'))`
for every file, since the export doesn't include that table), `npm run check:migrations`, deploy.
**Delete `restore.sql` afterwards: it holds customer data in clear.**

Product photos (R2) have no copy: keep the originals on the shop's phone/computer.

## 4. Secrets

Set with `cd apps/worker && npx wrangler secret put NAME`. Never in git.

| Secret | Rotating it |
|---|---|
| `IP_HASH_SALT` | safe any time (visit/IP statistics restart from zero) |
| `TRACK_TOKEN_PEPPER` | **breaks every private order link already sent** (customers then use phone + order code) — only if leaked |
| `AUTH_PEPPER` | **every admin password stops working**: each member resets theirs (Mot de passe oublié / new invitation) |
| `SETTINGS_KEY` | **the Telegram token, ZR keys and authenticator secrets stored encrypted become unreadable**: re-enter them in Paramètres → Connexions and re-invite admins for their authenticator — only if leaked |

The Worker refuses to start (503) when one of these four is missing.

## 5. The shop is down / slow

1. Uptime alert (GitHub email, or Telegram when `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` secrets
   are set) — `.github/workflows/uptime.yml` checks every 15 minutes.
2. `curl -s https://…/api/health` → `{"ok":true,…}` means the Worker and D1 answer.
3. Cloudflare dashboard → Workers & Pages → henine-boutique → Logs (every request is kept 3 days).
4. **D1 daily limit** (5 M rows read, 100 k written on the free plan): every query fails until
   01:00 Algiers. D1 → henine-boutique-db → Metrics shows it. Warning on Telegram at 50 % and
   80 % (checked every 30 min): create an API token with only *Account → Account Analytics →
   Read*, then `npx wrangler secret put CF_ANALYTICS_TOKEN` and `npx wrangler secret put
   CF_ACCOUNT_ID` (the id shown by `npx wrangler whoami`). A wrong token shows up in Admin →
   Erreurs as « cron quota: … ». Visit counters and error reports
   already stop writing past a shop-wide budget (`RL_BEACON`); if orders still hit the limit, the
   Workers Paid plan ($5/month) removes it.
5. A bad deploy → §2.

## 6. Measure the speed

`npm run build && npm run test:e2e` once (starts the local test server), or leave
`node scripts/e2e-server.mjs` running, then `npm run perf` (360 px phone, slow 4G, 4× slower CPU).
`PERF_BASE=https://… npm run perf` measures the live shop. Targets: home LCP < 2.5 s locally
(< 4 s live), layout shift < 0.1.
