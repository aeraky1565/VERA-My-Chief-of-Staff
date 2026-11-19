const NR__ = require('fs').readFileSync(require('path').join(process.env.VERA_ROOT || require('path').join(__dirname, '..', '..'), 'NightlyRunner.js'), 'utf8');   // the night's one list (#256)
// Finances › Tax (Tax.js, the tax document routes, checkTaxLate_, TaxTab, the Needs you row). Pins:
//  - Received On is stamped the first time a document leaves Not received, cleared when it goes back,
//    and the column is named on a tab made before it;
//  - "usually arrives": last year's copy (same form, issuer, owner) a year on; late only while
//    still not received; the nightly Medium flag at 14+ days late, closed once it arrives;
//  - the Needs you row once every document is verified and some aren't uploaded (not after filing);
//  - the screen: the ring and the deadline countdown, per-person "left", the step row, the usual /
//    late note, the send-to-preparer line, add and copy. Invented documents.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TX = read('Tax.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = isoOf(new Date()), ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d); }, lastYear = iso => (Number(iso.slice(0, 4)) - 1) + iso.slice(4);
const HDR = ['ID', 'Tax Year', 'Form Type', 'Issuer / Source', 'Account / Description', 'Category', 'Status', 'Document Link', 'Owner', 'Notes'];
function sheetOf(rows) { let cols = rows[0].length; const pad = r => { while (r.length < cols) r.push(''); return r; }; rows.forEach(pad);
  return { rows, getLastRow: () => rows.length, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; rows.forEach(pad); },
    getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
      getValue: () => (rows[r - 1] || [])[c - 1] ?? '', setValue: x => { rows[r - 1][c - 1] = x; } }) }; }
function ctx(sheet, extra) {
  const c = Object.assign({ String, Number, Math, JSON, Date, Object, CONFIG: { SHEET_ID: 'x' }, TABS: { TAX_DOCUMENTS: 'T', FLAGS: 'F' }, TAX_DOCUMENT_HEADERS: HDR,
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) }, Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: d => isoOf(d) }, errOut_: m => ({ ok: false, error: m }) }, extra || {});
  vm.createContext(c); vm.runInContext(TX + '\n' + ['webGetTaxDocuments_', 'webUpdateTaxDocument_'].map(n => fnSrc(WEB, n)).join('\n'), c); return c;
}

console.log('\nwhen it arrived');
{
  const sh = sheetOf([HDR.slice(), ['d1', 2025, 'W-2', 'Verdant Telecom', '', 'Income', 'not_received', '', 'Ahmed', '']]);
  const c = ctx(sh);
  c.webUpdateTaxDocument_({ parameter: { id: 'd1', status: 'received' } });
  check('leaving Not received stamps Received On, in a named column', sh.rows[0][10] === 'Received On' && sh.rows[1][10] === TODAY && sh.rows[1][6] === 'received', J(sh.rows[1]));
  sh.rows[1][10] = '2026-01-20';
  c.webUpdateTaxDocument_({ parameter: { id: 'd1', status: 'verified' } });
  check('…a later step keeps the first date', sh.rows[1][10] === '2026-01-20');
  c.webUpdateTaxDocument_({ parameter: { id: 'd1', status: 'not_received' } });
  check('…back to Not received clears it', sh.rows[1][10] === '');
  c.webUpdateTaxDocument_({ parameter: { id: 'd1', notes: 'x' } });
  check('…a change that isn’t the status stamps nothing', sh.rows[1][10] === '');
}

console.log('\nusually arrives, and late');
const C = { String, Number, Math, JSON, Date, Object }; vm.createContext(C); vm.runInContext(TX, C);
const DOCS = [{ id: 'old1', taxYear: 2024, formType: 'W-2', issuer: 'Verdant Telecom', owner: 'Ahmed', status: 'uploaded', receivedOn: '2025-01-24' },
  { id: 'new1', taxYear: 2025, formType: 'W-2', issuer: ' verdant  telecom', owner: 'Ahmed', status: 'not_received' },
  { id: 'old2', taxYear: 2024, formType: '1098', issuer: 'Mortgage Co', owner: 'Joint', status: 'uploaded', receivedOn: '2025-02-10' },
  { id: 'new2', taxYear: 2025, formType: '1098', issuer: 'Mortgage Co', owner: 'Joint', status: 'received', receivedOn: '2026-02-01' },
  { id: 'new3', taxYear: 2025, formType: '1098', issuer: 'Mortgage Co', owner: 'Victoria', status: 'not_received' }];
