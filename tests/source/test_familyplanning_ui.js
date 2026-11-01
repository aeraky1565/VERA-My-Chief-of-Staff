// Family Planning, in both dashboards: the panel is mounted for real and clicked
// through. The page's data is what FamilyPlanning.js itself returns (run here in
// a vm over fake sheets), so the panel is tested against the server's real shape.
// Invented employers, policies and dates throughout.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;
const SRC = process.env.VERA_ROOT || REPO;
const APP = fs.readFileSync(path.resolve(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const block = s => { const a = s.indexOf('// ---- FamilyPlanningPanel'), b = s.indexOf('// ---- end FamilyPlanningPanel ----'); return a === -1 || b === -1 ? null : s.slice(a, b); };
console.log('\nthe shared block');
check('both dashboards carry the block', !!block(APP) && !!block(LITE));
check('…and the two copies match', block(APP) === block(LITE));
check('Health has the subtab, as Ahmed', /\{id:'family_planning',label:'👶 Family Planning'/.test(APP) && /sub==='family_planning'&&React\.createElement\(FamilyPlanningPanel,\{apiUrl:apiUrl,apiToken:apiToken,who:'Ahmed'\}\)/.test(APP));
check('lite has its own top tab, as Victoria', /\{ id: 'family',        label: '👶 Family Planning' \}/.test(LITE) && /<FamilyPlanningPanel apiUrl=\{apiUrl\} apiToken=\{apiToken\} who="Victoria" \/>/.test(LITE));

// ---- the page's data, from the server's own code ----
function serverData() {
  const CODE = fs.readFileSync(path.join(SRC, 'Code.js'), 'utf8');
  const hdr = n => eval(CODE.match(new RegExp('const ' + n + ' *= (\\[[^\\]]*\\]);'))[1]);
  const sheet = h => { const rows = [h.slice()]; return { rows, getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => { const o = x.slice(c - 1, c - 1 + nc); while (o.length < nc) o.push(''); return o; }),
      setValues: v => v.forEach((x, i) => { rows[r - 1 + i] = x.slice(); }) }), appendRow: v => rows.push(v.slice()), deleteRow: r => rows.splice(r - 1, 1) }; };
  let u = 0;
  const S = vm.createContext({ console, JSON, Math, Number, String, Array, Date, isFinite, Object,
    TABS: { FAMILY_PLANNING: 'FP', FP_LEAVE_BLOCKS: 'FPB', FP_POLICY: 'FPP', FP_ITEMS: 'FPI' },
    FP_SETTING_HEADERS: hdr('FP_SETTING_HEADERS'), FP_BLOCK_HEADERS: hdr('FP_BLOCK_HEADERS'), FP_POLICY_HEADERS: hdr('FP_POLICY_HEADERS'), FP_ITEM_HEADERS: hdr('FP_ITEM_HEADERS'),
    Utilities: { getUuid: () => String(++u).padEnd(12, 'd') + '-0', formatDate: () => '2026-11-01' }, Session: { getScriptTimeZone: () => 'UTC' }, Logger: { log: () => {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    getFinancialGoals_: () => [{ id: 'G-BABY', name: 'Baby fund', currentAmount: 4000, targetAmount: 15000 }],
    tiPtoPerson_: n => ({ found: true, remaining: { 2026: n === 'Ahmed' ? 15 : 20 } }), readPTOConfig_: () => ({}), readVictoriaPTOConfig_: () => ({}) });
  S.sheets = { FP: sheet(S.FP_SETTING_HEADERS), FPB: sheet(S.FP_BLOCK_HEADERS), FPP: sheet(S.FP_POLICY_HEADERS), FPI: sheet(S.FP_ITEM_HEADERS) };
  S.getSpreadsheet = () => ({ getSheetByName: n => S.sheets[n] }); S.ensureSheet = (ss, n) => S.sheets[n];
  vm.runInContext(fs.readFileSync(path.join(SRC, 'FamilyPlanning.js'), 'utf8'), S);
  const run = c => vm.runInContext(c, S);
  run('webFpGet_({ by: "Ahmed" })');
  run('webFpSetupSave_({ by: "Victoria", settings: { phase: "pregnant", dueDate: "2027-06-01", birthParent: "Victoria", employer_Ahmed: "Acme Corp", policyDoc_Ahmed: "Acme leave policy", fundGoalId: "G-BABY", oopMax: 4000, split: "stagger" } })');
  run('webFpPolicySave_({ by: "Ahmed", parent: "Ahmed", values: { parentalWeeks: 8, parentalPay: 100, minBlockWeeks: 2, useWithinMonths: 12, claimDay: 8, claimsAdmin: "Claims Co", ptoAfterParental: "yes" } })');
  run('webFpPolicySave_({ by: "Victoria", parent: "Victoria", values: { stdWeeks: 6, stdPay: 60, parentalWeeks: 10, parentalPay: 100 } })');
  [['Victoria', 'std', 1, 6], ['Victoria', 'parental', 7, 10], ['Ahmed', 'parental', 1, 2], ['Ahmed', 'parental', 17, 6]].forEach(b =>
    run('webFpBlockSave_({ by: "Ahmed", block: ' + JSON.stringify({ parent: b[0], kind: b[1], startWeek: b[2], weeks: b[3] }) + ' })'));
  run('webFpItemSave_({ by: "Ahmed", item: { area: "childcare", title: "Daycare one", cost: 1900, anchor: "week:12" } })');
  return run('webFpGet_({ by: "Ahmed" })');
}
const DATA = serverData();
const EMPTY = { ok: true, today: '2026-11-01', settings: { phase: 'plan' }, weekToday: null, birth: '', blocks: [], lanes: [{ parent: 'Ahmed', blocks: [], summary: 'No leave planned yet.' }, { parent: 'Victoria', blocks: [], summary: 'No leave planned yet.' }],
  payTable: [], homeUntil: 0, careFrom: null, careFromDate: '', checks: { Ahmed: [], Victoria: [] }, policy: { Ahmed: {}, Victoria: {} }, policyFields: DATA.policyFields, items: [],
  next: [{ when: 'Open enrollment', what: 'Check both health plans’ maternity coverage and out-of-pocket maximum; consider a Dependent Care FSA.' }], money: {}, goals: [], areas: {} };

async function mount(page, who, data) {
  return page.evaluate(({ who, data }) => {
    document.querySelectorAll('.modal-overlay, #fpprobe').forEach(n => n.remove());
    if (typeof FamilyPlanningPanel !== 'function') return { error: 'FamilyPlanningPanel is not defined' };
    window.__get = []; window.__post = [];
    window.apiGet = (u, t, p) => { window.__get.push(p); return Promise.resolve(JSON.parse(JSON.stringify(data))); };
    window.apiPost = (u, t, b) => { window.__post.push(b); return Promise.resolve(b.action === 'fp_policy_reread' ? { ok: true, read: {}, document: 'Acme leave policy', conflicts: [{ field: 'parentalWeeks', typed: 8, read: 10 }] } : { ok: true }); };
    window.scrollTo = () => {}; window.confirm = () => true;
    const host = document.createElement('div'); host.id = 'fpprobe'; document.body.prepend(host);
    ReactDOM.createRoot(host).render(React.createElement(FamilyPlanningPanel, { apiUrl: 'https://vera.test/exec', apiToken: 't', who }));
    return new Promise(res => setTimeout(() => res({ ok: true }), 300));
  }, { who, data });
}
const q = (page, s) => page.evaluate(s => { const n = document.querySelector('#fpprobe ' + s); return n ? n.textContent : null; }, s);
const qa = (page, s) => page.evaluate(s => Array.from(document.querySelectorAll('#fpprobe ' + s)).map(n => n.textContent), s);
const click = async (page, s, i) => { await page.evaluate(({ s, i }) => document.querySelectorAll('#fpprobe ' + s)[i || 0].click(), { s, i }); await page.waitForTimeout(140); };
const last = page => page.evaluate(() => window.__post[window.__post.length - 1]);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8') };
  for (const [label, kind, who] of [['full dashboard', 'full', 'Ahmed'], ['dashboard-lite', 'lite', 'Victoria']]) {
    for (const width of [390, 1280]) {
      console.log('\n' + label + ' @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      if (kind === 'lite') {
        await page.route('**/*', r => { const u = r.request().url();
          for (const n of Object.keys(vendor)) if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
          if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: LITE });
          return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' }); });
        await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      const m = await mount(page, who, DATA);
      if (m.error) { fail++; console.log('  FAIL ' + m.error); await page.close(); continue; }

      // ---- overview ----
      check('it reads the plan as this person', (await page.evaluate(() => window.__get)).some(g => JSON.stringify(g) === JSON.stringify({ action: 'fp_get', by: who })));
      check('the week and due date', /Week 9 today · due Jun 1, 2027/.test(await q(page, '.fp-week')), await q(page, '.fp-week'));
      const next = await q(page, '.fp-next');
      check('next 3 things: the soonest dated items', /Join daycare waitlists/.test(next) && /Daycare one/.test(next) && (next.match(/Nov|Dec|Jan|Feb/g) || []).length >= 1, next);
      const areas = await page.evaluate(() => Array.from(document.querySelectorAll('#fpprobe .fp-area')).map(n => n.dataset.area + ':' + n.querySelector('.fp-status').textContent));
      check('seven areas, each with its state', areas.length === 7 && areas.indexOf('leave:Ready') !== -1 && areas.indexOf('money:Started') !== -1 && areas.indexOf('gear:Not yet') !== -1, areas.join(' '));
      check('the last edit names who', /Last edit: Ahmed · Childcare/.test(await q(page, '.fp-lastedit')), await q(page, '.fp-lastedit'));
      check('the shared note names the other person', new RegExp('You and ' + (who === 'Ahmed' ? 'Victoria' : 'Ahmed') + ' can both see and edit').test(await q(page, '')));
      await click(page, '.fp-phase', 3);
      check('a phase chip saves the phase, as this person', JSON.stringify(await last(page)) === JSON.stringify({ by: who, action: 'fp_setup_save', settings: { phase: 'leave' } }));

      // ---- leave plan ----
      await mount(page, who, DATA); await click(page, '.fp-area[data-area="leave"]');
      const lanes = await page.evaluate(() => Array.from(document.querySelectorAll('#fpprobe .fp-lane')).map(l => l.dataset.parent + ':' + Array.from(l.querySelectorAll('.fp-seg')).map(s => s.dataset.kind).join(',')));
      check('a lane per parent, a segment per block', lanes.join(' ') === 'Ahmed:parental,parental Victoria:std,parental', lanes.join(' '));
      check('who is home, and when childcare starts', /Childcare needed from week 23 · about Nov 2, 2027/.test(await q(page, '.fp-carenote')), await q(page, '.fp-carenote'));
      const pay = await qa(page, '.fp-pay tbody tr');
      check('the pay table', pay.length === 2 && pay[0] === '1–6100%60%' && pay[1] === '7–22100%100%', pay.join(' | '));
      const checks = await page.evaluate(() => Array.from(document.querySelectorAll('#fpprobe .fp-check')).map(n => n.dataset.mark + ' ' + n.textContent));
      check('the checks, marked', checks.some(c => /^ok ✓All 8 parental weeks planned/.test(c)) && checks.some(c => /^info iOpen the claim with Claims Co by day 8/.test(c)), checks.join(' | '));
      const pol = await page.evaluate(() => Array.from(document.querySelectorAll('#fpprobe .fp-policy[data-parent="Ahmed"] .fp-pol-in')).map(n => n.dataset.field + '=' + n.value));
      check('the policy is editable, field by field', pol.indexOf('parentalWeeks=8') !== -1 && pol.indexOf('claimsAdmin=Claims Co') !== -1 && pol.indexOf('ptoAfterParental=yes') !== -1, pol.join(' '));
      await page.fill('#fpprobe .fp-policy[data-parent="Ahmed"] .fp-pol-in[data-field="parentalWeeks"]', '9');
      await click(page, '.fp-policy[data-parent="Ahmed"] .fp-pol-save');
      check('saving sends only what changed, as typed', JSON.stringify(await last(page)) === JSON.stringify({ by: who, action: 'fp_policy_save', parent: 'Ahmed', values: { parentalWeeks: '9' } }));
      await page.waitForTimeout(150);
      await click(page, '.fp-policy[data-parent="Ahmed"] .fp-reread');
      await page.waitForTimeout(150);
      check('Re-read asks the server to read the document', (await last(page)).action === 'fp_policy_reread' && (await last(page)).parent === 'Ahmed');
      const cf = await q(page, '.fp-conflicts');
      check('a difference from what was typed is a choice', /“Acme leave policy” says something different/.test(cf) && /you typed 8, the document says 10/.test(cf), cf);
      await click(page, '.fp-use-read');
      check('Use the read value saves it', JSON.stringify(await last(page)) === JSON.stringify({ by: who, action: 'fp_policy_save', parent: 'Ahmed', values: { parentalWeeks: 10 } }));
      await page.waitForTimeout(150);
      check('…and the choice goes away', (await q(page, '.fp-conflicts')) === null);
      await click(page, '.fp-split', 1);
      check('the split is a setting', JSON.stringify(await last(page)) === JSON.stringify({ by: who, action: 'fp_setup_save', settings: { split: 'together' } }));

      // ---- a block ----
      await mount(page, who, DATA); await click(page, '.fp-area[data-area="leave"]'); await click(page, '.fp-lane[data-parent="Ahmed"] .fp-seg', 1);
      const be = await q(page, '.fp-be-result');
      check('editing a block shows the result against the policy', /Back at work/.test(be) && /Week 23/.test(be) && /Parental weeks used8 of 8/.test(be), be);
      await click(page, '.fp-be-more');
      check('…and updates as you change it', /9 of 8/.test(await q(page, '.fp-be-result')));
      await click(page, '.fp-be-save');
      const sb = await last(page);
      check('Save sends the block', sb.action === 'fp_block_save' && sb.block.parent === 'Ahmed' && sb.block.kind === 'parental' && sb.block.startWeek === 17 && sb.block.weeks === 7 && !!sb.block.id, JSON.stringify(sb));
      await mount(page, who, DATA); await click(page, '.fp-area[data-area="leave"]'); await click(page, '.fp-add-block');
      check('a new block starts as this person’s parental leave', await page.evaluate(w => document.querySelector('#fpprobe .fp-be-parent[aria-pressed="true"]').textContent === w &&
            document.querySelector('#fpprobe .fp-be-kind[aria-pressed="true"]').dataset.kind === 'parental', who));
      await mount(page, who, EMPTY); await click(page, '.fp-area[data-area="leave"]'); await click(page, '.fp-suggest');
      check('filling blocks needs the policies first', /Enter the leave weeks in both policies first/.test(await q(page, '.fp-err')));
      const sug = await page.evaluate(() => ({ s: fpSuggestBlocks({ Victoria: { stdWeeks: { value: 6 }, parentalWeeks: { value: 10 } }, Ahmed: { parentalWeeks: { value: 8 }, minBlockWeeks: { value: 2 } } }, { birthParent: 'Victoria' }, 'stagger'),
        t: fpSuggestBlocks({ Victoria: { stdWeeks: { value: 6 }, parentalWeeks: { value: 10 } }, Ahmed: { parentalWeeks: { value: 8 } } }, { birthParent: 'Victoria' }, 'together') }));
      check('staggered: the smallest block at the birth, the rest when the birth parent goes back', JSON.stringify(sug.s) === JSON.stringify([{ parent: 'Victoria', kind: 'std', startWeek: 1, weeks: 6 },
        { parent: 'Victoria', kind: 'parental', startWeek: 7, weeks: 10 }, { parent: 'Ahmed', kind: 'parental', startWeek: 1, weeks: 2 }, { parent: 'Ahmed', kind: 'parental', startWeek: 17, weeks: 6 }]), JSON.stringify(sug.s));
      check('together: all of it at the birth', JSON.stringify(sug.t.slice(-1)) === JSON.stringify([{ parent: 'Ahmed', kind: 'parental', startWeek: 1, weeks: 8 }]));

      // ---- care ----
      await mount(page, who, DATA); await click(page, '.fp-area[data-area="childcare"]');
      const secs = await page.evaluate(() => Array.from(document.querySelectorAll('#fpprobe .fp-section')).map(s => s.dataset.area));
      check('care has every area', secs.join() === 'childcare,pregnancy,money,gear,paperwork,support', secs.join());
      const money = await q(page, '.fp-money');
      check('money: the out-of-pocket max, the fund and the weeks below full pay', /up to \$4,000/.test(money) && /\$4,000 of \$15,000/.test(money) && /Weeks below full pay6/.test(money) && /from \$1,900/.test(money), money);
      const daycare = (await qa(page, '.fp-section[data-area="childcare"] .fp-item')).filter(t => /Daycare one/.test(t))[0] || '';
      check('a childcare option shows its join-by date and monthly cost', /by week 12 · Nov 17, 2026/.test(daycare) && /\$1,900 a month/.test(daycare), daycare);
      await click(page, '.fp-section[data-area="childcare"] .fp-item-status');
      check('the status steps on', (await last(page)).action === 'fp_item_save' && (await last(page)).item.status === 'started');
      await click(page, '.fp-section[data-area="gear"] .fp-to-pp');
      check('gear: Plan this purchase', JSON.stringify(await last(page)) === JSON.stringify({ by: who, action: 'fp_gear_to_pp', id: DATA.items.filter(i => i.area === 'gear').sort((a, b) => a.date < b.date ? -1 : 1)[0].id }));
      await click(page, '.fp-add-item[data-area="support"]');
      await page.fill('#fpprobe .fp-it-title', 'Grandparents stay, weeks 1–2');
      await page.selectOption('#fpprobe .fp-it-when', 'birth'); await page.fill('#fpprobe .fp-it-n', '0');
      await click(page, '.fp-it-save');
      const it = (await last(page)).item;
      check('adding an item sends its anchor', it.area === 'support' && it.title === 'Grandparents stay, weeks 1–2' && it.anchor === 'birth+0' && it.owner === 'Both', JSON.stringify(it));

      // ---- setup ----
      await mount(page, who, DATA); await click(page, '.fp-setup-btn');
      check('setup shows the due date', await page.evaluate(() => document.querySelector('#fpprobe .fp-in-dueDate').value) === '2027-06-01');
      await click(page, '.fp-notyet'); await page.fill('#fpprobe .fp-in-whatIf', '2028-03-01');
      await click(page, '.fp-setup-save');
      const su = (await last(page)).settings;
      check('"not yet" clears the due date and keeps a what-if date', su.dueDate === '' && su.whatIf === '2028-03-01' && su.employer_Ahmed === 'Acme Corp' && !('dated' in su), JSON.stringify(su));
      await page.waitForTimeout(150);
      await mount(page, who, DATA); await click(page, '.fp-setup-btn');
      const rem = await qa(page, '.fp-remind');
      check('reminders list each dated item', rem.length >= 10 && rem.some(r => /Join daycare waitlists · by week 12/.test(r)), rem.length);
      await click(page, '.fp-remind .fp-owner', 2);
      check('a name sends that reminder to one person', (await last(page)).action === 'fp_item_save' && (await last(page)).item.owner === 'Victoria');

      if (width === 390) { await mount(page, who, DATA); await click(page, '.fp-area[data-area="leave"]');
        check('no sideways page scroll at phone width', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => document.documentElement.scrollWidth)); }
      check('no page errors', errors.length === 0, errors.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
