# Ops Panel

An operations panel for a shipping business in Iraq: an operator reviews incoming
orders, packs them, hands them to a carrier, and settles the money. Arabic-first,
right-to-left, and built for a phone, because that is what the operators use.

It is the front end of a larger system — this repository is the panel alone, and
it talks to its backend over a JSON API.

**Try it with no backend at all:**

```sh
npm install
npm run demo        # http://localhost:5173/admin
```

Demo mode answers every API call from a fixture set, signs itself in, and gives
you a working board of invented orders. Nothing leaves your machine.

## What it does

- **Order board** — orders grouped the way an operator sorts them: awaiting
  review, ready to pack, dropship, returns. Live counts, search, infinite list.
- **Order detail** — the customer, the address, the line items with live stock,
  the carrier's own status, and an arithmetic breakdown that reconciles against
  the accounting invoice.
- **Packing** — a tap-to-pack flow with a progress ring, built to be usable
  one-handed while holding a parcel. Single-item orders get a photo-first hero.
- **Carrier handoff** — printed labels, preprinted stickers, or the company's own
  riders, each with its own lifecycle.
- **Money** — operator wallets, driver ledgers, and a settlement screen that
  matches a carrier payout batch against invoices, order by order.
- **Chat** — a thread per order, plus team rooms and DMs, with mentions and push.

## Stack

SvelteKit 5 (runes) · Tailwind 4 · shadcn-svelte · TypeScript · socket.io-client

Built by `@sveltejs/adapter-static` to plain files — there is no Node server
here. Any static host will serve it.

## Fonts

Arabic and Latin text is set in open-licensed faces, so nothing here needs a
licence from anyone:

| Face | Licence | Where from |
| --- | --- | --- |
| Tajawal | SIL OFL 1.1 | Google Fonts, loaded in `src/app.html` |
| Archivo Black | SIL OFL 1.1 | Google Fonts, Latin display only |
| SN Pro | SIL OFL 1.1 | self-hosted, `src/lib/fonts/` (licence alongside it) |

`src/app-fonts.css` owns every typeface decision — the `@font-face` blocks and
both font variables. To set the panel in something else, add the face there and
put it at the front of `--font-sans`; nothing else in the stylesheet needs to
change.

## Running it

```sh
npm install
npm run demo          # fixtures, no backend needed
npm run dev           # against a real backend (see vite.config.ts proxy)
npm run check         # svelte-check — the type gate
npm run build         # static build → build/
npm run build:demo    # static build with fixtures baked in
```

`npm run check` is the only automated gate in this repository. It currently
reports 0 errors and a handful of pre-existing accessibility warnings; treat that
as the baseline.

There is also a `Dockerfile` that builds the panel and serves it through nginx:

```sh
docker build -t ops-panel-demo --build-arg BASE_PATH= --build-arg VITE_DEMO=1 .
docker run -p 8080:80 ops-panel-demo
```

`npm run build:pages` is the same demo build with `BASE_PATH=` cleared, for
hosting it at a domain root.

## Configuration

Copy `.env.example` to `.env`. Every value is optional — `src/lib/config.ts`
falls back to placeholder hosts, so the app builds and runs without any of them.

| Variable | What it is |
| --- | --- |
| `VITE_PUBLIC_ORDER_ORIGIN` | Customer-facing tracking site, for links operators send customers |
| `VITE_OPS_APP_BASE` | This app's own canonical origin, for links operators send each other |
| `VITE_PORTAL_URL` | SSO portal that owns the operator directory |
| `VITE_IMAGE_CDN` | CDN serving product images by filename |
| `VITE_CANONICAL_HOST` | Bare hostname this panel considers its own; drives the "we moved" notice. Unset disables it |
| `VITE_DEMO` | `1` runs entirely on fixtures |
| `BASE_PATH` | Path the app is mounted at. Defaults to `/admin`; set empty for the domain root |

`BASE_PATH` is read by `svelte.config.js` at build time. The API and socket paths
resolve at *runtime* from the URL prefix (`pathPrefix()` in `src/lib/api.ts`), so
one build can serve more than one mount point.

## Demo mode

`src/lib/demo/` holds the whole of it: `fixtures.ts` is the seed data and
`index.ts` answers requests from it. `rawFetch` in `src/lib/api.ts` hands every
call there when the flag is on, so no component knows the difference.

Mutations are applied to an in-memory store — approving an order really does move
it out of the review tab for the rest of the session, and a reload resets
everything. The socket stays disconnected on purpose: live updates are the one
thing a fixture set cannot honestly fake.

The fixtures are behind a dynamic import, so a production build emits them as a
chunk it never fetches.

To extend it, add a case to one of the handlers in `src/lib/demo/index.ts`. An
endpoint nobody has seeded answers empty-but-successful, so an unmodelled screen
renders its own empty state rather than throwing.

## Layout

```
src/
  routes/               board (+page), order/[id], new, settlement, sso-callback
  lib/
    api.ts              the typed API client; every network call goes through it
    config.ts           deployment config, read from VITE_* at build time
    demo/               fixture backend
    components/         the panel — OrderDetail and PackingPanel are the big ones
    components/ui/      shadcn-svelte primitives
    stores/             auth, socket, and the reactive state behind the board
    utils/              formatting, images, push, sound
static/                 icons, sounds, manifest
```

## Notes for anyone reading the code

- **Arabic is the language, not a translation layer.** Operator-facing strings are
  Arabic in the source. There is no i18n framework and no English fallback.
- **The money arithmetic is a contract.** The order detail's totals are what an
  operator reconciles against an invoice. The comments there explain which
  figures may be subtracted from each other and which may not — they are not
  decoration.
- **`AnimatedNumber.svelte` schedules itself.** Reels take a slot from a shared
  queue in DOM order, and one below the fold waits until scrolled to. A list of a
  dozen orders is two dozen counters, and starting them on one frame is what made
  cheap laptops stutter.
- **Some comments name hosts and systems that live elsewhere.** They explain why
  a piece of code is shaped the way it is — why the socket uses long-polling, why
  the API prefix is resolved at runtime. They are kept because deleting them
  would leave the reasoning unexplained, not because those things are part of
  this repository.

## License

MIT — see [LICENSE](LICENSE). That covers the code in this repository.

The bundled typefaces are not MIT and keep their own terms: SN Pro is under the
SIL Open Font License 1.1, with its licence next to the font in
`src/lib/fonts/`. Tajawal and Archivo Black are OFL too and are loaded from
Google Fonts rather than bundled.