const u = C.txUsual_(DOCS, '2026-02-15');
check('last year’s copy a year on (form, issuer, owner; case and spaces ignored)', u.new1 && u.new1.expected === '2026-01-24' && u.new1.daysLate === 22, J(u.new1));
check('…received: not late', u.new2 && u.new2.daysLate === null);
check('…another owner’s isn’t the same document', !u.new3);
check('…not yet due: not late', C.txUsual_(DOCS, '2026-01-20').new1.daysLate === null);
check('the words', C.txWhen_('2026-01-24') === 'late Jan' && C.txWhen_('2026-02-10') === 'early Feb' && C.txWhen_('2026-02-15') === 'mid Feb' && C.txNextYear_('2024-02-29') === '2025-02-28');
{
  const flags = { calls: [] };
  const sh = sheetOf([HDR.concat(['Received On']), ['o', 2024, 'W-2', 'Verdant', '', '', 'uploaded', '', 'Ahmed', '', lastYear(ago(20))], ['n', 2025, 'W-2', 'Verdant', '', '', 'not_received', '', 'Ahmed', '', ''],
    ['o2', 2024, '1099-INT', 'Bank', '', '', 'uploaded', '', 'Ahmed', '', lastYear(ago(10))], ['n2', 2025, '1099-INT', 'Bank', '', '', 'not_received', '', 'Ahmed', '', '']]);
  const c = ctx(sh, { getSpreadsheet: () => ({ getSheetByName: () => ({}) }), upsertKeyedFlags_: (s, p, src, wanted) => flags.calls.push([p, src, wanted]) });
  c.checkTaxLate_();
  const w = flags.calls[0][2];
  check('the nightly flag: 14+ days late only, Medium, under tax_late_', flags.calls[0][0] === 'tax_late_' && J(Object.keys(w)) === J(['tax_late_n']) && w.tax_late_n.urgency === 'Medium' && /20 days later than last year/.test(w.tax_late_n.flag), J(w));
  sh.rows[2][6] = 'received'; flags.calls = []; c.checkTaxLate_();
  check('…once it arrives the flag isn’t wanted (so it closes)', J(Object.keys(flags.calls[0][2])) === J([]));
  check('it runs nightly, right after the tax documents check', NR__.indexOf("S('checkTaxDocuments_', ") !== -1 && NR__.indexOf("S('checkTaxLate_', ") > NR__.indexOf("S('checkTaxDocuments_', ") && NR__.indexOf("S('checkTaxLate_', ") - NR__.indexOf("S('checkTaxDocuments_', ") < 120);
}
{
  const sh = sheetOf([HDR.concat(['Received On']), ['o', 2024, 'W-2', 'Verdant', '', '', 'uploaded', '', 'Ahmed', '', '2025-01-24'], ['n', 2025, 'W-2', 'Verdant', '', '', 'not_received', '', 'Ahmed', '', '']]);
  const got = ctx(sh).webGetTaxDocuments_({ parameter: { year: '2025' } }).documents;
  check('the read: one year, with usual and expected from the year before', got.length === 1 && got[0].usual === 'late Jan' && got[0].expected.slice(5) === '01-24', J(got));
}

console.log('\nsend to the preparer');
const V = [{ status: 'verified' }, { status: 'uploaded' }];
check('all verified, some not uploaded: the row names the preparer', C.txNeeds_(V, { type: 'Accountant', name: 'K. Ortiz' }).title === 'Send the documents to K. Ortiz' && /1 not uploaded/.test(C.txNeeds_(V, null).sub));
check('…software: its name', C.txNeeds_(V, { type: 'Software', software: 'TaxApp' }).title === 'Send the documents to TaxApp');
check('…not while one is still only received, nor when all are uploaded, nor after filing', C.txNeeds_([{ status: 'verified' }, { status: 'received' }], null) === null && C.txNeeds_([{ status: 'uploaded' }], null) === null && C.txNeeds_(V, { filingStatus: 'Filed' }) === null && C.txNeeds_([], null) === null);
check('the full Home asks for it and opens Tax', /\['tax','tax_needs'\]/.test(APP) && /go:\['finances','tax'\]/.test(APP));

