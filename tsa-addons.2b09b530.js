/* Tourism Sites Addons (tsa) — shared runtime layer for every tourism site.
 * Reads its per-site config from <script id="tsa-config" type="application/json"> (generated at build
 * time from sites/<domain>/links.json + site.json) and, on every route render:
 *   1. adds the booking / ticket button block (rel="sponsored nofollow" + one-line disclosure)
 *   2. adds the AdSense-required advertising-cookie wording to the privacy page
 *   3. makes sure the footer links to about / contact / privacy / terms
 *   4. lists newer static guides on their section hub page
 * Everything is idempotent; the React app re-renders freely and this re-applies.
 */
(function () {
  var cfgEl = document.getElementById('tsa-config');
  if (!cfgEl) return;
  var C; try { C = JSON.parse(cfgEl.textContent); } catch (e) { return; }
  var A = C.accent || '#1A2745';

  function css() {
    if (document.getElementById('tsa-style')) return;
    var s = document.createElement('style'); s.id = 'tsa-style';
    s.textContent =
      '.tsa-book{max-width:44rem;margin:1.5rem auto 2rem;padding:1.1rem 1.5rem 1rem;border:1px solid rgba(0,0,0,.12);border-radius:14px;background:rgba(255,255,255,.7);font-family:inherit}' +
      '.tsa-book-row{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center}' +
      '.tsa-btn{display:inline-flex;align-items:center;gap:.4rem;padding:.7rem 1.15rem;border-radius:999px;background:' + A + ';color:#fff!important;font-weight:600;font-size:15px;line-height:1.2;text-decoration:none!important;box-shadow:0 1px 2px rgba(0,0,0,.15)}' +
      '.tsa-btn:hover{filter:brightness(1.12)}' +
      '.tsa-btn.tsa-alt{background:transparent;color:' + A + '!important;border:1.5px solid ' + A + '}' +
      '.tsa-via{font-size:12px;opacity:.7;margin-left:.15rem}' +
      '.tsa-disc{margin:.6rem 0 0;font-size:12.5px;line-height:1.45;opacity:.75}' +
      '.tsa-disc a{text-decoration:underline}' +
      '.tsa-legal{display:flex;flex-wrap:wrap;gap:.25rem 1.1rem;justify-content:center;padding:.9rem 1rem 1.1rem;font-size:13px;opacity:.85}' +
      '.tsa-legal a{color:inherit;text-decoration:underline}' +
      '.tsa-more{max-width:44rem;margin:2.5rem auto;padding:0 1.5rem}' +
      '.tsa-more h2{font-size:1.4rem;margin:0 0 .6rem}' +
      '.tsa-more li{margin:.35rem 0}.tsa-more a{text-decoration:underline}' +
      '#tsa-ads-privacy{margin-top:2rem}#tsa-ads-privacy h2{font-size:1.5rem;margin:0 0 .75rem}#tsa-ads-privacy p{margin:0 0 1rem}' +
      '#tsa-ads-privacy a{text-decoration:underline}';
    document.head.appendChild(s);
  }

  function path() { var p = location.pathname.replace(/\/+$/, ''); return p === '' ? '/' : p; }
  function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // where the booking box goes: right after the page header (and breadcrumb), or after the lede
  // when the whole article lives in one container
  function anchorFor(main) {
    var h1 = main.querySelector('h1');
    if (!h1) { var f = main.firstElementChild; return { parent: main, before: f ? f.nextSibling : null }; }
    var top = h1; while (top.parentElement && top.parentElement !== main) top = top.parentElement;
    if (top.querySelectorAll('p').length > 6) {
      var n = h1.nextElementSibling;
      if (n && n.tagName === 'P') { var m = n.nextElementSibling; if (m && m.tagName === 'P' && (m.innerText || '').length < 140) n = m; }
      var ref = n || h1; return { parent: ref.parentElement, before: ref.nextSibling };
    }
    var after = top, nx = top.nextElementSibling;
    if (nx && nx.tagName === 'NAV') after = nx;
    return { parent: main, before: after.nextSibling };
  }

  function booking(p, main) {
    var items = (C.links && C.links[p]) || null;
    var old = document.getElementById('tsa-book');
    if (!items || !items.length) { if (old) old.remove(); return; }
    if (old && old.getAttribute('data-path') === p) return;
    if (old) old.remove();
    var box = el('aside', { id: 'tsa-book', 'class': 'tsa-book', 'data-path': p, 'aria-label': 'Booking' });
    var row = el('div', { 'class': 'tsa-book-row' });
    items.forEach(function (it, i) {
      var a = el('a', { href: it.url, 'class': 'tsa-btn' + (i ? ' tsa-alt' : ''), rel: 'sponsored nofollow noopener', target: '_blank', 'data-provider': it.provider || '' },
        esc(it.label) + (it.provider ? ' <span class="tsa-via">via ' + esc(it.provider) + '</span>' : '') + ' &rarr;');
      row.appendChild(a);
    });
    box.appendChild(row);
    box.appendChild(el('p', { 'class': 'tsa-disc' }, esc(C.disclosure) + (C.disclosure_href ? ' <a href="' + C.disclosure_href + '">Learn more</a>.' : '')));
    var at = anchorFor(main); at.parent.insertBefore(box, at.before);
  }

  function privacy(p, main) {
    if (!C.privacy_path || p !== C.privacy_path) return;
    if (document.getElementById('tsa-ads-privacy')) return;
    var txt = (main.innerText || '');
    if (txt.length < 200) return; // page not rendered yet
    var host = main.querySelector('.article-prose, article') || main;
    var sec = el('section', { id: 'tsa-ads-privacy' }, C.privacy_addendum_html);
    host.appendChild(sec);
  }

  function footerLinks() {
    var f = document.querySelector('footer');
    if (!f || !C.trust) return;
    var have = {}; f.querySelectorAll('a[href]').forEach(function (a) { if (a.closest('#tsa-legal')) return; have[a.getAttribute('href').replace(/\/+$/, '') || '/'] = 1; });
    var missing = C.trust.filter(function (t) { return !have[t.href]; });
    var row = document.getElementById('tsa-legal');
    if (!missing.length) { if (row) row.remove(); return; }
    if (row) return;
    row = el('nav', { id: 'tsa-legal', 'class': 'tsa-legal', 'aria-label': 'Site information' });
    C.trust.forEach(function (t) { row.appendChild(el('a', { href: t.href }, esc(t.label))); });
    f.appendChild(row);
  }

  function more(p, main) {
    var list = C.more && C.more[p];
    var old = document.getElementById('tsa-more');
    if (!list || !list.length) { if (old) old.remove(); return; }
    if (old && old.getAttribute('data-path') === p) return;
    if (old) old.remove();
    var s = el('section', { id: 'tsa-more', 'class': 'tsa-more', 'data-path': p },
      '<h2>' + esc(C.more_heading || 'More guides') + '</h2><ul>' +
      list.map(function (x) { return '<li><a href="' + x.href + '">' + esc(x.title) + '</a></li>'; }).join('') + '</ul>');
    main.appendChild(s);
  }

  // temporary redirects: fix hrefs (for crawlers) and intercept in-app navigation (React Router bypasses the server)
  function fixLinks() {
    var R = C.redirects || {}; if (!Object.keys(R).length) return;
    document.querySelectorAll('a[href^="/"]').forEach(function (a) { var h = a.getAttribute('href').split(/[?#]/)[0].replace(/\/+$/, ''); if (R[h]) { a.setAttribute('data-tsa-from', h); a.setAttribute('href', R[h]); } });
  }
  document.addEventListener('click', function (e) {
    var R = C.redirects || {}; var a = e.target && e.target.closest && e.target.closest('a[href]'); if (!a) return;
    var u; try { u = new URL(a.href, location.href); } catch (x) { return; }
    if (u.origin !== location.origin) return; var h = u.pathname.replace(/\/+$/, '');
    var to = R[h] || (a.hasAttribute('data-tsa-from') ? u.pathname : null);
    if (to) { e.preventDefault(); e.stopPropagation(); location.assign(to); }
  }, true);

  // per-page extra blocks from site.json "append": { "/contact": "<p>…</p>" }
  function appendBlocks(p, main) {
    var html = C.append && C.append[p]; if (!html) return;
    if (document.getElementById('tsa-append')) return;
    if ((main.innerText || '').length < 100) return;
    var host = main.querySelector('.article-prose, article') || main;
    host.appendChild(el('section', { id: 'tsa-append' }, html));
  }

  var busy = false;
  function apply() {
    if (busy) return; busy = true;
    try {
      var main = document.querySelector('main');
      if (main && main.children.length) {
        css(); var p = path();
        booking(p, main); privacy(p, main); more(p, main); footerLinks(); fixLinks(); appendBlocks(p, main);
        var f = document.querySelector('footer'), fl = {};
        if (f) f.querySelectorAll('a[href]').forEach(function (a) { fl[a.getAttribute('href').replace(/\/+$/, '') || '/'] = 1; });
        var footerOk = !!f && (C.trust || []).every(function (t) { return fl[t.href]; });
        var bookOk = !(C.links && C.links[p]) || !!document.getElementById('tsa-book');
        if (footerOk && bookOk) window.__tsaApplied = p; else soon();
      }
    } finally { busy = false; }
  }
  window.__tsaApply = apply;
  var t; function soon() { clearTimeout(t); t = setTimeout(apply, 60); }
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true });
  ['pushState', 'replaceState'].forEach(function (m) { var o = history[m]; history[m] = function () { var r = o.apply(this, arguments); soon(); return r; }; });
  window.addEventListener('popstate', soon);
  if (document.readyState !== 'loading') soon(); else document.addEventListener('DOMContentLoaded', soon);
})();
