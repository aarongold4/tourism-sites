// Build one tourism site:  node tools/build.mjs <domain>
// sites/<domain>/app (mirrored compiled SPA)  +  site.json / links.json / pages/*.json  ->  dist/<domain>
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import crypto from 'node:crypto';
import { chromium } from 'playwright';

const domain = process.argv[2];
if (!domain) { console.error('usage: node tools/build.mjs <domain>'); process.exit(2); }
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = path.join(ROOT, 'sites', domain);
const OUT = path.join(ROOT, 'dist', domain);
const read = f => JSON.parse(fs.readFileSync(path.join(SITE, f), 'utf8'));
const site = read('site.json');
const links = read('links.json');
const ORIGIN = `https://${domain}`;
const GA_RE = /^G-[A-Z0-9]{6,12}$/;
const ga = GA_RE.test(site.ga4_id || '') ? site.ga4_id : null;
const client = site.adsense_client || 'ca-pub-4897434778726769';
const pub = client.replace(/^ca-/, '');

// ---------- 1. copy app ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(SITE, 'app'), OUT, { recursive: true });
const addonsSrc = fs.readFileSync(path.join(ROOT, 'tools', 'tsa-addons.js'), 'utf8');
const addonsName = `tsa-addons.${crypto.createHash('sha1').update(addonsSrc).digest('hex').slice(0, 8)}.js`;
fs.writeFileSync(path.join(OUT, addonsName), addonsSrc);

// ---------- 2. static pages (published only) ----------
const pagesDir = path.join(SITE, 'pages');
const pages = fs.existsSync(pagesDir) ? fs.readdirSync(pagesDir).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf8'))).filter(p => p.status === 'published') : [];

// ---------- 3. runtime config ----------
const T = site.trust; // {about, contact, privacy, terms}
const privacyAddendum = `
<h2>Advertising and cookies</h2>
<p>This site uses Google AdSense to show ads. Third-party vendors, including Google, use cookies to serve ads based on a visitor's prior visits to this website and other websites. Google's use of advertising cookies enables it and its partners to serve ads to you based on your visits to this site and/or other sites on the Internet.</p>
<p>You may opt out of personalized advertising by visiting Google's <a href="https://adssettings.google.com" rel="noopener" target="_blank">Ads Settings</a>. You can also opt out of some third-party vendors' use of cookies for personalized advertising by visiting <a href="https://www.aboutads.info" rel="noopener" target="_blank">www.aboutads.info</a>.</p>
<p>We use Google Analytics 4 to understand how visitors use this site. Google Analytics uses cookies to collect information such as pages visited and time on site; this data is reported to us in aggregate. You can prevent Google Analytics from using your data with the <a href="https://tools.google.com/dlpage/gaoptout" rel="noopener" target="_blank">Google Analytics Opt-out Browser Add-on</a>.</p>`.trim();
// temporary redirects for linked-but-missing pages (dropped once a real page exists at that path)
const activeRedirects = Object.fromEntries(Object.entries(site.redirects || {}).filter(([from]) => !pages.some(p => p.path === from)));
// Affiliate IDs in links.json -> appended automatically (an explicit tracking URL is left untouched)
function withAffiliate(url) {
  const ids = links.affiliate_ids || {}; const u = new URL(url);
  if (ids.getyourguide_partner_id && u.hostname.endsWith('getyourguide.com') && !u.searchParams.has('partner_id')) u.searchParams.set('partner_id', ids.getyourguide_partner_id);
  if (ids.tiqets_partner && u.hostname.endsWith('tiqets.com') && !u.searchParams.has('partner')) u.searchParams.set('partner', ids.tiqets_partner);
  if (ids.viator_pid && u.hostname.endsWith('viator.com') && !u.searchParams.has('pid')) { u.searchParams.set('pid', ids.viator_pid); u.searchParams.set('mcid', '42383'); u.searchParams.set('medium', 'link'); }
  return u.toString();
}
const more = {};
for (const p of pages) if (p.section) (more[p.section] ||= []).push({ href: p.path, title: p.title });
const cfg = {
  accent: site.accent, disclosure: links.disclosure, disclosure_href: links.disclosure_href || null,
  links: Object.fromEntries(Object.entries(links.routes).map(([k, v]) => [k, v.map(({ label, url, provider }) => ({ label, url: withAffiliate(url), provider }))])),
  privacy_path: T.privacy, privacy_addendum_html: privacyAddendum,
  trust: [{ href: T.about, label: 'About' }, { href: T.contact, label: 'Contact' }, { href: T.privacy, label: 'Privacy policy' }, { href: T.terms, label: 'Terms of use' }],
  more, more_heading: site.more_heading || 'More guides',
  redirects: activeRedirects,
  append: site.append || {}
};

