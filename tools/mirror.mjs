// Mirror a live SPA build (shell + every same-origin asset it loads) into sites/<domain>/app
// Usage: node tools/mirror.mjs petratourism.com
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const domain = process.argv[2]; const origin = `https://${domain}`;
const out = path.resolve('sites', domain, 'app'); fs.mkdirSync(out, { recursive: true });
const sm = await (await fetch(`${origin}/sitemap.xml`)).text();
const routes = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
const assets = new Set(['/favicon.svg','/robots.txt','/sitemap.xml','/og-default.svg','/favicon.ico','/apple-touch-icon.png','/site.webmanifest']);
const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
p.on('request', r => { const u = new URL(r.url()); if (u.origin === origin && u.pathname !== '/' && !routes.includes(u.pathname)) assets.add(u.pathname); });
for (const r of routes) { try { await p.goto(origin + r, { waitUntil: 'networkidle', timeout: 60000 });
  await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 800) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } });
  await p.waitForTimeout(300);
  (await p.evaluate(() => [...document.querySelectorAll('img[src],source[srcset],link[href]')].flatMap(e => [e.getAttribute('src'), ...(e.getAttribute('srcset')||'').split(',').map(s=>s.trim().split(' ')[0]), e.tagName==='LINK'?e.getAttribute('href'):null]))).forEach(s => { if (s && s.startsWith('/') && !s.startsWith('//')) assets.add(s.split('#')[0]); });
} catch (e) { console.error('route fail', r, e.message); } }
await b.close();
// also grab asset-like paths referenced in JS/CSS bundles
const shell = await (await fetch(origin + '/')).text(); fs.writeFileSync(path.join(out, 'index.html'), shell);
for (const m of shell.matchAll(/(?:src|href)="(\/[^"]+)"/g)) assets.add(m[1]);
for (const a of [...assets]) if (/\.(js|css)$/.test(a)) { const t = await (await fetch(origin + a)).text();
  for (const m of t.matchAll(/["'(](\/(?:images|img|assets|photos|media|fonts)\/[^"')\s]+\.(?:jpe?g|png|webp|svg|avif|gif|woff2?))["')]/gi)) assets.add(m[1]); }
let ok = 0, bad = [];
for (const a of assets) { if (routes.includes(a)) continue; const res = await fetch(origin + a); const ct = res.headers.get('content-type')||'';
  if (!res.ok || (ct.includes('text/html') && !a.endsWith('.html'))) { bad.push(a); continue; }
  const f = path.join(out, decodeURIComponent(a)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(await res.arrayBuffer())); ok++; }
fs.writeFileSync(path.resolve('sites', domain, 'routes.json'), JSON.stringify(routes, null, 1));
console.log(JSON.stringify({ domain, routes: routes.length, assets_saved: ok, missing: bad }));
