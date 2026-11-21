// Audit a built site:  node tools/audit.mjs <domain> [--live]
//   default: audits dist/<domain> served locally with the same rewrite rules as the generated .htaccess
//   --live : audits https://<domain> (what visitors and Google actually get)
// Checks the "fixed means" list on the RAW HTML of every sitemap URL (no JavaScript), then re-checks a
// sample in a real browser. Writes reports/<domain>.json + .md. Exit 1 on any FAIL.
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { chromium } from 'playwright';

const domain = process.argv[2]; const LIVE = process.argv.includes('--live');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = path.join(ROOT, 'sites', domain); const DIST = path.join(ROOT, 'dist', domain);
const site = JSON.parse(fs.readFileSync(path.join(SITE, 'site.json'), 'utf8'));
const links = JSON.parse(fs.readFileSync(path.join(SITE, 'links.json'), 'utf8'));
const ORIGIN = `https://${domain}`;
const ga = /^G-[A-Z0-9]{6,12}$/.test(site.ga4_id || '') ? site.ga4_id : null;
const client = site.adsense_client || 'ca-pub-4897434778726769';
const ADS_LINE = `google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0`;

let BASE = ORIGIN, srv;
if (!LIVE) {
  srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const p = u.replace(/\/+$/, '');
    let f = null;
    if (p === '' ) f = path.join(DIST, 'index.html');
    else if (fs.existsSync(path.join(DIST, '_pages', p + '.html'))) f = path.join(DIST, '_pages', p + '.html');
    else if (fs.existsSync(path.join(DIST, p)) && fs.statSync(path.join(DIST, p)).isFile()) f = path.join(DIST, p);
    else f = path.join(DIST, '_shell.html');
    const ext = path.extname(f); const ct = { '.html': 'text/html', '.txt': 'text/plain', '.xml': 'application/xml', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': ct }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, r)); BASE = `http://127.0.0.1:${srv.address().port}`;
}
const get = async p => { const r = await fetch(BASE + p, { redirect: 'follow', headers: { 'user-agent': 'tourism-sites-audit/1.0' } }); return { status: r.status, ct: r.headers.get('content-type') || '', text: await r.text() }; };

const fails = [], warns = [], pending = [];
const F = (m) => fails.push(m), W = (m) => warns.push(m);

// sitemap
const sm = await get('/sitemap.xml');
const routes = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname.replace(/\/+$/, '') || '/');
if (routes.length < 10) F(`sitemap.xml has only ${routes.length} URLs`);
const routeSet = new Set(routes);
const matchReq = r => (site.booking_required || []).some(pat => pat.endsWith('/*') ? (r.startsWith(pat.slice(0, -1)) && r.length > pat.length - 1) : r === pat);

// ads.txt
const ads = await get('/ads.txt');
if (ads.status !== 200 || ads.text.trim() !== ADS_LINE || /html/i.test(ads.ct)) F(`/ads.txt does not return exactly "${ADS_LINE}" (status ${ads.status}, type ${ads.ct}, starts "${ads.text.slice(0, 40).replace(/\n/g, ' ')}")`);
if (!ga) pending.push(`GA4 measurement ID not set (site.json ga4_id = "${site.ga4_id || ''}") — every page is ready, the tag is added on the next build once the ID is filled in`);

const T = site.trust; const trustPaths = [T.about, T.contact, T.privacy, T.terms];
for (const t of trustPaths) if (!routeSet.has(t)) F(`trust page ${t} is not in the sitemap`);

