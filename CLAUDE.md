# tourism-sites — spec for every Claude task that touches this repo

Aaron's exact-match-domain tourism guides. Monetized with Google AdSense (Auto ads once approved), GA4, and affiliate booking links (GetYourGuide, Viator, Tiqets, Booking.com, plus official ticket sites). This file is authoritative for the weekly audit and Write & Publish tasks.

## Sites
| domain | pages (Nov 2026) | booking pages | notes |
|---|---|---|---|
| petratourism.com | 103 | 17 | 7 temporary redirects for linked-but-unwritten pages (site.json `redirects`) |
| gizatourism.com | 103 | 28 | privacy/terms/cookies are static pages in `pages/` |
| tbilisitourism.com | 54 | 17 | |
| tashkenttourism.com | 42 | 17 | privacy page is `/privacy-policy`; contact email added via site.json `append` |
| northmacedoniatourism.com | 73 | 22 | privacy/terms are static pages in `pages/` |

## How it works
There is **no React source** for these sites. `sites/<domain>/app/` is the compiled Vite/React build mirrored from the live site (`node tools/mirror.mjs <domain>`). Everything else is layered on by `tools/build.mjs`:

- `<head>` of every page: GA4 gtag (from `site.json` `ga4_id`), the AdSense script (`adsense_client`), the runtime config, and `tsa-addons.<hash>.js`.
- `tools/tsa-addons.js` (shared runtime) adds on each route: the booking button block from `links.json` (rel="sponsored nofollow", one-line disclosure), the AdSense/GA4 advertising-cookie wording on the privacy page, footer links to about/contact/privacy/terms when the app's footer lacks them, "More guides" lists on section hubs for static pages, per-page `append` blocks, and the temporary-redirect link fixes.
- Every sitemap route is **pre-rendered** with Playwright into `dist/<domain>/_pages/<route>.html` (home → `index.html`), so the raw HTML that Google and AdSense see has content, one canonical, GA4, AdSense, the booking block and the footer links. The app then boots on top.
- `pages/*.json` are **static pages** (no React): built from the chrome of the about page with `body_html` as content. Use these for every new page. Only `"status": "published"` is built; `"draft"` is ignored.
- Also written: `ads.txt` (exact AdSense line), `.htaccess` (https/bare-domain, no trailing slash, pre-rendered pages, 302s, SPA fallback `_shell.html`), `robots.txt`, `sitemap.xml` (SPA routes + published static pages).

Push to `main` → GitHub Action builds + audits every site → publishes `dist/<domain>` to branch `deploy-<domain>` → Hostinger Git auto-deploy pulls it into that site's `public_html`. **A failing audit blocks that site's deploy.** Never edit `dist/` or the deploy branches.

## Commands
```
npm install && npx playwright install chromium     # once
node tools/build.mjs <domain>                       # → dist/<domain>
node tools/audit.mjs <domain>                       # audits dist; exit 1 on any failure
node tools/audit.mjs <domain> --live                # audits the live site
node tools/mirror.mjs <domain>                      # re-mirror app/ from live (only if Aaron redeployed by hand)
```
In the Claude cloud sandbox: prefix with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` and symlink `node_modules/playwright` to `/opt/npm-tools/node_modules/playwright` if npm can't install.

## Config files (the only things Aaron should ever need to touch)
- `sites/<domain>/site.json` — `ga4_id` (`G-XXXXXXXXXX`; placeholder = tag left out and audit reports it as pending), `adsense_client`, `accent`, `contact_email`, `trust` paths, `booking_required` (routes that must have a booking button; `/x/*` = all children), `redirects`, `append`.
- `sites/<domain>/links.json` — `routes`: page path → list of `{label, url, provider}` (first = main button). `affiliate_ids.getyourguide_partner_id` / `viator_pid` / `tiqets_partner` are appended to matching URLs automatically at build. An explicit tracking URL in `url` is left untouched.

## Rules
1. **Accuracy first.** Never publish a fact you could not verify against an official source (site/ministry/operator) or two agreeing reputable sources from the last 12 months. Prices, hours, ticket rules and transport change — date them ("as of Nov 2026").
2. **Never put Aaron's name, personal email or contact details on any site.** Site contact is `hello@<domain>` only.
3. Fact fixes inside the compiled app (`app/assets/index-*.js`): allowed only as an exact string replacement where the old string occurs **exactly once**, the change is a fact (price, hour, date, name), and you log it in `sites/<domain>/CHANGELOG.md` with the source URL. Never restructure the bundle. If a fix needs more than that, write it up for Aaron instead.
4. New pages are **static pages** (`pages/<slug>.json`). Schema: `{path, title, description, section, eyebrow?, dateline, updated, status, body_html, sources:[{url,title,accessed}]}`. 900–1,800 words, the site's existing voice (independent, tested, specific), `<h2>`/`<p>`/`<ul>`/`<table>` only, internal links only to routes in the sitemap, no inline styles, no images unless licensed with attribution. Publishing a page at a path listed in `redirects` automatically retires that redirect.
5. Every tour/attraction page (`booking_required`) must have a `links.json` entry. New tour/attraction pages get one in the same commit. Only https URLs to the official ticket site or GetYourGuide/Viator/Tiqets/Booking.com.
6. The build's audit must pass before you push. Never loosen `tools/audit.mjs` to make a build pass — fix the site.
7. Commit identity: reuse the repo's last commit author (`git log -1 --format='%an <%ae>'`). Push to `main`, then prove it landed: `git ls-remote origin refs/heads/main` == local HEAD. Then confirm the Action succeeded and the change is live (`node tools/audit.mjs <domain> --live`).

## Content queue and approvals
- `sites/<domain>/content_ideas.json` — `{ideas:[{id, date, title, path, section, search_phrase, why, priority, status}]}`; status `proposed` → `drafted` → `published` | `discarded`.
- Drafts are written as `pages/<slug>.json` with `"status": "draft"` (pushed to main; drafts are not built), plus a Google Doc for review.
- Aaron approves on his shared **Site Approvals** page (artifact `https://claude.ai/artifact/AXUrNrYvA99Q4uFELzrH8u`, collection `drafts`, row id `<domain>-<idea id>`, fields `site, idea_id, title, why_now, doc_url, status ("pending"), trigger_id, created, updated, result_url, result_note`). `trigger_id` = the "Tourism sites: Write & Publish" task. Publish → that task sets the page to `published` and pushes. Discard → status `discarded`, page file deleted.

## Weekly schedule (one task per site, 6:37 PM ET)
Sun petratourism.com · Mon gizatourism.com · Tue tbilisitourism.com · Wed tashkenttourism.com · Thu northmacedoniatourism.com. Fri/Sat are free for sites 6–7; with 8–10 sites, pair a second site onto the lightest days (each run still handles only ONE site). Publishing from the approvals page is a separate task (trig_01DZ14PNCjVWkJKbntvyeUSr) shared by all sites.

## Adding a new tourism site
1. `node tools/mirror.mjs <domain>` (site must be live on Hostinger first), then write `sites/<domain>/site.json`, `links.json` (an entry for every tour/attraction page), `content_ideas.json`, and `pages/*.json` for any missing privacy/terms page. Build + audit until 0 failures.
2. Push. The Action picks up any `sites/<domain>/` with a site.json automatically and creates `deploy-<domain>`.
3. Aaron connects Hostinger Git for the site (branch `deploy-<domain>`) and adds its GA4 ID.
4. Create that site's weekly scheduled task by copying an existing one's prompt with the domain swapped, on a free weekday.
