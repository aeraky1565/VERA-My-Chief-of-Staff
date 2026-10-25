// Drives the REAL TripIdeasView in both dashboards at phone and desktop widths,
// over an in-page fake of the trip_ideas API: start an idea from nothing, fill
// the loose brief, add a simple option (fly in, stay, fly out) and a mixed one
// (fly → drive → cruise → fly), see each route and its cost against the WILLA
// budget, favourite one, rule one out, and find it all on the board. Options sit
// side by side on a desktop and stack on a phone, with no sideways scroll.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

// Page-side helpers: a fake API that stores what it is sent, and React-safe input.
async function setup(page) {
  await page.evaluate(() => {
    document.querySelectorAll('#tiprobe').forEach(n => n.remove());
    const store = { ideas: [], options: [] }; let n = 0; window.__posts = [];
    window.apiGet = (u, t, q) => Promise.resolve(q.action === 'trip_ideas' ? { ok: true, ideas: store.ideas.slice(), options: store.options.slice() } : { ok: false });
    window.apiPost = (u, t, b) => {
      window.__posts.push(JSON.parse(JSON.stringify(b)));
      const now = new Date(2026, 9, 25, 12, 0, n).toISOString();
      if (b.action === 'trip_idea_save') { const i = Object.assign({}, b.idea); if (!i.id) i.id = 'IDEA-' + (++n); i.updated = now; store.ideas = store.ideas.filter(x => x.id !== i.id).concat([i]); return Promise.resolve({ ok: true, idea: i }); }
      if (b.action === 'trip_option_save') { const o = Object.assign({}, b.option); if (!o.id) { o.id = 'OPT-' + (++n); o.created = now; }
        o.pros = (o.pros || []).filter(Boolean); o.cons = (o.cons || []).filter(Boolean);
        Object.keys(o.cost || {}).forEach(k => { const c = o.cost[k]; if (c.low === '' && c.high === '') delete o.cost[k]; else { c.low = Number(c.low || c.high); c.high = Number(c.high || c.low); } });
        store.options = store.options.filter(x => x.id !== o.id).concat([o]); return Promise.resolve({ ok: true, option: o }); }
      return Promise.resolve({ ok: true });
    };
    window.confirm = () => true;
    window.__set = (el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
    window.__q = s => document.querySelector('#tiprobe ' + s);
    window.__btn = t => Array.from(document.querySelectorAll('#tiprobe button')).find(b => b.innerText.trim() === t);
    const host = document.createElement('div'); host.id = 'tiprobe'; host.style.padding = '0 12px'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(TripIdeasView, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
  });
  await wait(200);
}
const text = page => page.$eval('#tiprobe', n => n.innerText);
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const act = async (page, fn, arg) => { await page.evaluate(fn, arg); await wait(80); };

async function addOption(page, o) {
  await act(page, () => window.__q('.ti-add-option').click());
  await act(page, (o) => {
    window.__set(window.__q('.ti-opt-name'), o.name);
    window.__q('.ti-simple-route').click();
  }, o);
  await act(page, (o) => {
    const places = Array.from(document.querySelectorAll('#tiprobe input[aria-label="Place"]')), nights = document.querySelectorAll('#tiprobe input[aria-label="Nights"]');
    window.__set(places[0], o.stays[0][0]); window.__set(nights[0], String(o.stays[0][1]));
    const to = document.querySelectorAll('#tiprobe input[aria-label="To"]'), from = document.querySelectorAll('#tiprobe input[aria-label="From"]');
    window.__set(to[0], o.in); window.__set(from[1], o.out);
    (o.cost || []).forEach(c => { window.__set(document.querySelector('#tiprobe input[aria-label="' + c[0] + ' low"]'), String(c[1])); window.__set(document.querySelector('#tiprobe input[aria-label="' + c[0] + ' high"]'), String(c[2])); });
    if (o.pros) window.__set(document.querySelectorAll('#tiprobe .ti-option-editor textarea')[0], o.pros);
  }, o);
  // The mixed route: insert a drive, the cruise and a stop before the flight home.
  for (const extra of (o.extra || [])) {
    await act(page, (x) => window.__q(x.kind === 'stop' ? '.ti-add-stop' : '.ti-add-move').click(), extra);
    await act(page, (x) => {
      const rows = Array.from(document.querySelectorAll('#tiprobe .ti-leg-stop, #tiprobe .ti-leg-move')); const row = rows[rows.length - 1];
      if (x.kind === 'stop') { window.__set(row.querySelector('input[aria-label="Place"]'), x.place); window.__set(row.querySelector('input[aria-label="Nights"]'), String(x.nights)); }
      else { window.__set(row.querySelector('select'), x.mode); window.__set(row.querySelector('input[aria-label="From"]'), x.from); window.__set(row.querySelector('input[aria-label="To"]'), x.to); }
      // Up past the flight home, so the route still ends with it.
      row.querySelector('button[aria-label="Move up"]').click();
    }, extra);
  }
  await act(page, () => window.__q('.ti-save-option').click());
  await wait(80);
}

async function scenario(page, label, width) {
  await setup(page);
  let t = await text(page);
  check(label + ': an empty board says what it is for', /No trip ideas yet/.test(t) && !!(await page.$('#tiprobe .ti-new-idea')), t.slice(0, 200));

  // The loose brief
  await act(page, () => window.__q('.ti-new-idea').click());
  check(label + ': + New idea opens the brief', !!(await page.$('#tiprobe .ti-brief')));
  await act(page, () => {
    window.__set(window.__q('.ti-title'), 'Spring in Europe');
    window.__set(window.__q('.ti-where'), 'Portugal, Spain');
    ['Mar', 'Apr', 'May'].forEach(m => Array.from(document.querySelectorAll('#tiprobe .ti-month')).find(b => b.innerText === m).click());
  });
  await act(page, () => { window.__btn('Help me decide').click(); window.__set(window.__q('.ti-budget'), '9000'); });
  t = await text(page);
  check(label + ': the brief reads the months back as a range', /When · Mar – May 20\d\d/.test(t) && /How long · 7–21 nights/.test(t), t.slice(0, 400));
  await act(page, () => window.__q('.ti-save-idea').click());
  const ideaPost = await page.evaluate(() => window.__posts.filter(p => p.action === 'trip_idea_save').pop());
  check(label + ': saving sends the whole brief', ideaPost && ideaPost.idea.title === 'Spring in Europe' && ideaPost.idea.months.length === 3 && ideaPost.idea.nightsMin === 7 && ideaPost.idea.nightsMax === 21 && ideaPost.idea.budget === 9000, JSON.stringify(ideaPost));
  t = await text(page);
  check(label + ': …and opens the idea', /Spring in Europe/.test(t) && /Mar – May/.test(t) && /budget \$9k/.test(t) && /No options yet/.test(t), t.slice(0, 300));

  // A simple option, then a mixed one
  await addOption(page, { name: 'Lisbon, fly in and out', in: 'LIS', out: 'LIS', stays: [['Lisbon', 10]], cost: [['Flights', 1200, 1600], ['Stays', 2500, 3500]], pros: 'Least PTO\nFood and wine' });
  await addOption(page, { name: 'Lisbon → Algarve → cruise', in: 'LIS', out: 'BCN', stays: [['Lisbon', 3]], cost: [['Flights', 1400, 1800], ['Cruise', 4000, 6000]],
    extra: [{ kind: 'move', mode: 'car', from: 'Lisbon', to: 'Lagos' }, { kind: 'stop', place: 'Algarve', nights: 3 }, { kind: 'move', mode: 'ship', from: 'Cádiz', to: 'Barcelona' }, { kind: 'stop', place: 'Cruise', nights: 7 }] });
  const cards = await page.$$eval('#tiprobe .ti-option', ns => ns.map(n => ({ text: n.innerText, top: Math.round(n.getBoundingClientRect().top), bottom: Math.round(n.getBoundingClientRect().bottom), left: Math.round(n.getBoundingClientRect().left) })));
  check(label + ': both options show', cards.length === 2, cards.length);
  const simple = cards.find(c => /fly in and out/.test(c.text)) || { text: '' }, mixed = cards.find(c => /Algarve → cruise/.test(c.text)) || { text: '' };
  check(label + ': a simple trip reads fly · fly with its one stop', /10 nights · Fly · fly/i.test(simple.text) && /Lisbon\s*10 nights/.test(simple.text), simple.text.slice(0, 300));
  check(label + ': a mixed trip keeps its legs in order', /13 nights · Fly · drive · cruise · fly/i.test(mixed.text) && mixed.text.indexOf('Algarve') < mixed.text.indexOf('Cruise\n') , mixed.text.slice(0, 400));
  check(label + ': cost by category with a total', /Flights\s*\$1\.2k – \$1\.6k/.test(simple.text) && /Total\s*\$3\.7k – \$5\.1k/.test(simple.text), simple.text);
  check(label + ': …checked against the WILLA budget', /Within the \$9k budget/.test(simple.text) && /Within the \$9k budget/.test(mixed.text), mixed.text.slice(-200));
  check(label + ': for and against show', /FOR\s*Least PTO\s*Food and wine/.test(simple.text));
  if (width >= 900) check(label + ': options sit side by side on a desktop', cards[0].top === cards[1].top && cards[0].left !== cards[1].left, JSON.stringify(cards.map(c => [c.top, c.left])));
  else check(label + ': options stack on a phone', cards[1].top >= cards[0].bottom, JSON.stringify(cards.map(c => [c.top, c.bottom])));
  check(label + ': no sideways scroll with the options', await noScroll(page));
  if (process.env.SHOT_DIR) { const el = await page.$('#tiprobe'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/tripideas-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }

  // Favourite the mixed one, rule the simple one out
  await act(page, () => Array.from(document.querySelectorAll('#tiprobe .ti-option')).find(n => /Algarve → cruise/.test(n.innerText)).querySelector('.ti-star-btn').click());
  await act(page, () => Array.from(document.querySelectorAll('#tiprobe .ti-option')).find(n => /fly in and out/.test(n.innerText)).querySelector('.ti-out-btn').click());
  const after = await page.$$eval('#tiprobe .ti-option', ns => ns.map(n => ({ star: n.classList.contains('ti-star'), text: n.innerText.slice(0, 40) })));
  check(label + ': a ruled-out option steps aside, the favourite stays', after.length === 1 && after[0].star, JSON.stringify(after));
  check(label + ': …and can be shown again', /Show 1 ruled-out option/.test(await text(page)));

  // Editing keeps the route
  await act(page, () => window.__q('.ti-edit-option').click());
  const legsInEditor = await page.$$eval('#tiprobe .ti-leg-stop, #tiprobe .ti-leg-move', ns => ns.length);
  check(label + ': editing opens the option with its route', legsInEditor === 7, legsInEditor);
  await act(page, () => window.__btn('Cancel').click());

  // The board
  await act(page, () => window.__q('.ti-back').click());
  t = await text(page);
  check(label + ': the board shows the idea under Brainstorming', /Brainstorming/i.test(t) && /Spring in Europe/.test(t), t.slice(0, 300));
  check(label + ': …with what is in play: one option, the favourite, its nights and cost', /1 option/.test(t) && /★ Lisbon → Algarve → cruise/.test(t) && /13 nights/.test(t) && /\$5\.4k – \$7\.8k/.test(t), t);
  check(label + ': no sideways scroll on the board', await noScroll(page));
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const lite = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');
  for (const width of [390, 1280]) {
    console.log('\nfull dashboard @ ' + width + 'px');
    let page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await scenario(page, 'full ' + width, width);
    check('full ' + width + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();

    console.log('\ndashboard-lite @ ' + width + 'px');
    page = await browser.newPage({ viewport: { width, height: 900 } });
    const lerrs = []; page.on('pageerror', e => lerrs.push(e.message));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith('https://vera.test/')) return route.fulfill({ contentType: 'text/html', body: lite });
      for (const n of Object.keys(vendor)) if (url.includes(n)) return route.fulfill({ contentType: 'application/javascript', body: vendor[n] });
      return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
    });
    await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 'test-token'); });
    await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
    await scenario(page, 'lite ' + width, width);
    check('lite ' + width + ': no page errors', lerrs.length === 0, lerrs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); process.exit(2); });
