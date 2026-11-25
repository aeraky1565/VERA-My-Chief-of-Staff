// AGORA on the full dashboard (docs/index.html) at 390 and 1280: the Lounge (moods, bubbles,
// coming soon, trip tag, free slot, two teachers talking, this month, levels, tap opens her app),
// the trip Summary box, and the roll call in Agent health. apiGet is stubbed. Invented teachers.
const { chromium } = require('playwright');
const path = require('path');
const ROOT = process.env.VERA_PAGES_ROOT || path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const DATA = { ok: true, today: '2026-11-25', levels: ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
  sync: { at: '2026-11-25T04:20:00Z', sources: 2, logged: 1, failed: 0 },
  slot: { teacher: 't2', name: 'NINA', from: '18:30', to: '19:10', minutes: 40 },
  teachers: [
    { key: 't0', name: 'ALMA', lang: 'French', flag: '🇫🇷', app: 'https://alma.example/app', live: true, mood: 'proud', practisedToday: true, theme: 'Le passé', minutesToday: 20, thisWeek: 4, target: 4, lastDate: '2026-11-25', level: 'A2+', targetLevel: 'B1', month: { lessons: 9, minutes: 210 }, trip: null },
    { key: 't1', name: 'KAI', lang: 'German', flag: '🇩🇪', app: '', sheetUrl: 'https://docs.google.com/spreadsheets/d/S2/edit', live: true, mood: 'today', practisedToday: true, theme: 'Verben', minutesToday: 15, thisWeek: 1, target: 3, lastDate: '2026-11-25', level: 'A1', targetLevel: 'A2', month: { lessons: 3, minutes: 45 }, trip: null },
    { key: 't2', name: 'NINA', lang: 'Italian', flag: '🇮🇹', app: 'https://nina.example', live: true, mood: 'waiting', practisedToday: false, thisWeek: 1, target: 3, lastDate: '2026-11-23', level: '', targetLevel: 'A1', month: { lessons: 1, minutes: 15 }, trip: { tripKey: '2027-01-02|Rome', label: 'Rome', startDate: '2027-01-02', days: 38 } },
    { key: 't3', name: 'TEO', lang: 'Spanish', flag: '🇪🇸', live: false },
  ] };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of [390, 1280]) {
    console.log('\nfull dashboard @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    const ok = await page.evaluate((data) => {
      if (typeof AgoraLounge !== 'function' || typeof AgoraRollCall !== 'function' || typeof TsAgoraTeacher !== 'function') return 'missing component';
      document.querySelectorAll('.modal-overlay').forEach(n => n.remove()); const root = document.getElementById('root'); if (root) root.style.display = 'none';
      window.apiGet = function () { return Promise.resolve(JSON.parse(JSON.stringify(data))); };
      const mk = id => { const d = document.createElement('div'); d.id = id; document.body.prepend(d); return d; };
      ReactDOM.createRoot(mk('p-trip')).render(React.createElement(TsAgoraTeacher, { trip: { tripKey: '2027-01-02|Rome', label: 'Rome', startDate: '2027-01-02' }, card: {}, label: {}, apiUrl: 'u', apiToken: 't' }));
      ReactDOM.createRoot(mk('p-roll')).render(React.createElement(AgoraRollCall, { apiUrl: 'u', apiToken: 't' }));
      ReactDOM.createRoot(mk('p-lounge')).render(React.createElement(AgoraLounge, { apiUrl: 'u', apiToken: 't' }));
      return 'ok';
    }, DATA);
    if (ok !== 'ok') { fail++; console.log('  FAIL ' + ok); await page.close(); continue; }
    await page.waitForSelector('#p-lounge .ag-room');
    const L = '#p-lounge ';
    const names = await page.$$eval(L + '.ag-seat .ag-name', ns => ns.map(n => n.innerText));
    check('four seats: three teachers and one coming soon (no extra empty chair)', names.join('|') === 'ALMA|KAI|NINA|TEO', names.join('|'));
    const seat = n => L + '.ag-seat[data-teacher="' + n + '"] ';
    const txt = s => page.$eval(s, e => e.innerText).catch(() => '');
    check('proud: ✨ chip and her theme in the bubble', /✨ 4 of 4/.test(await txt(seat('ALMA') + '.ag-chip')) && /Le passé ✓/.test(await txt(seat('ALMA') + '.ag-bubble')) && !!(await page.$(seat('ALMA') + '.ag-proud')));
    check('today: ✓ today with minutes', /✓ today · 15 min/.test(await txt(seat('KAI') + '.ag-chip')));
    check('waiting with a trip: comes forward with the trip tag and an Italian line', !!(await page.$(L + '.ag-seat.fwd[data-teacher="NINA"]')) && /Rome · 38 d/.test(await txt(seat('NINA') + '.ag-trip')) && /Rome tra 38 giorni/.test(await txt(seat('NINA') + '.ag-bubble')));
    check('coming soon: greyed, not a link', /coming soon/.test(await txt(seat('TEO') + '.ag-chip')) && !(await page.$('a.ag-seat[data-teacher="TEO"]')) && !!(await page.$(L + '.ag-seat.soon[data-teacher="TEO"]')));
    check('tap opens her app, or her sheet without one', (await page.getAttribute('a.ag-seat[data-teacher="ALMA"]', 'href')) === 'https://alma.example/app' && (await page.getAttribute('a.ag-seat[data-teacher="KAI"]', 'href')) === 'https://docs.google.com/spreadsheets/d/S2/edit' && (await page.getAttribute('a.ag-seat[data-teacher="ALMA"]', 'target')) === '_blank');
    check('the free slot names the time and the teacher', /Free 6:30 PM–7:10 PM today · 40 min for NINA/.test(await txt(L + '.ag-slot')), await txt(L + '.ag-slot'));
    const talk = await txt(L + '.ag-talk');
    check('two practised today: they talk, each in her language', /ALMA Bravo ! Deux langues/.test(talk) && /KAI Fleißig heute!/.test(talk), talk);
    check('this month, per live teacher', (await page.$$(L + '.ag-mrow')).length === 3 && /9 lessons · 210 min/.test(await txt(L + '.ag-panel')));
    const track = await page.$$eval(L + '.ag-lrow .ag-track b', bs => bs.map(b => b.innerText + (b.classList.contains('now') ? '*' : '') + (b.classList.contains('goal') ? '!' : '')));
    check('level track: now marked, the goal dashed', track.slice(0, 4).join(' ') === 'A1 A2+* B1! B2', track.join(' '));
    check('a teacher with no level says how to add one, and only her', (await page.$$(L + '.ag-nolvl')).length === 1);
    const room = await page.getAttribute(L + '.ag-room', 'class');
    check('the room follows the time of day', /\b(morning|afternoon|evening)\b/.test(room), room);
    // trip Summary
    const tripTxt = await txt('#p-trip');
    check('the trip page shows the teacher for that trip', /NINA/.test(tripTxt) && /38 days to go/.test(tripTxt) && (await page.getAttribute('#p-trip .ts-agora-open', 'href')) === 'https://nina.example', tripTxt);
    // roll call
    const roll = await txt('#p-roll');
    check('roll call: one line per teacher, never late or failed', /AGORA · LANGUAGE TEACHERS/i.test(roll) && /ALMA · French/.test(roll) && /TEO · Spanish/.test(roll) && /coming soon/.test(roll) && !/late|failed/i.test(roll), roll);
    check('…and last night’s sync', /Practice sync/.test(roll) && /2 sheets read, 1 new day logged/.test(roll));
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('no sideways scroll', sw <= 0, sw);
    check('no page errors', !errors.length, errors.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