const fileOk = p => !LIVE && fs.existsSync(path.join(DIST, p)) && fs.statSync(path.join(DIST, p)).isFile();
const internal = new Set(); const perPage = [];
for (const r of routes) {
  const { status, text } = await get(r); const row = { route: r, status };
  if (status !== 200) { F(`${r}: HTTP ${status}`); continue; }
  const head = (text.match(/<head[\s\S]*?<\/head>/i) || [''])[0];
  const canon = [...head.matchAll(/<link[^>]+rel="canonical"[^>]*>/gi)].map(m => (m[0].match(/href="([^"]+)"/) || [])[1]);
  const want = ORIGIN + (r === '/' ? '/' : r);
  if (canon.length !== 1) F(`${r}: ${canon.length} canonical tags in raw HTML`);
  else if (canon[0] !== want && !(r === '/' && canon[0] === ORIGIN)) F(`${r}: canonical is ${canon[0]}, expected ${want}`);
  if (!head.includes(`adsbygoogle.js?client=${client}`)) F(`${r}: AdSense script missing from <head>`);
  if (ga && !(head.includes(`googletagmanager.com/gtag/js?id=${ga}`) && head.includes(`gtag('config','${ga}')`))) F(`${r}: GA4 tag ${ga} missing from <head>`);
  if ((text.match(/<h1[\s>]/g) || []).length < 1) F(`${r}: no <h1> in raw HTML (page not pre-rendered)`);
  const footer = (text.match(/<footer[\s\S]*?<\/footer>/i) || [''])[0];
  const fl = new Set([...footer.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/\/+$/, '') || '/'));
  for (const t of trustPaths) if (!fl.has(t)) F(`${r}: footer has no link to ${t}`);
  const book = (text.match(/<aside id="tsa-book"[\s\S]*?<\/aside>/) || [''])[0];
  const cfgLinks = links.routes[r];
  if (matchReq(r) && !cfgLinks) F(`${r}: tour/attraction page has no entry in links.json`);
  if (cfgLinks) {
    if (!book) F(`${r}: booking button missing`);
    else {
      const as = [...book.matchAll(/<a [^>]*class="tsa-btn[^>]*>/g)].map(m => m[0]);
      if (as.length !== cfgLinks.length) F(`${r}: ${as.length} booking links rendered, ${cfgLinks.length} in links.json`);
      for (const a of as) { if (!/rel="[^"]*sponsored[^"]*nofollow/.test(a)) F(`${r}: booking link missing rel="sponsored nofollow"`); }
      if (!book.includes(links.disclosure.slice(0, 30))) F(`${r}: affiliate disclosure missing next to booking button`);
    }
  }
  if (r === T.privacy) {
    const low = text.toLowerCase();
    for (const [k, msg] of [['adssettings.google.com', 'link to adssettings.google.com'], ['aboutads.info', 'link to www.aboutads.info'], ["prior visits", 'third-party vendor / prior-visits cookie statement'], ['google analytics', 'Google Analytics statement']]) if (!low.includes(k)) F(`privacy policy missing ${msg}`);
  }
  if (r === T.contact && !/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text.replace(/<[^>]+>/g, ' '))) F(`contact page shows no email address`);
  for (const m of text.matchAll(/<img [^>]*src="(\/[^"?#]+)/g)) if (!LIVE && !fileOk(decodeURIComponent(m[1]))) F(`${r}: image missing from build: ${m[1]}`);
  for (const m of text.matchAll(/<a [^>]*href="(\/[^"#?]*)/g)) internal.add(m[1].replace(/\/+$/, '') || '/');
  row.booking = !!book; perPage.push(row);
}
for (const k of Object.keys(links.routes)) if (!routeSet.has(k)) F(`links.json has an entry for ${k}, which is not a page on the site`);
for (const [k, v] of Object.entries(links.routes)) for (const it of v) { try { const u = new URL(it.url); if (u.protocol !== 'https:') F(`links.json ${k}: not https`); } catch { F(`links.json ${k}: invalid URL ${it.url}`); } }
const redir = site.redirects || {};
for (const l of internal) if (redir[l] && routeSet.has(redir[l])) W(`link to unwritten page ${l} (temporarily redirected to ${redir[l]})`); else if (!routeSet.has(l) && !fileOk(l) && !/\.(svg|png|jpe?g|webp|xml|txt|pdf|ico)$/.test(l)) F(`broken internal link: ${l}`);

// real-browser pass on a sample: hydration must keep exactly one canonical + the booking block, no JS errors
const sample = [...new Set(['/', T.privacy, ...Object.keys(links.routes).slice(0, 4), routes[Math.floor(routes.length / 2)]])];
const b = await chromium.launch(); const ctx = await b.newContext();
await ctx.route(/googletagmanager|googlesyndication|google-analytics|doubleclick/, r => r.abort());
const pg = await ctx.newPage(); const jsErr = [];
pg.on('pageerror', e => jsErr.push(String(e).slice(0, 160)));
for (const r of sample) {
  await pg.goto(BASE + r, { waitUntil: 'networkidle' }); await pg.waitForTimeout(800);
  const s = await pg.evaluate(() => ({ canon: document.querySelectorAll('link[rel=canonical]').length, book: !!document.getElementById('tsa-book'), main: (document.querySelector('main') || {}).innerText?.length || 0, adsPriv: !!document.getElementById('tsa-ads-privacy') }));
  if (s.canon !== 1) F(`${r} (rendered): ${s.canon} canonical tags after the app loads`);
  if (links.routes[r] && !s.book) F(`${r} (rendered): booking button disappears after the app loads`);
  if (r === T.privacy && !s.adsPriv) F(`${r} (rendered): advertising-cookie wording disappears after the app loads`);
  if (s.main < 200) F(`${r} (rendered): page body nearly empty after app loads`);
}
await b.close(); if (srv) srv.close();
if (jsErr.length) W(`JavaScript errors in browser: ${[...new Set(jsErr)].slice(0, 3).join(' | ')}`);

const report = { domain, mode: LIVE ? 'live' : 'dist', when: new Date().toISOString(), pages: routes.length, booking_pages: perPage.filter(p => p.booking).length, fails, warns, pending, ok: fails.length === 0 };
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
const tag = LIVE ? `${domain}.live` : domain;
fs.writeFileSync(path.join(ROOT, 'reports', `${tag}.json`), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(ROOT, 'reports', `${tag}.md`), `# ${domain} audit (${report.mode}) — ${report.when.slice(0, 10)}\n\n${report.ok ? 'PASS' : 'FAIL'}: ${routes.length} pages, ${report.booking_pages} with booking buttons\n\n## Failures (${fails.length})\n${fails.map(x => '- ' + x).join('\n') || '- none'}\n\n## Waiting on Aaron (${pending.length})\n${pending.map(x => '- ' + x).join('\n') || '- none'}\n\n## Warnings (${warns.length})\n${warns.map(x => '- ' + x).join('\n') || '- none'}\n`);
console.log(JSON.stringify({ domain, mode: report.mode, ok: report.ok, pages: routes.length, booking_pages: report.booking_pages, fails: fails.length, pending: pending.length, warns: warns.length, first_fails: fails.slice(0, 8) }));
process.exit(report.ok ? 0 : 1);
