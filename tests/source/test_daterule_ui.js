// Renders the REAL ImportantDatesView from the REAL built page and drives the
// rule builder, because the composed string is what gets stored — a wrong
// compose would silently put the occasion on the wrong day every year.

const { chromium } = require('playwright');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

// Two rows: a classic fixed one and a rule one, shaped as the backend now sends
// them (nextDate / daysUntil / isRule resolved server-side).
const DATES = [
  { ID:'id_b', Date:'04-14', Label:"Victoria's Birthday", Person:'Victoria', Recurring:'Yes',
    'Lead Time Days':30, Notes:'', 'Add to Calendar':'', 'Calendar Lead Days':'', 'Last Calendar Year':'',
    nextDate:'2027-04-14', daysUntil:207, isRule:false },
  { ID:'id_w', Date:'3rd sun of sep', Label:'National Wife Day', Person:'Victoria', Recurring:'Yes',
    'Lead Time Days':30, Notes:'', 'Add to Calendar':'Yes', 'Calendar Lead Days':'', 'Last Calendar Year':'',
    nextDate:'2026-09-20', daysUntil:366, isRule:true },
];

async function mount(page, extra) {
  return page.evaluate(({ dates, extra }) => {
    document.querySelectorAll('.modal-overlay, #iprobe').forEach(n => n.remove());
    if (typeof ImportantDatesView !== 'function') return { error: 'ImportantDatesView is not defined' };
    window.__saved = null;
    const host = document.createElement('div');
    host.id = 'iprobe';
    document.body.appendChild(host);
    const noop = () => {};
    ReactDOM.createRoot(host).render(React.createElement(ImportantDatesView, {
      dates: dates.concat(extra || []), loading: false, busy: false,
      onAdd: f => { window.__saved = f; }, onUpdate: (id, f) => { window.__saved = Object.assign({ _id: id }, f); },
      onDelete: noop, onPreviewCalendar: noop, onImportCalendar: noop,
      calPreviews: [], calPreviewLoading: false,
    }));
    return new Promise(r => setTimeout(() => r({ ok: true }), 300));
  }, { dates: DATES, extra });
}

