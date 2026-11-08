// Trip summary › Readiness (TsReadinessSection, inside the TripSummaryView block shared verbatim
// by both dashboards), at phone and desktop width, with a stubbed trip_readiness answer.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const cut = s => { const a = s.indexOf('// Readiness per traveller (TripReadiness.js, issue #227)'), b = s.indexOf('function TripSummaryView(props){'); return a === -1 || b === -1 ? '' : s.slice(a, b); };
const TS = s => { const a = s.indexOf('// ---- TripSummaryView (itinerary redesign)'), b = s.indexOf('// ---- /TripSummaryView ----'); return a === -1 || b === -1 ? '' : s.slice(a, b); };

console.log('\nthe source');
check('the Readiness pieces sit inside the shared trip summary, word for word in both', cut(APP).length > 3000 && cut(APP) === cut(LITE) && TS(APP).indexOf(cut(APP)) !== -1 && TS(APP) === TS(LITE));
check('the summary shows it just before Documents and Before you go', /h\(TsReadinessSection,\{trip:trip,apiUrl:props\.apiUrl,apiToken:props\.apiToken,readiness:props\.readiness,card:card,label:label\}\),\n    h\(TsLeaveHome,[^\n]*\n    \/\/ Before you go\n    documents&&/.test(TS(APP)));

const DATA = { ok: true, people: [
  { person: 'Sam', state: 'todo', rows: [
    { state: 'todo', area: 'bookings', text: 'Member number missing on TP 204 · IAD → LIS: add your United MileagePlus (••4455) number' },
    { state: 'todo', area: 'medication', text: 'Refill Inhaler before you go (due 2027-04-02)', action: { kind: 'pack', item: 'Refill Inhaler before leaving', person: 'Sam' } },
    { state: 'ready', area: 'lounge', text: 'Lounge by status: United MileagePlus Premier Gold (Star Alliance Gold)' }] },
  { person: 'Lee', state: 'blocks', rows: [{ state: 'blocks', area: 'documents', text: 'Portugal: Visa Required on the Ireland passport' }] }],
  cards: ['Lounge by card: Priority Pass (Travel Card)'],
  health: [{ country: 'Portugal', vaccines: ['Hepatitis A', 'Typhoid'], phrase: { language: 'Portuguese', text: 'Tenho alergia grave a amendoim.', english: 'I have a serious peanut allergy.' } }] };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'), 'react-dom.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8') };
  const shell = body => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0b1020;color:#dde1f0;font-family:sans-serif}</style>'
    + '<script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>' + body + '</script></body></html>';
  const open = async (width, answer) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const probe = 'window.CALLS=[];window.POSTS=[];var ANSWER=' + JSON.stringify(answer) + ';'
      + 'function apiGet(u,t,p){CALLS.push(p);return ANSWER===null?Promise.reject(new Error("down")):Promise.resolve(JSON.parse(JSON.stringify(ANSWER)));}'
      + 'function apiPost(u,t,b){POSTS.push(b);return Promise.resolve({ok:true});}'
      + cut(APP) + "\nvar card={background:'#0d1b3e',border:'1px solid #1e3060',borderRadius:12,padding:14,display:'flex',flexDirection:'column',gap:10};var label={fontSize:11};"
      + "ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('div',null,React.createElement(TsReadinessSection,{trip:{tripKey:'2027-04-01|Lisbon',startDate:'2027-04-01',endDate:'2027-04-10'},apiUrl:'x',apiToken:'y',card:card,label:label}),React.createElement('p',{id:'after'},'after')));";
    await page.route('**/*', r => { const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] }); return r.fulfill({ contentType: 'text/html', body: shell(probe) }); });
    await page.goto('http://probe.local/'); await page.waitForSelector('#after'); await wait(200);
    return { page, errs };
  };
  for (const width of [390, 1280]) {
    const L = '@' + width;
    let { page, errs } = await open(width, DATA);
    const calls = await page.evaluate(() => CALLS);
    check(L + ': one trip_readiness call for this trip', calls.length === 1 && calls[0].action === 'trip_readiness' && calls[0].tripKey === '2027-04-01|Lisbon' && calls[0].endDate === '2027-04-10');
    check(L + ': a card per traveller with its state', (await page.$$eval('.ts-rd-person', ns => ns.map(n => n.dataset.state).join())) === 'todo,blocks' && /Blocks the trip/.test(await page.$eval('.ts-rd-person[data-state="blocks"]', n => n.innerText)));
    const sam = await page.$eval('.ts-rd-person', n => n.innerText);
    check(L + ': the rows, each with its words', /Member number missing on TP 204/.test(sam) && /Refill Inhaler before you go/.test(sam) && /Lounge by status: United MileagePlus Premier Gold/.test(sam));
    check(L + ': lounges by card, then the health notes with a check-with-your-doctor line', /Lounge by card: Priority Pass \(Travel Card\)/.test(await page.$eval('.ts-rd-cards', n => n.innerText))
      && /Portugal: vaccines to ask your doctor about: Hepatitis A, Typhoid\./.test(await page.$eval('.ts-rd-health', n => n.innerText)) && /Allergy phrase \(Portuguese\): “Tenho alergia grave a amendoim\.” \(I have a serious peanut allergy\.\)/.test(await page.$eval('.ts-rd-health', n => n.innerText))
      && /Check with your doctor/.test(await page.$eval('.ts-rd-section', n => n.innerText)));
    await page.click('.ts-rd-pack'); await wait(150);
    const p = await page.evaluate(() => POSTS[0] || {});
    check(L + ': Add to packing sends the refill, then says it’s added', p.action === 'trip_readiness_pack' && p.item === 'Refill Inhaler before leaving' && p.person === 'Sam' && p.tripKey === '2027-04-01|Lisbon'
      && /Added to packing ✓/.test(await page.$eval('.ts-rd-pack', n => n.innerText)));
    const sizes = await page.$$eval('.ts-rd-section button', ns => ns.map(n => n.getBoundingClientRect().height));
    check(L + ': buttons are at least 36 px; no sideways scroll; no errors', sizes.every(x => x >= 35.5) && (await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)) && errs.length === 0, errs.join(' | '));
    await page.close();
  }
  for (const [name, ans] of [['no profiles yet', { ok: true, people: [], cards: [], health: [], empty: true }], ['the check failed', null]]) {
    const { page, errs } = await open(390, ans);
    check(name + ': no Readiness section at all', !(await page.$('.ts-rd-section')) && errs.length === 0);
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