console.log('\nthe screen’s numbers');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext("var TX_STEPS_=[['not_received','Not received'],['received','Received'],['verified','Verified'],['uploaded','Uploaded']];var TX_OWNERS_=['Ahmed','Victoria','Joint'];\n" + ['txDue_', 'txIn_', 'txCounts_', 'txOrder_', 'txAllVerified_'].map(n => fnSrc(APP, n)).join('\n'), U);
check('the deadline: Apr 15 the year after', U.txDue_(2025, new Date(2025, 11, 16)).days === 120 && U.txDue_(2025, new Date(2026, 3, 15)).days === 0);
const SD = [{ id: 'a', formType: 'W-2', owner: 'Ahmed', status: 'not_received', expected: '2026-01-24' }, { id: 'b', formType: '1098', owner: 'Joint', status: 'verified' }, { id: 'c', formType: '1099-INT', owner: 'Victoria', status: 'not_received', daysLate: 20 },
  { id: 'd', formType: '1099-DIV', owner: 'Ahmed', status: 'received' }, { id: 'e', formType: 'K-1', owner: 'Ahmed', status: 'not_received', expected: '2026-03-01' }];
check('counts: in, total, left per person', J(U.txCounts_(SD)) === J({ total: 5, in: 2, left: { Ahmed: 2, Victoria: 1, Joint: 0 } }));
check('order: late first, then not received by when expected, then by step', J(U.txOrder_(SD).map(d => d.id)) === J(['c', 'a', 'e', 'd', 'b']));

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screen: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of [390, 1280]) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ docs }) => {
      window.__ev = []; window.confirm = () => true; window.__docs = docs;
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'get_tax_documents') return Promise.resolve({ ok: true, documents: JSON.parse(JSON.stringify(window.__docs)) });
        if (p.action === 'get_tax_preparer') return Promise.resolve({ ok: true, preparer: { type: 'Accountant', name: 'K. Ortiz', filingStatus: 'In Progress' } }); return Promise.resolve({ ok: true, total: 0, rows: [] }); };
      document.body.innerHTML = '<div id="tx" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('tx')).render(React.createElement(TaxTab, { apiUrl: 'u', apiToken: 't' }));
    }, { docs: SD.map(d => Object.assign({ issuer: 'Acme', usual: d.expected || d.daysLate ? 'late Jan' : undefined }, d)) });
    await page.waitForTimeout(300);
    const top = await page.$eval('#tx .tx-top', n => n.innerText.replace(/\s+/g, ' '));
    check('the ring and the countdown', (await page.$eval('#tx .tx-ring b', n => n.textContent)) === '2/5' && /2 of 5 documents in/.test(top) && /Filing (due Apr 15 · \d+ days|due today|was due Apr 15)/.test(top), top);
    check('per-person left', J(await page.$$eval('#tx .tx-chip', ns => ns.map(n => n.textContent))) === J(['All', 'Ahmed · 2 left', 'Victoria · 1 left', 'Joint · ✓']));
    check('late first, with the note', J(await page.$$eval('#tx .tx-doc', ns => ns.map(n => n.dataset.doc))) === J(['c', 'a', 'e', 'd', 'b']) && /20 days later than last year/.test(await page.$eval('#tx .tx-doc[data-doc="c"]', n => n.innerText)) && /Usually arrives late Jan/.test(await page.$eval('#tx .tx-doc[data-doc="a"]', n => n.innerText)));
    check('the step row marks where it is', J(await page.$$eval('#tx .tx-doc[data-doc="d"] .tx-step', ns => ns.map(n => n.className.replace('tx-step', '').trim()))) === J(['on', 'on cur', '', '']));
    await page.click('#tx .tx-doc[data-doc="a"] .tx-step >> text="Received"'); await page.waitForTimeout(60);
    check('a tap on a step sets it', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'update_tax_document', id: 'a', status: 'received' }) && (await page.$eval('#tx .tx-ring b', n => n.textContent)) === '3/5');
    await page.click('#tx .tx-chip >> text=/^Victoria/'); await page.waitForTimeout(40);
    check('a person', J(await page.$$eval('#tx .tx-doc', ns => ns.map(n => n.dataset.doc))) === J(['c']));
    check('no send line yet', !(await page.$('#tx .tx-send')));
    await page.evaluate(() => { window.__docs = window.__docs.map(d => Object.assign({}, d, { status: d.id === 'b' ? 'uploaded' : 'verified', daysLate: null })); });
    await page.click('#tx .tx-arrow[aria-label="Previous year"]'); await page.waitForTimeout(80); await page.click('#tx .tx-arrow[aria-label="Next year"]'); await page.waitForTimeout(200);
    check('all verified: send them to the preparer', /All 5 are verified\. Send the documents to K\. Ortiz/.test(await page.$eval('#tx .tx-send', n => n.innerText)));
    check('the year arrows reload that year', (await page.evaluate(() => window.__ev)).filter(p => p.action === 'get_tax_documents').map(p => p.year).slice(-2).join() === [new Date().getFullYear() - 2, new Date().getFullYear() - 1].join());
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
