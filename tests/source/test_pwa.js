// #243 Home-screen app. Pins:
//  - a manifest per dashboard (name, start page, full screen, colors, icons incl. maskable),
//    and the icons exist at the sizes they claim;
//  - both pages link their manifest and carry the iPhone tags (title, icon, status bar);
//  - the service worker never caches VERA's pages or data: pages come from the network,
//    offline they get the "No connection" page, other sites are left alone;
//  - the install tip and the worker's registration are one block shared by both dashboards;
//  - which phone, from the user agent;
//  - nothing new outside docs/ (so nothing reaches Apps Script).
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const exists = f => fs.existsSync(path.join(ROOT, f)) || fs.existsSync(path.join(REPO, f));
const bytes = f => { try { return fs.readFileSync(path.join(ROOT, f)); } catch (e) { return fs.readFileSync(path.join(REPO, f)); } };
const APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html'), INDEX = read('docs/index.html'), SW = read('docs/sw.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const pngSize = b => b.slice(1, 4).toString() === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;

console.log('\nThe manifests and icons');
for (const [kind, page, name] of [['full', 'index.html', 'VERA'], ['lite', 'dashboard-lite.html', 'VERA Lite']]) {
  let m = null; try { m = JSON.parse(read('docs/manifest-' + kind + '.webmanifest')); } catch (e) {}
  check(kind + ': a valid manifest', !!m);
  if (!m) continue;
  check(kind + ': its name, its own start page and id, full screen, VERA’s navy', m.name === name && m.short_name === name && m.start_url === './' + page && m.id === './' + page && m.display === 'standalone' && m.background_color === '#0d1b3e' && m.theme_color === '#0d1b3e', J(m));
  const icons = m.icons || [];
  check(kind + ': 192 and 512 icons, and a maskable one for Android', icons.some(i => i.sizes === '192x192') && icons.some(i => i.sizes === '512x512' && i.purpose === 'any') && icons.some(i => i.purpose === 'maskable'));
  check(kind + ': every icon exists at the size it claims', icons.every(i => { if (!exists('docs/' + i.src)) return false; const s = pngSize(bytes('docs/' + i.src)); return s && s.join('x') === i.sizes; }), J(icons.map(i => i.src)));
  check(kind + ': the iPhone icon (180) exists', exists('docs/icons/vera-' + kind + '-180.png') && J(pngSize(bytes('docs/icons/vera-' + kind + '-180.png'))) === J([180, 180]));
}

