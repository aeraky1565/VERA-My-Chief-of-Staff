// Drives the REAL TripIdeasView in both dashboards at phone and desktop widths,
// over an in-page fake of the trip_ideas API: start an idea from nothing, fill
// the loose brief, add a simple option (fly in, stay, fly out) and a mixed one
// (fly → drive → cruise → fly), see each route and its cost against the WILLA
// budget, see the cheapest dates in PTO and the typical weather for one,
// favourite one, rule one out, and find it all on the board. Then the
// hand-offs: a brief out to a chat and its options back, WILLA's budget and ARIA's fare. Options sit
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
    const store = { ideas: [], options: [], requests: [] }; let n = 0; window.__posts = []; window.__ariaRan = '';
    window.__gets = [];
    const plus = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    window.apiGet = (u, t, q) => { window.__gets.push(Object.assign({}, q));
      if (q.action === 'trip_idea_decide') {
        const idea = store.ideas.find(x => x.id === q.ideaId) || {};
        const lengths = String(q.nights).split(',').map(Number).map(n => ({ nights: n, considered: 31, windows: [
          { start: '2027-05-29', end: plus('2027-05-29', n), nights: n, people: [{ name: 'Ann', days: 4, left: 6 }, { name: 'Bea', days: 4, left: -1 }], holidays: ['Memorial Day'], clash: '' },
          { start: '2027-05-01', end: plus('2027-05-01', n), nights: n, people: [{ name: 'Ann', days: 5, left: 5 }, { name: 'Bea', days: 5, left: -2 }], holidays: [], clash: 'Beach week' }] }));
        const normals = Array.from({ length: 12 }, (x, i) => ({ hi: 55 + i, lo: 45 + i, wet: 12 - i }));
        return new Promise(r => setTimeout(() => r({ ok: true, today: '2027-02-20', months: idea.months, lengths,
          people: [{ name: 'Ann', found: true, holidayYears: [2027], remaining: { 2027: 10 } }, { name: 'Bea', found: false, remaining: {}, holidayYears: [] }],
          stops: [{ place: 'Lisbon', name: 'Lisbon', found: true, normals }, { place: 'Algarve', found: false }] }), 300));
      }
      if (q.action === 'aria_status') return Promise.resolve({ ok: true, configured: true, watchlist: window.__ariaRan ? [{ ref: window.__ariaRan, status: 'scouting', verdict: 'wait', travelers: 2 }] : [],
        fares: window.__ariaRan ? [{ tripId: window.__ariaRan, dateSeen: '2027-02-15', depart: '2027-05-28', ret: '2027-06-10', total: 1840, flags: [] }, { tripId: window.__ariaRan, dateSeen: '2027-02-15', depart: '2027-04-10', ret: '2027-04-23', total: 2100, flags: [] }] : [],
        requests: store.requests.slice(), gaps: {}, ideas: {} });
      return Promise.resolve(q.action === 'trip_ideas' ? { ok: true, ideas: store.ideas.slice(), options: store.options.slice() } : { ok: false }); };
    window.apiPost = (u, t, b) => {
      window.__posts.push(JSON.parse(JSON.stringify(b)));
      const now = new Date(2026, 9, 25, 12, 0, n).toISOString();
      if (b.action === 'trip_idea_save') { const i = Object.assign({}, b.idea); if (!i.id) i.id = 'IDEA-' + (++n); i.updated = now; store.ideas = store.ideas.filter(x => x.id !== i.id).concat([i]); return Promise.resolve({ ok: true, idea: i }); }
      if (b.action === 'trip_option_save') { const o = Object.assign({}, b.option); if (!o.id) { o.id = 'OPT-' + (++n); o.created = now; }
        o.pros = (o.pros || []).filter(Boolean); o.cons = (o.cons || []).filter(Boolean);
        Object.keys(o.cost || {}).forEach(k => { const c = o.cost[k]; if (c.low === '' && c.high === '') delete o.cost[k]; else { c.low = Number(c.low || c.high); c.high = Number(c.high || c.low); } });
        store.options = store.options.filter(x => x.id !== o.id).concat([o]); return Promise.resolve({ ok: true, option: o }); }
      if (b.action === 'trip_idea_ask') {
        const idea = store.ideas.find(x => x.id === b.ideaId);
        const mk = (name, extra) => Object.assign({ id: 'OPT-' + (++n), ideaId: b.ideaId, name, source: 'vera', flag: '', created: now, pros: [], cons: [], cost: { flights: { low: 1500, high: 2000, basis: 'VERA estimate' } } }, extra);
        const opts = b.focus ? [mk(b.focus, { legs: [{ kind: 'stop', place: 'Provence', nights: 4, piece: 'choice', vera: false }] })] : [
          mk('Swiss train → Cruise A', { legs: [{ kind: 'move', mode: 'fly', from: 'Home', to: 'ZRH', vera: true }, { kind: 'stop', place: 'Zermatt', nights: 2, vera: true },
              { kind: 'move', mode: 'train', from: 'Zermatt', to: 'St. Moritz', note: 'Glacier Express', piece: 'choice' }, { kind: 'stop', place: 'Lake Como', nights: 3, piece: 'wish' },
              { kind: 'stop', place: 'Cruise A · Genoa round trip', nights: 7, piece: 'anchor' }, { kind: 'move', mode: 'fly', from: 'MXP', to: 'Home', vera: true }],
            verdict: { level: 'fits', text: 'Every join is a train.' }, wishes: { fit: ['Lake Como'], left: [{ name: 'Beach days', why: 'only the port days' }] } }),
          mk('Road trip → Cruise B', { legs: [{ kind: 'move', mode: 'car', from: 'Nice', to: 'Barcelona', piece: 'choice' }, { kind: 'stop', place: 'Cruise B', nights: 7, piece: 'anchor' }],
            verdict: { level: 'cost', text: 'A one-way car fee.' }, wishes: { fit: [], left: [] } })];
        store.options = store.options.concat(opts);
        idea.alsoPossible = b.focus ? [] : [{ name: 'Road trip → Cruise A', why: 'Marseille is one of its ports.' }];
        return Promise.resolve({ ok: true, options: opts, idea: Object.assign({}, idea) });
      }
      if (b.action === 'aria_request_save') { store.requests = store.requests.filter(r => r.ref !== b.optionId.toUpperCase()).concat([{ ref: b.optionId.toUpperCase(), kind: 'scout', status: 'active', created: '2026-10-25T12:00:00Z' }]); return Promise.resolve({ ok: true }); }
      if (b.action === 'aria_request_withdraw') { store.requests.forEach(r => { if (r.ref === b.ref.toUpperCase()) r.status = 'withdrawn'; }); return Promise.resolve({ ok: true }); }
      if (b.action === 'trip_option_parse') {
        if (!/VERA option v1/.test(b.text)) return Promise.resolve({ ok: false, error: 'No trip options found in that text.' });
        return Promise.resolve({ ok: true, how: 'format', options: [{ ideaId: b.ideaId, name: 'Porto by train', source: b.source, flag: '', pros: [], cons: [],
          legs: [{ kind: 'move', mode: 'fly', from: 'Home', to: 'LIS' }, { kind: 'move', mode: 'train', from: 'Lisbon', to: 'Porto' }, { kind: 'stop', place: 'Porto', nights: 5 }, { kind: 'move', mode: 'fly', from: 'OPO', to: 'Home' }],
          cost: { flights: { low: 1300, high: 1700, basis: 'their estimate' } } }] });
      }
      return Promise.resolve({ ok: true });
    };
    window.__clip = null;
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__clip = t; return Promise.resolve(); } } }); } catch (e) {}
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

  // The deciders: dates in PTO and typical weather, for the simple option
  const simpleCard = () => Array.from(document.querySelectorAll('#tiprobe .ti-option')).find(n => /fly in and out/.test(n.innerText));
  await act(page, (f) => eval(f)().querySelector('.ti-decide-btn').click(), simpleCard.toString());
  check(label + ': the deciders say they are working', /Working out dates, PTO and weather/.test(await text(page)));
  const dq = await page.evaluate(() => window.__gets.filter(g => g.action === 'trip_idea_decide').pop());
  check(label + ': …asking for this option at the lengths worth comparing', dq && dq.ideaId && /^OPT-/.test(dq.optionId) && dq.nights === '7,10,14,21', JSON.stringify(dq));
  await wait(400);
  let dt = await page.$eval('#tiprobe .ti-decide', n => n.innerText).catch(() => '');
  check(label + ': the route\'s own length is picked', await page.$eval('#tiprobe .ti-decide .ti-chip.on', n => n.innerText).catch(() => '') === '10 nights (this route)');
  check(label + ': the cheapest window first, with what it costs each of you', /Sat, May 29 → Tue, Jun 8/.test(dt) && /CHEAPEST/.test(dt) && /Ann: 4 days off · 6 left/.test(dt) && /Bea: 4 days off · over by 1/.test(dt), dt.slice(0, 500));
  check(label + ': …the holiday it bridges, and a clash named', /Bridges Memorial Day/.test(dt) && /⚠ Clashes with Beach week/.test(dt));
  check(label + ': it says whose count is less sure', /Bea's work calendar couldn't be read/.test(dt));
  check(label + ': typical weather for the brief\'s months, per stop', /Mar\s+Apr\s+May/.test(dt) && /57°\s*\/\s*47°/.test(dt) && /10 rainy d/.test(dt) && /Not a place VERA could find/.test(dt), dt.slice(-600));
  check(label + ': …and where it comes from', /averages of 2015–2024, as measured/.test(dt));
  await act(page, () => Array.from(document.querySelectorAll('#tiprobe .ti-decide .ti-chip')).find(b => b.innerText === '14 nights').click());
  dt = await page.$eval('#tiprobe .ti-decide', n => n.innerText).catch(() => '');
  check(label + ': another length shows its own windows, with no new request', /Sat, May 29 → Sat, Jun 12/.test(dt) && (await page.evaluate(() => window.__gets.filter(g => g.action === 'trip_idea_decide').length)) === 1, dt.slice(0, 200));
  check(label + ': no sideways scroll with the deciders open', await noScroll(page));
  if (process.env.SHOT_DIR) { const el = await page.$('#tiprobe .ti-decide'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/tripideas-decide-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
  await act(page, (f) => eval(f)().querySelector('.ti-decide-btn').click(), simpleCard.toString());
  check(label + ': …and they fold away', !(await page.$('#tiprobe .ti-decide')));

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

  // Pieces, then Ask VERA
  await act(page, () => window.__q('.ti-idea-card').click());
  await act(page, () => window.__q('.ti-edit-pieces').click());
  await act(page, () => { window.__q('.ti-add-anchor').click(); });
  await act(page, () => { window.__q('.ti-add-choice').click(); });
  await act(page, () => { window.__q('.ti-add-choice').click(); });
  await act(page, () => { window.__q('.ti-add-wish').click(); });
  await act(page, () => {
    const rows = Array.from(document.querySelectorAll('#tiprobe .ti-piece-row'));
    ['A Med cruise, ~7 nights', 'Cruise A', 'Cruise B', 'Lake Como'].forEach((v, i) => window.__set(rows[i].querySelector('input[aria-label="Piece"]'), v));
    rows.filter(r => r.querySelector('input[aria-label="Slot"]')).forEach(r => window.__set(r.querySelector('input[aria-label="Slot"]'), 'Which cruise'));
  });
  await act(page, () => window.__q('.ti-save-pieces').click());
  const pz = await page.evaluate(() => window.__posts.filter(p => p.action === 'trip_idea_save').pop());
  check(label + ': pieces save with the idea: an anchor, a two-way either/or, a wish', pz && pz.idea.pieces.map(p => p.kind + ':' + p.name + (p.group ? '@' + p.group : '')).join('|') === 'anchor:A Med cruise, ~7 nights|choice:Cruise A@Which cruise|choice:Cruise B@Which cruise|wish:Lake Como', JSON.stringify(pz && pz.idea.pieces));
  t = await text(page);
  check(label + ': the pieces show, with what VERA will do', /A Med cruise, ~7 nights/.test(t) && /Which cruise:\s*Cruise A\s+or\s+Cruise B/.test(t) && /one option per choice for which cruise \(Cruise A or Cruise B\)/.test(t), t.slice(0, 600));
  await act(page, () => window.__q('.ti-ask').click());
  await wait(150);
  const ask = await page.evaluate(() => window.__posts.filter(p => p.action === 'trip_idea_ask').pop());
  check(label + ': Ask VERA sends the idea and a one-time ask id', ask && ask.ideaId && /^ask/.test(ask.askId) && !ask.focus, JSON.stringify(ask));
  const vc = await page.$$eval('#tiprobe .ti-option', ns => ns.map(n => ({ text: n.innerText, vera: n.querySelectorAll('.ti-vera').length, piece: n.querySelectorAll('.ti-piece').length })));
  const sw = vc.find(c => /Swiss train → Cruise A/.test(c.text)) || { text: '', vera: 0, piece: 0 };
  check(label + ': VERA\'s options arrive, with its take', /VERA'S TAKE · FITS WELL/i.test(sw.text) && /Every join is a train/.test(sw.text) && vc.some(c => /WORKS, WITH A COST/i.test(c.text)), sw.text.slice(0, 300));
  check(label + ': your pieces and VERA\'s joins are told apart', sw.vera === 3 && sw.piece === 3 && /Your pieces/.test(sw.text) && /VERA filled in/.test(sw.text), JSON.stringify({ vera: sw.vera, piece: sw.piece }));
  check(label + ': wishes fitted and left out, with why', /✓ Lake Como/.test(sw.text) && /✕ Beach days: only the port days/.test(sw.text));
  t = await text(page);
  check(label + ': what VERA saw but did not build is offered', /Also possible · not built/i.test(t) && /Road trip → Cruise A/.test(t) && !!(await page.$('#tiprobe .ti-build-also')));
  await act(page, () => window.__q('.ti-build-also').click());
  await wait(150);
  const focus = await page.evaluate(() => window.__posts.filter(p => p.action === 'trip_idea_ask').pop());
  check(label + ': "Build this one too" asks for just that one', focus && focus.focus === 'Road trip → Cruise A' && focus.askId !== ask.askId);
  check(label + ': …which then leaves the list', !(await page.$('#tiprobe .ti-also')) && /Road trip → Cruise A/.test((await page.$$eval('#tiprobe .ti-option-name', ns => ns.map(n => n.innerText))).join('|')));
  check(label + ': no sideways scroll with VERA\'s options', await noScroll(page));

  // Hand-offs: a brief out to an AI chat, its options back; a line to WILLA and a budget back; a fare request to ARIA and a fare back
  await act(page, () => window.__q('.ti-to-chat').click());
  let box = await page.$eval('#tiprobe .ti-copyout textarea', n => n.value).catch(() => '');
  check(label + ': the chat brief has the brief, the options so far and the format to answer in', /When: Mar – May 20\d\d \(no dates yet\)/.test(box) && /Name: Lisbon → Algarve → cruise/.test(box) && /Reply with each option in exactly this format/.test(box) && !/fly in and out/.test(box), box.slice(0, 300));
  await act(page, () => window.__q('.ti-copy').click());
  check(label + ': Copy puts it on the clipboard, and says so', (await page.evaluate(() => window.__clip)) === box && /Copied\. Paste it into ChatGPT, Claude or Gemini/.test(await text(page)));
  await act(page, () => window.__q('.ti-from-chat').click());
  check(label + ': one hand-off at a time', !(await page.$('#tiprobe .ti-copyout')) && !!(await page.$('#tiprobe .ti-pastein')));
  await act(page, () => { window.__set(window.__q('.ti-paste-source'), 'claude'); window.__set(window.__q('.ti-pastein textarea'), 'Here you go!\n=== VERA option v1 ===\nName: Porto by train\n=== end ==='); });
  await act(page, () => window.__q('.ti-paste-read').click());
  t = await page.$eval('#tiprobe .ti-pastein', n => n.innerText);
  check(label + ': the pasted options show before anything is saved', /Found 1 option, read exactly from the format/.test(t) && /Porto by train/.test(t) && (await page.evaluate(() => window.__posts.filter(p => p.action === 'trip_option_save' && p.option.name === 'Porto by train').length)) === 0, t.slice(0, 300));
  const parseReq = await page.evaluate(() => window.__posts.filter(p => p.action === 'trip_option_parse').pop());
  check(label + ': …read for this idea, from the chat it came from', parseReq && parseReq.ideaId && parseReq.source === 'claude');
  await act(page, () => window.__q('.ti-paste-save').click());
  await wait(100);
  const porto = await page.$$eval('#tiprobe .ti-option', ns => (ns.find(n => /Porto by train/.test(n.innerText)) || { innerText: '' }).innerText);
  check(label + ': Save keeps them as options, marked as from that chat', /from Claude/.test(porto) && !(await page.$('#tiprobe .ti-pastein')), porto.slice(0, 200));

  await act(page, () => window.__q('.ti-from-willa').click());
  await act(page, () => window.__set(window.__q('.ti-pastein textarea'), 'Looks doable. Budget: $12,500 for the whole trip.'));
  check(label + ': WILLA\'s budget is read and shown against the old one', /Budget: \$13k \(was \$9k\)/.test(await page.$eval('#tiprobe .ti-figure-preview', n => n.innerText).catch(() => '')));
  await act(page, () => window.__q('.ti-figure-use').click());
  const bud = await page.evaluate(() => window.__posts.filter(p => p.action === 'trip_idea_save').pop());
  check(label + ': …and becomes the idea\'s budget', bud && bud.idea.budget === 12500 && /budget \$13k/.test(await text(page)));

  const mixedCard = () => Array.from(document.querySelectorAll('#tiprobe .ti-option')).find(n => /Lisbon → Algarve → cruise/.test(n.querySelector('.ti-option-name').innerText));
  await act(page, (f) => eval(f)().querySelector('.ti-handoff-btn').click(), mixedCard.toString());
  await act(page, (f) => eval(f)().querySelector('.ti-to-willa').click(), mixedCard.toString());
  box = await page.evaluate((f) => { const c = eval(f)().querySelector('.ti-copyout textarea'); return c ? c.value : ''; }, mixedCard.toString());
  check(label + ': WILLA gets one line with the option and its money', /^VERA → WILLA · Trip idea "Spring in Europe": Lisbon → Algarve → cruise · 13 nights · Mar – May 20\d\d · estimated \$5\.4k – \$7\.8k total/.test(box) && /budget \$13k \(within\)/.test(box), box);
  await act(page, (f) => eval(f)().querySelector('.ti-to-aria').click(), mixedCard.toString());
  box = await page.evaluate((f) => { const c = eval(f)().querySelector('.ti-copyout textarea'); return c ? c.value : ''; }, mixedCard.toString());
  check(label + ': ARIA gets the route\'s flights and the answer to give', /=== VERA fare request v1 ===/.test(box) && /- Home → LIS\n- BCN → Home\n/.test(box) && /Fare: \$<total/.test(box), box);
  await act(page, (f) => eval(f)().querySelector('.ti-from-aria').click(), mixedCard.toString());
  await act(page, () => window.__set(window.__q('.ti-pastein textarea'), 'Fare: $2,050 · checked 2026-10-24'));
  check(label + ': ARIA\'s fare is read and shown against the estimate', /Flights: \$2\.1k · ARIA · checked 2026-10-24 \(was \$1\.4k – \$1\.8k/.test(await page.$eval('#tiprobe .ti-figure-preview', n => n.innerText).catch(() => '')));
  await act(page, () => window.__q('.ti-figure-use').click());
  const fare = await page.evaluate(() => window.__posts.filter(p => p.action === 'trip_option_save').pop());
  check(label + ': …and replaces the flights estimate, keeping the date', fare && fare.option.name === 'Lisbon → Algarve → cruise' && JSON.stringify(fare.option.cost.flights) === '{"low":2050,"high":2050,"basis":"ARIA · checked 2026-10-24"}' && fare.option.cost.cruise.low === 4000, JSON.stringify(fare && fare.option.cost));
  check(label + ': no sideways scroll with the hand-offs', await noScroll(page));
  if (process.env.SHOT_DIR) { const el = await page.$('#tiprobe'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/tripideas-handoff-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }

  // ARIA: a starred option of a shortlisted idea can be scouted; its fares come back on the card and in the date windows
  const ariaCard = () => Array.from(document.querySelectorAll('#tiprobe .ti-option')).find(n => /Lisbon → Algarve → cruise/.test(n.querySelector('.ti-option-name').innerText));
  const inCard = async (sel) => page.evaluate((a) => { const c = eval(a.f)(); const el = c && c.querySelector(a.sel); return el ? el.innerText : null; }, { f: ariaCard.toString(), sel });
  check(label + ': while the idea is brainstorming, ARIA isn\'t offered', (await inCard('.ti-aria-scout')) === null);
  await page.evaluate(() => window.__set(window.__q('.ti-status'), 'shortlisted')); await wait(150);
  check(label + ': once shortlisted, its starred option can be scouted', /Scout fares with ARIA/.test((await inCard('.ti-aria-scout')) || ''));
  const notStar = await page.$$eval('#tiprobe .ti-option', ns => ns.filter(n => !n.classList.contains('ti-star')).some(n => n.querySelector('.ti-aria-scout')));
  check(label + ': …and only the starred one', notStar === false);
  await page.evaluate((f) => eval(f)().querySelector('.ti-aria-scout').click(), ariaCard.toString()); await wait(200);
  const sreq = await page.evaluate(() => window.__posts.filter(p => p.action === 'aria_request_save').pop());
  check(label + ': Scout asks ARIA for this option of this idea', sreq && /^IDEA-/.test(sreq.ideaId) && /^OPT-/.test(sreq.optionId), JSON.stringify(sreq));
  let ac = (await inCard('.ti-aria')) || '';
  check(label + ': …then says when ARIA will pick it up, and offers to stop', /ARIA · SCOUTING/i.test(ac) && /Asked 2026-10-25\. ARIA picks this up on its next morning run/.test(ac) && /Stop scouting/.test(ac), ac);
  // ARIA's morning run: it picks the request up and logs fares under the option's ID.
  await page.evaluate(() => { window.__ariaRan = window.__posts.filter(p => p.action === 'aria_request_save').pop().optionId.toUpperCase(); });
  await page.evaluate(() => window.__q('.ti-back').click()); await wait(80);
  await page.evaluate(() => window.__q('.ti-idea-card').click()); await wait(200);
  ac = (await inCard('.ti-aria')) || '';
  check(label + ': after ARIA\'s run, its best fare shows beside your estimate', /\$1,840 for 2 · Fri, May 28 → Thu, Jun 10 · checked 2027-02-15 · wait · your flights estimate \$2\.1k/.test(ac), ac);
  await page.evaluate((f) => eval(f)().querySelector('.ti-decide-btn').click(), ariaCard.toString()); await wait(450);
  const wtxt = await page.evaluate((f) => { const d = eval(f)().querySelector('.ti-decide'); return d ? d.innerText : ''; }, ariaCard.toString());
  check(label + ': a date window shows ARIA\'s fare for leaving near it', /Sat, May 29 → Fri, Jun 11[^\n]*\n[\s\S]*?🧭 ARIA: \$1,840 leaving Fri, May 28 · checked 2027-02-15/.test(wtxt), wtxt.slice(0, 500));
  await page.evaluate((f) => eval(f)().querySelector('.ti-decide-btn').click(), ariaCard.toString()); await wait(80);
  await page.evaluate((f) => eval(f)().querySelector('.ti-aria-stop').click(), ariaCard.toString()); await wait(200);
  const wd = await page.evaluate(() => window.__posts.filter(p => p.action === 'aria_request_withdraw').pop());
  check(label + ': Stop scouting withdraws the request', wd && wd.ref.toUpperCase() === (await page.evaluate(() => window.__ariaRan)));
  check(label + ': …and the card offers to scout again', /Scout again with ARIA/.test((await inCard('.ti-aria-scout')) || ''));
  check(label + ': no sideways scroll with ARIA on the card', await noScroll(page));

  // Settle: pick a PTO window, name the event, save and download one calendar event; then stop settling
  check(label + ': a starred option offers to settle the trip', /Settle this trip/.test((await inCard('.ti-settle-btn')) || ''));
  await page.evaluate((f) => eval(f)().querySelector('.ti-settle-btn').click(), ariaCard.toString()); await wait(450);
  let st = (await inCard('.ti-settle')) || '';
  check(label + ': it offers the cheapest PTO windows for the route\'s length, the first picked', /Sat, May 29 → Fri, Jun 11/.test(st) && /Ann: 4 days off · 6 left/.test(st) && /Other dates/.test(st)
    && (await page.evaluate((f) => { const b = eval(f)().querySelector('.ti-settle-window'); return b && b.getAttribute('aria-checked'); }, ariaCard.toString())) === 'true', st.slice(0, 400));
  check(label + ': …and says VERA adds nothing to a calendar itself', /it adds nothing to a calendar itself/.test(st));
  await page.evaluate((f) => window.__set(eval(f)().querySelector('.ti-settle-label'), 'Spring in Europe, 2027'), ariaCard.toString()); await wait(60);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }).catch(() => null),
    page.evaluate((f) => eval(f)().querySelector('.ti-settle-save').click(), ariaCard.toString())]);
  await wait(150);
  const ics = dl ? fs.readFileSync(await dl.path(), 'utf8') : '';
  check(label + ': Save downloads one all-day event for those dates', dl && dl.suggestedFilename() === 'spring-in-europe-2027.ics' && /DTSTART;VALUE=DATE:20270529/.test(ics) && /DTEND;VALUE=DATE:20270612/.test(ics)
    && /SUMMARY:Spring in Europe\\, 2027/.test(ics) && (ics.match(/BEGIN:VEVENT/g) || []).length === 1, dl ? dl.suggestedFilename() + ' ' + ics.slice(0, 300) : 'no download');
  const sp = await page.evaluate(() => window.__posts.filter(p => p.action === 'trip_idea_save').pop());
  check(label + ': …and saves the settle on the idea', sp && sp.idea.settle && /^OPT-/.test(sp.idea.settle.optionId) && sp.idea.settle.start === '2027-05-29' && sp.idea.settle.end === '2027-06-11' && sp.idea.settle.label === 'Spring in Europe, 2027', JSON.stringify(sp && sp.idea.settle));
  st = await page.$eval('#tiprobe .ti-settling', n => n.innerText).catch(() => '');
  check(label + ': the idea says it is waiting for the calendar event, with what to do', /SETTLING · WAITING FOR THE CALENDAR EVENT/i.test(st) && /Spring in Europe, 2027 · Sat, May 29 → Fri, Jun 11 2027 · Lisbon → Algarve → cruise/.test(st) && /Import the event into Our Joint Chaos/.test(st), st);
  check(label + ': …and the option no longer offers to settle', (await inCard('.ti-settle-btn')) === null && (await inCard('.ti-settle')) === null);
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }).catch(() => null), page.evaluate(() => window.__q('.ti-settle-again').click())]);
  check(label + ': the event can be downloaded again, the same event', dl2 && /UID:settle-idea-\d+-20270529@vera/.test(fs.readFileSync(await dl2.path(), 'utf8')));
  check(label + ': no sideways scroll while settling', await noScroll(page));
  if (process.env.SHOT_DIR) { const el = await page.$('#tiprobe .ti-settling'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/tripideas-settling-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
  await page.evaluate(() => window.__q('.ti-settle-stop').click()); await wait(150);
  const un = await page.evaluate(() => window.__posts.filter(p => p.action === 'trip_idea_save').pop());
  check(label + ': Stop settling clears it', un && un.idea.settle === null && !(await page.$('#tiprobe .ti-settling')) && /Settle this trip/.test((await inCard('.ti-settle-btn')) || ''));
  if (process.env.SHOT_DIR) { await page.evaluate((f) => { eval(f)().id = 'aria-card-shot'; }, ariaCard.toString()); const ce = await page.$('#aria-card-shot'); if (ce) try { await ce.screenshot({ path: process.env.SHOT_DIR + '/tripideas-aria-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
  if (process.env.SHOT_DIR) { const el = await page.$('#tiprobe'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/tripideas-ask-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
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
