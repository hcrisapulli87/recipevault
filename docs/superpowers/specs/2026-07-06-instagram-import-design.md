# Instagram Recipe Import — Design

**Date:** 2026-07-06
**Status:** Approved direction (Harrison); mobile story = Supabase fetch queue (his pick).

## Goal

Import recipes from Instagram reels. People post cooking videos with the recipe
in the caption, a link to their blog in the caption, or only in the video
itself. RecipeVault should turn a pasted reel link into a draft recipe in the
existing review form — from both the desktop app and the phone PWA.

## Feasibility (proven by spike, 2026-07-06)

Tested Harrison's 5 real reel links with yt-dlp 2026.07.04 from his home IP,
no Instagram login:

| Shape | Count | Path |
|---|---|---|
| Full recipe in caption | 2/5 | heuristic caption parse |
| Blog link in caption | 2/5 | existing `/api/scrape` — both returned `structured` drafts on first try |
| No recipe, no link (video-only) | 1/5 | out of scope v1 (future Whisper transcription tier) |

Hard constraints discovered:
- Instagram has no official read API; instagram.com blocks scrapers and
  **datacenter IPs** — so fetching cannot live on Vercel. It must run from a
  residential IP: the desktop app.
- The phone PWA is a browser: it can neither run yt-dlp nor fetch
  instagram.com cross-origin. The phone always needs a relay.
- Instagram thumbnail URLs are signed and expire in days — never hot-link
  them as recipe images.
- yt-dlp breaks temporarily whenever Instagram changes internals; error
  messages must point at the fix (`pip install -U yt-dlp`).

## Architecture

### Desktop fetcher (Electron)

- New IPC channel `instagram-fetch` (add to `IPC` const): main process
  validates the URL is instagram.com/reel|/p/, spawns
  `python -m yt_dlp --skip-download --dump-json <url>` (args array, no shell,
  ~60s timeout), returns `IpcResult<{ caption, uploader }>`.
- Preload exposes exactly one function (e.g. `window.api.fetchInstagram`).
  Its absence is how the renderer detects the web build.
- Actionable errors: Python/yt-dlp missing → install hint
  (`pip install --user yt-dlp`); extraction failure → "post may be private,
  or Instagram changed something — try `pip install -U yt-dlp`".
- Dependency: system Python + pip-installed yt-dlp (already on Harrison's
  machine). Documented in README. No bundled binaries.

### Caption → recipe parser (shared, the heart)

New `src/shared/caption-recipe.ts`, pure TS (runs in browser and desktop),
fully unit-tested:

- `extractFirstUrl(caption)` — first http(s) link, if any.
- `parseCaptionRecipe(caption, meta)` → `DraftRecipe | null`:
  ingredients block = lines under an "Ingredients" header, or runs of
  bullet/emoji-prefixed lines that yield a quantity via the existing
  `parseIngredientLine`; steps = numbered lines or lines under a
  "method / instructions / how to" header; title = first non-empty caption
  line, emoji-stripped; confidence `heuristic` (review form already labels
  best-guess).
- Import decision order: caption has link → try `/api/scrape` on it
  (structured wins); else heuristic caption parse; else null → honest error
  ("No recipe found in the caption — this one probably only exists in the
  video") with the existing Enter-manually escape hatch.
- Link-followed drafts: `sourceUrl` = the **reel** URL (what Harrison saved);
  the blog URL is appended to the description so it isn't lost.
- Caption-parsed drafts get `imageUrl: null` (expiring CDN rule above).

### Mobile relay: `import_queue` (Supabase)

Transient work queue so the phone submits just the link and the PC does the
fetching:

```
import_queue: id bigint identity PK, owner_id uuid default auth.uid(),
              url text, status text check in ('pending','fetched','failed')
              default 'pending', caption text, uploader text, error text,
              created_at timestamptz default now()
```

- RLS: household read, owner insert, **household update** (the desktop app is
  signed in as Harrison but must be able to serve his partner's rows too),
  owner delete. Added to the realtime publication. Additive schema change —
  idempotent re-run, nothing destructive.
- Lifecycle: phone inserts `pending` → desktop listener (renderer-side, only
  when `window.api` exists and a session is live) sweeps pending rows on
  start + watches realtime, fetches each via the IPC channel **serially**,
  writes back `fetched`+caption or `failed`+error → submitter's phone sees
  the update via realtime, parses locally, opens the review form → save or
  discard deletes the row. Failed rows show the error with retry / delete.
- Rows persist while the PC is off ("Waiting for your desktop app…" status
  card); everything catches up when the desktop app next opens.
- On the desktop itself the queue is skipped — direct IPC, instant.

### UI (Import page, no new page)

- The existing URL input recognises Instagram links and routes them:
  desktop → direct IPC; web/PWA → queue insert + live status card.
- Pending/failed queue items are listed on the Import page (resumable:
  a `fetched` item taps open into the review form).
- Universal fallback for both targets: a "paste the caption instead" textarea
  feeding the same parser — covers yt-dlp outages and any device.

## Not changing

Vercel scrape function, review form, recipe save path, recipes schema.
Discord bot untouched. Video/audio download and Whisper transcription
(the video-only shape) deliberately deferred until proven needed.

## Deploy order

Schema re-run in the Supabase dashboard BEFORE the push (additive; only the
usual policy drop/recreate warnings), then push → Vercel deploy.

## Testing

- Unit: caption parser against the five real spike captions (all three
  shapes), URL extraction, decision order.
- Unit: queue data-layer helpers (insert/claim/update/delete) with the
  in-memory Supabase mock pattern from `data-tracker.test.ts`.
- End-to-end at finish: real reel imported on desktop via IPC; queue path
  verified with a second browser profile simulating the phone.