console.log('\nThe pages');
for (const [kind, src, title] of [['full', INDEX, 'VERA'], ['lite', LITE, 'VERA Lite']]) {
  const head = src.slice(0, src.indexOf('</head>') === -1 ? 4000 : src.indexOf('</head>')).slice(0, 6000);
  check(kind + ': links its manifest', head.includes('<link rel="manifest" href="manifest-' + kind + '.webmanifest" />'));
  check(kind + ': the iPhone tags: full screen, title, icon, a status bar that doesn’t cover the page', head.includes('<meta name="apple-mobile-web-app-capable" content="yes" />') && head.includes('<meta name="apple-mobile-web-app-title" content="' + title + '" />')
        && head.includes('<link rel="apple-touch-icon" href="icons/vera-' + kind + '-180.png" />') && head.includes('<meta name="apple-mobile-web-app-status-bar-style" content="black" />') && head.includes('<meta name="theme-color" content="#0d1b3e" />'));
}
check('the built page still carries the app (build.js keeps the header)', INDEX.includes('function VeraInstallTip()') && INDEX.includes('<link rel="manifest" href="manifest-full.webmanifest" />'));
check('the offline page: No connection, Try again, and it reloads itself when back online', /<h1>No connection<\/h1>/.test(read('docs/offline.html')) && /onclick="location\.reload\(\)"/.test(read('docs/offline.html')) && /addEventListener\('online'/.test(read('docs/offline.html')));

console.log('\nThe service worker');
{
  const listeners = {}, cached = {}, fetched = [];
  const c = { URL, Promise, setTimeout,
    self: { location: { origin: 'https://example.test' }, addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() } },
    caches: { open: () => Promise.resolve({ addAll: list => { list.forEach(k => { cached[k] = 'cached:' + k; }); return Promise.resolve(); } }), match: r => Promise.resolve(cached[typeof r === 'string' ? r : r.url.replace('https://example.test/docs/', '')] || null), keys: () => Promise.resolve(['vera-shell-v0', 'vera-shell-v1', 'other']), delete: () => Promise.resolve(true) },
  };
  let online = true;
  c.fetch = r => { fetched.push(typeof r === 'string' ? r : r.url); return online ? Promise.resolve('network:' + (r.url || r)) : Promise.reject(new Error('offline')); };
  vm.createContext(c); vm.runInContext(SW.replace(/\bself\.addEventListener/g, 'self.addEventListener'), c);
  const ev = req => { const e = { request: req, responded: null, respondWith: p => { e.responded = p; }, waitUntil: p => { e.waited = p; } }; listeners.fetch(e); return e; };
  (async () => {
    const inst = { waitUntil: p => { inst.p = p; } }; listeners.install(inst); await inst.p;
    check('install keeps only the offline page and icons', J(Object.keys(cached).sort()) === J(['icons/vera-full-192.png', 'icons/vera-lite-192.png', 'offline.html']));
    cached['index.html'] = 'cached:index.html';   // even with an old copy around, the page comes fresh
    const page = ev({ method: 'GET', mode: 'navigate', url: 'https://example.test/docs/index.html' });
    check('a page comes from the network, never an old copy', (await page.responded) === 'network:https://example.test/docs/index.html');
    delete cached['index.html'];
    online = false;
    const off = ev({ method: 'GET', mode: 'navigate', url: 'https://example.test/docs/index.html' });
    let offR = null; try { offR = await off.responded; } catch (e) { offR = 'error: ' + e.message; }
    check('…offline, the "No connection" page', offR === 'cached:offline.html', offR);
    online = true;
    check('VERA’s backend and other sites: untouched', ev({ method: 'GET', mode: 'cors', url: 'https://script.google.com/macros/s/x/exec?action=status' }).responded === null
          && ev({ method: 'GET', mode: 'navigate', url: 'https://accounts.example.org/signin' }).responded === null);
    check('posts: untouched', ev({ method: 'POST', mode: 'cors', url: 'https://example.test/docs/x' }).responded === null);
    check('a script or data file on the site isn’t cached either', ev({ method: 'GET', mode: 'no-cors', url: 'https://example.test/docs/app.js' }).responded === null);
    check('the icons come from the cache', (await ev({ method: 'GET', mode: 'no-cors', url: 'https://example.test/docs/icons/vera-full-192.png' }).responded) === 'cached:icons/vera-full-192.png');
    const deleted = []; c.caches.delete = k => { deleted.push(k); return Promise.resolve(true); };
    const act = { waitUntil: p => { act.p = p; } }; listeners.activate(act); await act.p;
    check('a new version clears the old shell, and only VERA’s', J(deleted) === J(['vera-shell-v0']));
    finish();
  })();
}

function finish() {
  console.log('\nThe install tip');
  const block = s => { const a = s.indexOf('// ---- VeraInstallTip'), b = s.indexOf('// ---- /VeraInstallTip ----'); return a === -1 || b === -1 ? '' : s.slice(a, b); };
  check('one block, the same in both dashboards', block(APP) && block(APP) === block(LITE));
  check('the worker is registered over https only', /if\('serviceWorker' in navigator&&location\.protocol==='https:'\)window\.addEventListener\('load',function\(\)\{navigator\.serviceWorker\.register\('sw\.js'\)/.test(block(APP)));
  const c = {}; vm.createContext(c); vm.runInContext(block(APP).replace(/var VERA_INSTALL_EVT=null;[\s\S]*?catch\(e\)\{\}/, 'var VERA_INSTALL_EVT=null;'), c);
  const ph = (ua, pl, t) => c.veraPhoneOf_(ua, pl || '', t || 0);
  check('which phone: iPhone, iPad (even as a "Mac"), Android, or a computer',
        ph('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)') === 'ios' && ph('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5) === 'ios'
        && ph('Mozilla/5.0 (Linux; Android 15; Pixel 9)') === 'android' && ph('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0) === '' && ph('Mozilla/5.0 (Windows NT 10.0; Win64; x64)') === '');
  check('Home shows it (full), and Today (lite)', /React\.createElement\("div",null,React\.createElement\(VeraInstallTip,null\),/.test(APP) && /<div>\n\s+<VeraInstallTip \/>/.test(LITE));
  check('nothing new outside docs/ (Apps Script never gets it)', /^docs\/\*\*$/m.test(read('.claspignore')));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