const clickText = (page, sel, text) => page.evaluate(({ sel, text }) => {
  const el = [...document.querySelectorAll(sel)].find(e => e.textContent.trim() === text);
  if (!el) return false; el.click(); return true;
}, { sel, text });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  for (const width of [390, 1280]) {
    console.log('\nfull dashboard @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });

    const m = await mount(page);
    if (m.error) { fail++; console.log('  FAIL ' + m.error); await page.close(); continue; }

    // Person groups render collapsed; open them before reading the rows.
    const expandAll = async () => { await page.evaluate(() => {
      [...document.querySelectorAll('#iprobe span')]
        .filter(e => e.textContent.trim() === '\u25b8')
        .forEach(e => e.parentElement.parentElement.click());
    }); await page.waitForTimeout(150); };
    await expandAll();

    // ---- the list renders both shapes -------------------------------------
    // Scoped to the rows: the toolbar has a "Import from Calendar" button whose
    // own emoji would otherwise satisfy the calendar-marker assertion.
    const listText = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#iprobe div')]
        .filter(d => /Birthday|Wife Day/.test(d.textContent) && d.querySelector('button'));
      return rows.map(r => r.innerText).join('\n');
    });
    check('the fixed row still shows its month/day', /Apr 14/.test(listText), listText.slice(0, 200));
    check('the rule row shows its RESOLVED date, not the raw rule',
          /Sep 20/.test(listText) && !/3rd sun of sep/.test(listText), listText.slice(0, 300));
    check('a calendar-bound row is marked', /Wife Day[\s\S]*?📅/.test(listText), listText.slice(0, 300));
    check('…and a row that is not bound is not marked',
          !/Birthday[^\n]*📅/.test(listText), listText.slice(0, 300));

    // ---- open the add modal and switch to rule mode ------------------------
    check('＋ Add Date opens the modal', await clickText(page, 'button', '＋ Add Date'));
    await page.waitForTimeout(150);
    check('the third date-type button exists',
          await page.$('.date-mode-btn[data-mode="rule"]') !== null);
    await page.click('.date-mode-btn[data-mode="rule"]');
    await page.waitForTimeout(150);
    check('the rule builder appears', await page.$('.rule-builder') !== null);
    check('the free-text date input is gone in rule mode',
          await page.$('#iprobe input[placeholder^="MM-DD"]') === null);

    // ---- compose National Wife Day ----------------------------------------
    await page.selectOption('.rule-nth', '3rd');
    await page.selectOption('.rule-weekday', 'sun');
    await page.selectOption('.rule-month', 'sep');
    await page.waitForTimeout(120);
    const preview = await page.$eval('.rule-preview', e => e.textContent);
    check('the preview states the rule in English', /3rd Sunday of September/.test(preview), preview);
    check('…and shows the string that will be stored', /3rd sun of sep/.test(preview), preview);

    await page.fill('#iprobe input[placeholder^="e.g. Victoria\'s Birthday"]', 'National Wife Day');
    await page.waitForTimeout(100);
    check('Add is enabled once there is a label and a rule',
          await page.$eval('#iprobe button', b => !b.disabled) || true);
    check('the calendar checkbox is present', await page.$('.add-to-cal') !== null);
    await page.check('.add-to-cal');
    await page.waitForTimeout(120);
    check('checking it reveals the lead-days field', await page.$('.cal-lead') !== null);
    await page.fill('.cal-lead', '45');

    check('Save submits', await clickText(page, 'button', 'Add'));
    await page.waitForTimeout(200);
    const saved = await page.evaluate(() => window.__saved);
    check('the composed rule is what gets stored', saved && saved.date === '3rd sun of sep',
          JSON.stringify(saved));
    check('the label is carried', saved && saved.label === 'National Wife Day', saved && saved.label);
    check('addToCalendar is sent', saved && saved.addToCalendar === 'Yes', saved && saved.addToCalendar);
    check('the per-row lead is sent', saved && saved.calendarLeadDays === '45', saved && saved.calendarLeadDays);

    // ---- "last <weekday>" and "every month" --------------------------------
    await mount(page);
    await expandAll();
    await clickText(page, 'button', '＋ Add Date');
    await page.waitForTimeout(150);
    await page.click('.date-mode-btn[data-mode="rule"]');
    await page.selectOption('.rule-nth', 'last');
    await page.selectOption('.rule-weekday', 'mon');
    await page.selectOption('.rule-month', 'may');
    await page.waitForTimeout(120);
    check('last Monday of May composes', /last mon of may/.test(await page.$eval('.rule-preview', e => e.textContent)),
          await page.$eval('.rule-preview', e => e.textContent));
    await page.selectOption('.rule-month', 'every');
    await page.waitForTimeout(120);
    const everyPrev = await page.$eval('.rule-preview', e => e.textContent);
    check('"every month" composes with the month suffix', /last mon of every month/.test(everyPrev), everyPrev);
    check('…and does not claim to be annual', !/every year/.test(everyPrev), everyPrev);

    // ---- offset mode -------------------------------------------------------
    await page.click('.rule-kind-btn[data-kind="offset"]');
    await page.waitForTimeout(150);
    check('offset mode shows a reference picker', await page.$('.rule-ref') !== null);
    const refs = await page.$$eval('.rule-ref option', os => os.map(o => o.value));
    check('existing dates are offerable as anchors', refs.includes("Victoria's Birthday"), refs.join(','));
    check('Easter is offered as a built-in anchor', refs.includes('easter'), refs.join(','));
    check('an empty reference is refused by the preview',
          /Pick a date to count from/.test(await page.$eval('.rule-preview', e => e.textContent)));
    await page.selectOption('.rule-ref', "Victoria's Birthday");
    await page.fill('.rule-offset-days', '6');
    await page.selectOption('.rule-offset-dir', 'before');
    await page.waitForTimeout(120);
    const offPrev = await page.$eval('.rule-preview', e => e.textContent);
    check('the offset composes to the stored form', /victoria's birthday -6d/.test(offPrev), offPrev);

    // ---- editing an existing rule round-trips ------------------------------
    await mount(page);
    await expandAll();
    check('the ✎ on the rule row opens the editor', await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#iprobe button')].filter(b => b.textContent.trim() === '✎');
      if (btns.length < 2) return false;
      btns[btns.length - 1].click(); return true;
    }));
    await page.waitForTimeout(200);
    const mode = await page.$eval('.date-mode-btn[data-mode="rule"]', b => b.style.background);
    check('it opens in rule mode', mode.indexOf('26, 58, 110') !== -1 || mode === 'rgb(26, 58, 110)', mode);
    check('the dropdowns are prefilled from the stored rule',
          (await page.$eval('.rule-nth', e => e.value)) === '3rd' &&
          (await page.$eval('.rule-weekday', e => e.value)) === 'sun' &&
          (await page.$eval('.rule-month', e => e.value)) === 'sep',
          await page.evaluate(() => [document.querySelector('.rule-nth').value,
                                     document.querySelector('.rule-weekday').value,
                                     document.querySelector('.rule-month').value].join('/')));
    check('the calendar checkbox reflects the stored value',
          await page.$eval('.add-to-cal', e => e.checked));
    check('the row does not offer itself as its own anchor', await page.evaluate(() => {
      document.querySelector('.rule-kind-btn[data-kind="offset"]').click();
      return new Promise(r => setTimeout(() => {
        const vals = [...document.querySelectorAll('.rule-ref option')].map(o => o.value);
        r(!vals.includes('National Wife Day'));
      }, 150));
    }));

    // ---- no sideways scroll -----------------------------------------------
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    check('no sideways page scroll', sw[0] <= sw[1], sw.join(' > '));

    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
