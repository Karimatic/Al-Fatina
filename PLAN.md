# Al Fatina — master plan

> **Al Fatina / الفاتنة**, online women's clothing shop in Algeria (Instagram
> [@el_fatina_](https://www.instagram.com/el_fatina_/)). Delivery to the 69 wilayas, cash on delivery,
> Arabic first (right to left) + French.
>
> Built on a fresh clone of the owner's Henine-Boutique engine, which is already proven in production:
> security, speed, admin, Telegram, tests. Al Fatina gets its own brand, its own design and its own
> Cloudflare resources.
>
> Design reference: the **LilySilk** storefront style (lilysilk.com), matched in spirit, nothing copied.

---

## 1. Goals

| Goal | How it is met |
|---|---|
| Best possible store for Al Fatina | Calm, luxurious silk-shop look; fast pages; ordering in 3 taps; tracking without an account |
| Complete admin panel, phone first | 21 tabs (§6), one-hand use on a phone, live new-order alerts |
| Secure on every side | §5: CSP with hashes, signed sessions + authenticator app, rate limits, audit log, no secrets in code |
| Cloudflare free tier only | §4: a Worker serving pre-rendered pages, D1, R2, one cron, Durable Object; budget table |
| Super fast with good loading scenes | §7: static HTML at the edge, skeletons sized like the content, splash once, budgets in CI |
| Orders in a Telegram group | §8: bot posts every order with action buttons; topics per kind of message |
| Easiest possible order tracking | §9: phone number + order code, a link in the thank-you page, optional Telegram updates |

## 2. Design: "silk luxe" (LilySilk style)

- **Palette:**
  - White page; cream sections `#f7f3ee`; warm hairlines `#e6ded4`.
  - Charcoal text `#222222` and secondary text `#6b6259` (AA on white and on cream).
  - Charcoal buttons; one muted gold `#a8875a` for small details only.
  - Deep burgundy `#a3122a` for sale badges and sale prices only.
- **Type:** Jost (a clean geometric sans).
  - Headings and navigation: capitals with generous letter-spacing.
  - Body text: mixed case.
  - Arabic: Tajawal for text, Noto Kufi Arabic for headings, never letter-spaced.
- **Shapes:** soft 2 px corners on buttons and fields, no pills. Product photos with a cream
  background behind them. Lots of white space.
- **Header (every page):**
  - a thin cream service strip: "Livraison 69 wilayas · Paiement à la livraison · WhatsApp";
  - a dark loyalty strip: "Al Fatina Club: des points à chaque commande";
  - the main bar:
    - **computer:** logo on the left, capital category links, then search, favourites and bag;
    - **phone:** ☰ on the left, logo in the middle, search and bag on the right.
- **Home page:**
  1. full-width hero photo (silk) with the message on the left and two dark buttons;
  2. "Tendances" product carousel;
  3. two large category banners side by side, with titles and "Découvrir";
  4. "La sélection" with tabs: Nouveautés / Meilleures ventes / Promotions;
  5. brand promises (delivery, payment, exchange) on cream;
  6. reviews; Instagram; newsletter;
  7. "À explorer" grid of linked blocks.
- **Product card:** photo with a burgundy "−30 %" badge top-left. Under it the name, the price (sale
  price in burgundy next to the struck-out price) and a small grey category tag. The heart and quick
  add appear on the photo.
- **Product page:** gallery (swipe on phones), name in capitals, price, size and colour, a big
  charcoal "Commander" button, delivery estimate per wilaya, size guide, then the description and
  delivery & returns.
- **Footer:** cream, four link columns + Al Fatina Club. Then a thin legal bar.
- **Logo:** "AL FATINA" in widely spaced Jost capitals. App icon: the "EF" monogram, charcoal on cream.

## 3. Pages (Arabic at `/`, French at `/fr`)

| Page | Content |
|---|---|
| Accueil | §2 home |
| Catégories, `/c/<slug>` | title, item count, filters (on sale, price), grid 2/3/4 columns |
| Produit | §2 product page, reviews with photos, similar pieces, "Compléter la tenue" |
| Nouveautés, Promotions, Collections, Drops | lists with their own banners, countdown for drops |
| Recherche | instant search with suggestions |
| Panier, Commande | one-page checkout: name, phone, wilaya, commune, home or stop-desk delivery, promo code, loyalty points |
| Merci | order code, tracking link, "Suivre sur Telegram" button |
| Suivi | tracking (§9) |
| Favoris, Tenue | saved pieces; outfit builder |
| Contact, pages légales | contact form (goes to the admin and Telegram); CGV, privacy, delivery & returns, about |

## 4. Cloudflare free tier architecture

- **One Worker (`el-fatina`) with Static Assets:**
  - the storefront pages are pre-rendered HTML and served free (they never count against Worker
    requests);
  - the Worker runs only for `/api/*`, `/admin/*`, `/media/*`, product and category pages, sitemap,
    robots and feeds.
- **D1 `el-fatina-db`:**
  - products, orders, customers, reviews, promos, loyalty, team, settings, audit, outbox;
  - indexes on every lookup;
  - writes batched, and counters capped by the `RL_BEACON*` limits so orders always keep their
    share of the daily quota.
- **R2 `el-fatina-media`:** product photos and videos, served from `/media/*` with long-lived caching.
  Photos are resized and framed once at upload (Cloudflare Images free allowance, falling back to the
  original photo).
- **Durable Object `AdminHub`:** live admin (new orders, alerts) over WebSockets with hibernation
  (zero cost when idle).
- **Cron:** **one** trigger every 5 minutes (the account shares the 5 free triggers with Henine,
  which uses 3).
  - The tick's time picks the work: Telegram outbox, alerts and pushes every 5 minutes; callbacks
    and the quota check every 30 minutes; the daily report and data purge at 21:00 Algiers.
- **Rate limits:** namespaces 2001–2006 (Henine uses 1001–1006 on the same account).
- **Workers AI** (free allocation): shop assistant and FR↔AR translation in the admin. Without it the
  rules still answer.
- **Free-tier budget:**
  - 100k Worker requests a day: only API calls count, pages are static.
  - D1: 5M row reads and 100k writes a day, warned in Telegram at 50 % and 80 %.
  - R2: 10 GB and 1M writes a month.
  - Durable Objects and Workers Logs are within their free allowances.

## 5. Security

- **Headers:**
  - strict CSP: per-page sha256 hashes for inline scripts, no `unsafe-inline` scripts,
    `frame-ancestors 'none'`;
  - HSTS preload, nosniff, Referrer-Policy, Permissions-Policy.
- **Admin sign-in:**
  - only through an invitation link (single use, 7 days);
  - password hashed with PBKDF2 plus a server pepper, authenticator app required, recovery codes;
  - sessions in HttpOnly SameSite=Strict cookies, revocable per device;
  - each role has only the rights it needs, and they are checked on every API route.
- **Customers:** no account needed. Tracking needs the phone number plus the order code, and the
  tracking token is hashed with its own pepper. Personal data is purged after its retention period.
- **Abuse:**
  - Cloudflare rate limits on writes, lookups, sign-in and AI;
  - honeypot and timing checks on forms;
  - duplicate- and fake-order detection (same phone, many orders), with a risk score shown to the
    confirmation team.
- **Data:**
  - every admin action is written to the audit log;
  - errors and browser reports (CSP, NEL) land in Admin → Erreurs;
  - weekly encrypted backups with a restore drill (GitHub Actions);
  - secrets live only in Cloudflare (`wrangler secret`), never in the repo.
- **Tests:** security unit tests (permissions, CSP, rate limits) and browser tests run on every push.

## 6. Admin panel (`/admin`, phone first, French + Arabic)

Bottom tab bar on phones (Accueil · Commandes · Produits · Clients · Plus), sidebar on computers,
search over everything, live badge on new orders.

**Tableau de bord**
- Today's orders, revenue, orders to confirm, parcels to ship and low stock.
- A 7-day chart, the last orders, alerts, and the daily report.

### Catalogue
- **Produits:**
  - list with photo, price, stock, status and filters;
  - step-by-step wizard (photos with automatic background cleanup, names FR/AR with auto
    translation, category, sizes × colours with a stock each, price and old price, tags,
    "coup de cœur");
  - duplicates; video; publish or hide.
- **Stock:**
  - stock per size and colour, the movement history (who, when, why) and low-stock alerts;
  - an inventory count with differences; restock notifications to waiting customers.
- **Ventes:** sales list and receipts, plus the cash screen for sales outside the site (Instagram DMs,
  phone orders).

### Commandes
- **Commandes:**
  - every order with its status: new → confirmed → prepared → shipped → delivered / returned /
    cancelled;
  - one-tap status bar, call and WhatsApp buttons, a risk score;
  - notes, history, invoices and delivery slips;
  - Préparation (packing list) and Expéditions (courier export).
- **Clients:** every customer with orders, spending, returns, points, notes, a blacklist, and a delete
  on request (privacy law 18-07).
- **Paniers:**
  - **(restored for Al Fatina)** checkouts started but not finished: name, phone, pieces, total and
    time;
  - call or WhatsApp in one tap, a restore link that refills her cart;
  - purged automatically.
- **Promos:**
  - promo codes (percentage, amount, free delivery, minimum, dates, uses per customer);
  - flash sales with countdown; collections and drops.
- **Fidélité:** Al Fatina Club settings (points per DA, value of a point, expiry, welcome bonus),
  member list, manual adjustments with a reason.

### Marketing
- **Page d'accueil:**
  - hero photo or video, banners, the "sélection", announcement messages;
  - order and visibility of the home sections, colours and fonts.
- **Avis:** review moderation (photos), replies, featured reviews; only customers who received the
  piece can review.
- **Notifier:**
  - web-push campaigns to subscribers, restock alerts;
  - message templates for WhatsApp and Telegram.
- **Liens:** link-in-bio page for Instagram with clicks per link.
- **Contact:** messages from the contact form, answered status, digest to Telegram.

### Analyse
- **Statistiques:**
  - visits, conversion, orders by wilaya, best pieces, return rate;
  - Finance (revenue, costs, delivery fees, margin) and Sources (Instagram, TikTok, links, direct).

### Système
- **Équipe:** people as cards, roles in plain words (Propriétaire, Gérante, Confirmatrice,
  Préparation / Stock, Marketing, Lecture seule, Sur mesure), invite by WhatsApp link.
- **Comptes:** **(own tab again)** the sign-in accounts: each account's rights, sessions, sign-in
  link, sign out, switch off.
- **Contenu:** the store's texts (FR/AR), legal pages, FAQ, size guides.
- **Erreurs:** errors from the Worker, the store and the browsers (CSP, network), grouped, with the
  page and the time.
- **Paramètres:** shop identity, delivery prices per wilaya (home and stop desk), courier, Telegram,
  pixels, order rules, privacy.

## 7. Speed and loading scenes

- **Pages:** every store page is pre-rendered at build and served by the edge cache; the data comes
  from small cached API calls.
- **Budgets:** about 70 KB JS and 30 KB CSS gzip per page, LCP < 2.5 s on a mid-range phone over 4G,
  CLS < 0.05.
- **Loading scenes:**
  - a short brand splash once per visit (≤ 1 s, skipped with reduced motion);
  - skeletons the exact size of what they replace (no jumps);
  - photos show a blurred preview first and fade in;
  - page-to-page transitions (View Transitions).
- **Assets:** responsive images, lazy below the fold; fonts are self-hosted, subset and preloaded.

## 8. Telegram

- **A bot in the team group.** Each new order arrives as a message (pieces, sizes, total,
  wilaya/commune, phone, risk) with buttons to confirm or cancel.
- **Daily report** at 21:00 and quota warnings.
- **Delivery:** sent through an outbox with retries, so no order notice is lost.
- **Team accounts:** linked to Telegram so a button press is signed by the right person.

## 9. Order tracking (the easiest way)

1. The thank-you page shows the **order code** and a **"Suivre ma commande"** link. The link carries
   a private token, so it opens directly with no typing.
2. Anyone can open **/suivi**, type the phone number + order code, and see a timeline (reçue →
   confirmée → préparée → expédiée → livrée) with dates and the courier's tracking number.
3. The bottom bar's **Commandes** tab remembers her last order on this phone and opens it directly.

## 10. Phases

| # | Phase | State |
|---|---|---|
| 0 | Fresh clone, rebrand to Al Fatina, separation from Henine (resources, limits, cron) | done |
| 1 | LilySilk-style design: tokens, header, home, cards, product page, footer, icons | done |
| 2 | Admin: Paniers restored (migration 0012), Comptes tab, Al Fatina colours | done |
| 3 | Checks: types, lint, 253 unit tests, 86 browser tests (phone + computer, FR + AR, accessibility) | done |
| 4 | Deploy to staging (workers.dev), live checks | to do |
| 5 | Owner content: products and photos, prices, delivery grid, Telegram bot, contact | owner |
| 6 | Domain, then launch | owner |

## 11. Waiting on the owner

- Products and photos (the product wizard). The hero and banner photos.
- Telegram: create the bot (@BotFather), add it to the group, paste the token in
  Admin → Paramètres → Connexions.
- Phone / WhatsApp / Instagram (Admin → Contact), delivery prices and courier.
- A domain name; GitHub secrets for automatic deploys and backups.