// ---------- 4. head injection into the shell ----------
const headTags = [
  ga ? `<!-- Google tag (gtag.js) -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=${ga}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga}');</script>` : `<!-- GA4: measurement ID not set in sites/${domain}/site.json -->`,
  `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>`,
  `<script id="tsa-config" type="application/json">${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>`,
  `<script defer src="/${addonsName}"></script>`
].join('\n');
let shell = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
shell = shell.replace(/<head>/i, `<head>\n${headTags}`);
fs.writeFileSync(path.join(OUT, 'index.html'), shell);

// ---------- 5. routes ----------
const smSrc = fs.readFileSync(path.join(SITE, 'app', 'sitemap.xml'), 'utf8');
const lastmod = {};
const spaRoutes = [...smSrc.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => {
  const loc = new URL(m[1].match(/<loc>([^<]+)/)[1]).pathname.replace(/\/+$/, '') || '/';
  const lm = m[1].match(/<lastmod>([^<]+)/); if (lm) lastmod[loc] = lm[1]; return loc;
}).filter(r => !pages.some(p => p.path === r));

// ---------- 6. prerender ----------
function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.avif': 'image/avif', '.gif': 'image/gif' };
  return http.createServer((req, res) => {
    let u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(dir, u);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, fs.existsSync(path.join(dir, '_shell.html')) ? '_shell.html' : 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
}
const srv = serve(OUT); await new Promise(r => srv.listen(0, r)); const LOCAL = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/googletagmanager|googlesyndication|google-analytics|doubleclick/, r => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

async function snapshot(route) {
  await page.goto(LOCAL + route, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(r => window.__tsaApplied === r && document.querySelector('main') && document.querySelector('main').innerText.length > 50, route, { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.waitForFunction(r => window.__tsaApplied === r, route, { timeout: 20000 });
  return page.evaluate(([origin, local, route]) => {
    window.__tsaApply && window.__tsaApply();
    if (!document.querySelector('link[rel=canonical]')) { const l = document.createElement('link'); l.rel = 'canonical'; l.href = origin + (route === '/' ? '/' : route); document.head.appendChild(l); }
    document.querySelectorAll('link[rel=canonical],meta[property="og:url"]').forEach(e => { for (const a of ['href', 'content']) if (e.getAttribute(a)) e.setAttribute(a, e.getAttribute(a).replace(local, origin)); });
    return '<!doctype html>\n' + document.documentElement.outerHTML.replaceAll(local, '');
  }, [ORIGIN, LOCAL, route]);
}

fs.copyFileSync(path.join(OUT, 'index.html'), path.join(OUT, '_shell.html'));
const rendered = {};
for (const r of spaRoutes) rendered[r] = await snapshot(r);

// ---------- 7. generated static pages (from a reference page's chrome; no SPA bundle) ----------
const refRoute = site.static_template_route || T.about;
for (const p of pages) {
  const tpl = await browser.newPage({ javaScriptEnabled: false });
  await tpl.setContent(rendered[refRoute], { waitUntil: 'domcontentloaded' });
  const html = await tpl.evaluate(([pg, origin]) => {
    document.querySelectorAll('script[type=module], link[rel=modulepreload]').forEach(e => e.remove());
    const set = (sel, attr, val) => { let e = document.head.querySelector(sel); if (e) e.setAttribute(attr, val); };
    document.title = pg.title + ' — ' + pg.site_name;
    set('meta[name=description]', 'content', pg.description);
    set('link[rel=canonical]', 'href', origin + pg.path);
    set('meta[property="og:url"]', 'content', origin + pg.path);
    set('meta[property="og:title"]', 'content', document.title);
    set('meta[property="og:description"]', 'content', pg.description);
    document.querySelectorAll('#tsa-book,#tsa-more,#tsa-ads-privacy').forEach(e => e.remove());
    const main = document.querySelector('main'); const h1 = main.querySelector('h1');
    let hdr = h1; while (hdr.parentElement !== main) hdr = hdr.parentElement;
    const addendum = (pg.path === pg.privacy_path && !pg.body_html.includes('tsa-ads-privacy')) ? '<section id="tsa-ads-privacy">' + pg.addendum + '</section>' : '';
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    h1.textContent = pg.title;
    if (hdr.querySelectorAll('p').length > 6) {
      // single-container layout: keep eyebrow + h1, replace everything after the h1
      [...main.children].forEach(c => { if (c !== hdr) c.remove(); });
      while (h1.nextSibling) h1.nextSibling.remove();
      [...hdr.querySelectorAll('p')].forEach(x => { if (x.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING) x.textContent = pg.eyebrow || 'Site information'; });
      h1.insertAdjacentHTML('afterend', '<p>' + esc(pg.description) + '</p>' + (pg.dateline ? '<p><small>' + esc(pg.dateline) + '</small></p>' : '') + pg.body_html + addendum);
    } else {
      const cands = [...main.querySelectorAll('.article-prose, .prose-block, .prose-body, article')].filter(e => !hdr.contains(e));
      let prose = cands[0];
      if (!prose) prose = [...main.children].filter(c => c !== hdr).sort((a, b) => b.querySelectorAll('p').length - a.querySelectorAll('p').length)[0];
      let keep = prose; while (keep.parentElement !== main) keep = keep.parentElement;
      [...main.children].forEach(c => { if (c !== hdr && c !== keep) c.remove(); });
      const ps = [...hdr.querySelectorAll('p')];
      let after = 0;
      ps.forEach(x => {
        if (x.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING) { x.textContent = pg.eyebrow || 'Site information'; return; }
        after++; if (after === 1) x.textContent = pg.description; else if (after === 2) x.textContent = pg.dateline || ''; else x.remove();
      });
      if (after === 1 && pg.dateline) ps[ps.length - 1].insertAdjacentHTML('afterend', '<p>' + esc(pg.dateline) + '</p>');
      prose.innerHTML = pg.body_html + addendum;
    }
    document.documentElement.setAttribute('data-static-page', '1');
    return '<!doctype html>\n' + document.documentElement.outerHTML;
  }, [{ ...p, site_name: site.name, privacy_path: T.privacy, addendum: privacyAddendum }, ORIGIN]);
  await tpl.close();
  rendered[p.path] = html.replaceAll(LOCAL, '');
}
await browser.close(); srv.close();

// ---------- 8. write pages ----------
for (const [r, html] of Object.entries(rendered)) {
  if (r === '/') { fs.writeFileSync(path.join(OUT, 'index.html'), html); continue; }
  const f = path.join(OUT, '_pages', r + '.html'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html);
}

// ---------- 9. root files ----------
fs.writeFileSync(path.join(OUT, 'ads.txt'), `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
const today = new Date().toISOString().slice(0, 10);
const allRoutes = [...spaRoutes, ...pages.map(p => p.path)];
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  allRoutes.map(r => `  <url><loc>${ORIGIN}${r === '/' ? '/' : r}</loc><lastmod>${(pages.find(p => p.path === r)?.updated) || lastmod[r] || today}</lastmod></url>`).join('\n') + `\n</urlset>\n`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /_pages/\nDisallow: /_shell.html\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
fs.writeFileSync(path.join(OUT, '.htaccess'), `# Generated by tools/build.mjs — do not edit on the server
DirectoryIndex index.html
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  # force https + bare domain
  RewriteCond %{HTTPS} !=on [OR]
  RewriteCond %{HTTP_HOST} ^www\\. [NC]
  RewriteRule ^(.*)$ https://${domain}/$1 [R=301,L]
  # strip trailing slash (canonical URLs have none)
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^(.+)/$ /$1 [R=301,L]
  RewriteRule ^(index\\.html|_shell\\.html)$ - [L]
  # homepage = pre-rendered index.html
  RewriteRule ^$ /index.html [L]
  # temporary redirects: pages linked but not written yet
${Object.entries(activeRedirects).map(([a, b]) => `  RewriteRule ^${a.slice(1).replace(/[.]/g, '\\.')}$ ${b} [R=302,L]`).join('\n')}
  # pre-rendered pages
  RewriteCond %{REQUEST_URI} ^/(.+)$
  RewriteCond %{DOCUMENT_ROOT}/_pages/%1.html -f
  RewriteRule ^ /_pages/%1.html [L]
  # real files
  RewriteCond %{REQUEST_FILENAME} -f
  RewriteRule ^ - [L]
  # everything else: SPA shell (the app renders its own 404)
  RewriteRule ^ /_shell.html [L]
</IfModule>
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript application/json image/svg+xml
</IfModule>
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html "access plus 0 seconds"
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType text/javascript "access plus 1 year"
  ExpiresByType image/svg+xml "access plus 1 month"
  ExpiresByType image/jpeg "access plus 1 month"
  ExpiresByType image/png "access plus 1 month"
  ExpiresByType image/webp "access plus 1 month"
</IfModule>
<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set X-Frame-Options "SAMEORIGIN"
  Header set Referrer-Policy "strict-origin-when-cross-origin"
  <FilesMatch "^(ads\\.txt|robots\\.txt)$">
    Header set Content-Type "text/plain; charset=utf-8"
  </FilesMatch>
  <FilesMatch "\\.html$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
`);
fs.writeFileSync(path.join(OUT, 'build-info.json'), JSON.stringify({ domain, built: new Date().toISOString(), ga4: ga || 'NOT SET', routes: allRoutes.length, static_pages: pages.length, page_errors: [...new Set(errors)].slice(0, 10) }, null, 1));
console.log(JSON.stringify({ domain, routes: allRoutes.length, static_pages: pages.length, ga4: ga || 'NOT SET', page_errors: [...new Set(errors)].length }));
