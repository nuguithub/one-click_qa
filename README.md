# One-Click QA

A Manifest V3 Chrome extension that scans the page you are looking at for common
QA and accessibility problems, outlines what it finds directly on the page, and
reports the details in the side panel.

One click on the toolbar icon does everything. There is no popup to click through
and nothing to configure.

## What it checks

**Headings** — the H1 to H6 tree, flagging skipped levels, empty headings, and a
page with more than one H1. Each heading level has its own colour, mirrored in the
panel and on the page.

**Links** — anchor text quality (empty text, generic text like "click here",
placeholder `href`s such as `#` or `javascript:void(0)`), link targets
(same tab vs. new tab), and live HTTP status for every checkable URL. Redirects
are followed and reported with their final destination.

**Images** — missing `alt`, empty `alt`, and alt text long enough to be ignored
by screen readers.

**Metadata** — title length, meta description length, canonical URL, and
`robots` directives. These have no on-page highlight, since there is nothing on
the page to point at.

## Design constraints

These drove the implementation and explain most of the code:

- **The page must never move.** Highlights use `outline` only, never `background`,
  `border` or `padding`, so the document cannot reflow. A QA tool that shifts the
  layout while you inspect it is unusable.
- **Injected UI cannot be styled by, or style, the page.** Highlights live in a
  Shadow DOM attached to `<html>`, and the host is positioned with inline
  `!important` styles so it wins against any page stylesheet.
- **Badges must not need repositioning.** They are placed in document
  coordinates, so scrolling moves them with their elements for free. This is the
  single most important performance decision in the highlight engine.
- **Everything must be removable.** Closing the panel clears every outline and
  badge. Original inline outline values are saved and restored byte for byte.
- **The checker must be polite.** Requests run at a fixed concurrency with a hard
  per-request timeout and a cap on how many URLs a single scan will touch.

## Requirements

- Node.js 20 or newer
- Google Chrome, or any Chromium browser that supports MV3 side panels

## Install for development

```bash
npm install
npm run build
```

Then load it:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the generated `dist/` folder

`dist/` is build output and is not committed. After any change, run `npm run build`
and press the reload button on the extension card in `chrome://extensions`.

> Chrome caches extension icons aggressively. If an icon change does not appear,
> close and reopen the browser.

## Test page

The content script only runs on `http`/`https` pages, so a test page cannot be
opened over `file://`. A dependency-free static server is included:

```bash
npm run serve
```

- <http://localhost:4173/test/fixture.html> — a page with known, annotated
  problems in every category
- <http://localhost:4173/test/many-links?n=300> — 300 generated links (every
  tenth broken) for testing the URL cap and concurrency

The server also exposes routes that exist purely to exercise the link checker's
branches, so the tests are deterministic and no traffic reaches a third party:

| Route | Behaviour | Exercises |
| --- | --- | --- |
| `/not-found` | `404` | broken link |
| `/server-error` | `500` | server error |
| `/head-not-allowed` | `405` on HEAD, `200` on GET | HEAD to GET fallback |
| `/redirect-to?url=…` | `302` | redirect detection, final URL |
| `/slow` | hangs 30s | request timeout |
| `/ok…` | `200` | healthy link |

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run build:fast` | Build without type-checking, for quick iteration |
| `npm run typecheck` | Type-check only |
| `npm run serve` | Static test server on port 4173 (`PORT` overrides) |
| `npm run dev` | Vite dev server with hot reload |
| `npm run icons` | Generate placeholder icons, **only if they are missing** |

`npm run icons` will not overwrite existing icons. Pass `--force` to replace
them: `npm run icons -- --force`. If you replace the artwork, drop your files at
`public/icon-16.png`, `icon-32.png`, `icon-48.png` and `icon-128.png` — that is
the only place the build reads icons from.

## Configuration

Every threshold, colour and network limit lives in
[`src/shared/config.ts`](src/shared/config.ts). Nothing else hard-codes a magic
number.

| Setting | Default | Notes |
| --- | --- | --- |
| `LINK_CHECK_MAX_URLS` | 250 | Unique URLs checked per scan. Extra links are reported as skipped. |
| `LINK_CHECK_CONCURRENCY` | 6 | Simultaneous in-flight requests |
| `LINK_CHECK_TIMEOUT_MS` | 10000 | Per-request abort timeout |
| `BROKEN_STATUS_MIN` | 400 | 4xx and 5xx count as broken |
| `META_DESCRIPTION_MIN` / `MAX` | 120 / 160 | Warns outside Google's truncation range |
| `ALT_MAX_LENGTH` | 125 | Longer alt text is flagged as stuffing |

Layer visibility (which highlights are drawn) persists in
`chrome.storage.local`.

## How it is put together

```
manifest.config.ts     MV3 manifest (typed, so bad paths fail the build)
vite.config.ts         CRXJS + React + Tailwind
src/
  shared/              types and config, imported by all three contexts
  background/          side panel wiring and the link checker
  content/             the scanners and the highlight engine
  sidepanel/           the React report UI
scripts/
  serve.mjs            test server and checker fixtures
  make-icons.mjs       placeholder icon generator
test/fixture.html      annotated fixture page
```

The three contexts share `src/shared` only. They communicate by typed messages
defined in `src/shared/types.ts`; no context reaches into another directly.

### Why a long-lived port

Manifest V3 service workers are killed after ~30 seconds idle, which would
interrupt a long link check. The side panel opens a `chrome.runtime.Port` on
mount, and holding a port keeps the worker alive for as long as the panel is
open. The port is also how the extension learns the panel has closed, so it can
tell the content script to strip every highlight.

### Link checking

The checker runs in the background worker rather than the page because the page
cannot read cross-origin status codes — CORS blocks exactly the requests a link
audit needs. Extension host permissions grant that bypass.

- one request per unique URL, so a link repeated 50 times is fetched once
- `HEAD` first, falling back to `GET` when a server rejects `HEAD`
- `redirect: "manual"` so a redirect is reported rather than silently followed
- `AbortController` for the per-request timeout
- results stream back to the panel in small batches, and repaint the page as
  each one lands, rather than waiting for the whole run

## Known behaviour

- When the tab navigates to a new page, the report is cleared and you are asked
  to rescan. This is deliberate: auto-rescanning on every navigation would fire
  up to 250 requests every time you browse with the panel open.
- `mailto:`, `tel:`, `sms:`, `data:` and `javascript:` links are listed but never
  sent to the network, and are drawn grey.
- Only the top-level frame is scanned (`all_frames: false`).

## Licence

MIT
