// The trip briefing in the dashboards.
//
// The interactive part — render, edit, save — runs in the REAL page in
// Chromium. The rest are source assertions, and are labelled as such: mounting
// the whole App to prove a prop is threaded would cost far more than it is
// worth, but the thing those assertions guard is real and has already bitten
// four times in this file's history.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const BRIEF = "Visiting Sarah and Tom for the new baby — quiet, low-key, we want to be useful.";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  // VERA_ONLY=source skips the browser half. The negative control needs it:
  // against the pre-change pages the component does not exist at all, so the
  // browser half crashes on the first mount and hides the source assertions —
  // which are the ones guarding the bug that has bitten four times.
  const ONLY = process.env.VERA_ONLY || '';
  for (const width of (ONLY === 'source' ? [] : [390, 1280])) {
    console.log('\nfull dashboard @ ' + width + 'px');
    const page = await browser.newPage({ viewport:{ width, height:1000 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil:'domcontentloaded' });

    const mount = (briefing) => page.evaluate((briefing) => {
      document.querySelectorAll('.modal-overlay, #bprobe').forEach(n => n.remove());
      const host = document.createElement('div'); host.id = 'bprobe';
      document.body.appendChild(host);
      window.__saved = [];
      ReactDOM.createRoot(host).render(React.createElement(TripBriefingBlock, {
        briefing, busy: false,
        onSetBriefing: b => window.__saved.push(b),
      }));
      return new Promise(r => setTimeout(r, 250));
    }, briefing);

    const read = () => page.evaluate(() => {
      const host = document.getElementById('bprobe');
      const el = host.querySelector('[data-trip-briefing]');
      return {
        text:     el ? el.textContent.trim() : null,
        italic:   el ? getComputedStyle(el).fontStyle : null,
        editors:  host.querySelectorAll('[data-briefing-input]').length,
        saved:    window.__saved,
      };
    });

    // ---- set ---------------------------------------------------------
    await mount(BRIEF);
    let s = await read();
    check('a briefing renders as written', s.text === BRIEF, s.text);
    check('…in normal type, not the placeholder italic', s.italic === 'normal', s.italic);
    check('…with no editor open', s.editors === 0, s.editors);

    // ---- unset -------------------------------------------------------
    await mount('');
    s = await read();
    check('an empty briefing invites one rather than leaving a gap',
          /What is this trip actually for/.test(s.text || ''), s.text);
    check('…and says what it will be used for',
          /discoveries/.test(s.text || '') && /packing/.test(s.text || ''), s.text);
    check('…shown as a placeholder, in italic', s.italic === 'italic', s.italic);

    // ---- edit and save ----------------------------------------------
    await page.click('#bprobe [data-edit-briefing]');
    await page.waitForTimeout(200);
    check('the edit control opens a textarea',
          (await page.evaluate(() => document.querySelectorAll('#bprobe [data-briefing-input]').length)) === 1);

    await page.fill('#bprobe [data-briefing-input]', BRIEF);
    check('nothing is saved while still typing',
          (await page.evaluate(() => window.__saved.length)) === 0);

    await page.click('#bprobe [data-save-briefing]');
    await page.waitForTimeout(200);
    s = await read();
    check('saving reports the text once', s.saved.length === 1, JSON.stringify(s.saved));
    check('…verbatim, em dash and all', s.saved[0] === BRIEF, s.saved[0]);
    check('…and the editor closes', s.editors === 0, s.editors);

    // Cancel must not save.
    await mount(BRIEF);
    await page.click('#bprobe [data-edit-briefing]');
    await page.waitForTimeout(150);
    await page.fill('#bprobe [data-briefing-input]', 'discarded');
    await page.click('#bprobe button.btn:not(.btn-primary)');
    await page.waitForTimeout(200);
    s = await read();
    check('cancel saves nothing', s.saved.length === 0, JSON.stringify(s.saved));
    check('…and leaves the original text', s.text === BRIEF, s.text);

    await page.close();
  }

  await browser.close();

  // ======================= source assertions ==========================
  // Not browser-driven. What they guard is the bug that has now appeared four
  // separate times: a caller passing '' for notes, which CLEARS the briefing.
  // The server guard cannot catch it — '' is a real value meaning "clear" —
  // so the only defence is that no call site sends one.
  console.log('\nno call site clears the briefing as a side effect');
  {
    const app = fs.readFileSync(path.resolve(ROOT, 'docs/app.js'), 'utf8');
    const sites = (app.match(/onSetTripMeta\(tripKey,[^;]{0,80}?\)/g) || []);
    check('the call sites were found', sites.length >= 3, sites.length + ' found');
    const clearing = sites.filter(c => /,\s*''\s*,/.test(c) || /,\s*''\s*\)/.test(c.replace(/\|\|\s*''/g, '')));
    check("none of them passes a bare '' for notes", clearing.length === 0,
          clearing.join('  ||  '));
    sites.forEach(c => {
      check('  ' + c.slice(0, 52) + ' ... preserves notes',
            /cur\.notes\s*\|\|\s*''|meta\.notes\s*\|\|\s*''/.test(c), c);
    });
  }

  console.log('\nthe briefing is threaded and saved through the targeted writer');
  {
    const app = fs.readFileSync(path.resolve(ROOT, 'docs/app.js'), 'utf8');
    check('the App handler exists', /async function handleSetTripBriefing\(/.test(app));
    check('…and calls set_trip_briefing, not set_trip_meta',
          /action:'set_trip_briefing'/.test(app));
    check('…so a briefing save cannot disturb the label or traveller',
          !/handleSetTripBriefing[\s\S]{0,400}set_trip_meta/.test(app));
    check('TravelTab threads the prop',   /function TravelTab\([^)]*onSetTripBriefing/.test(app));
    check('the itinerary panel threads it', /function TravelItineraryPanel\([^)]*onSetTripBriefing/.test(app));
    check('ItineraryView receives it',    /function ItineraryView\([^)]*onSetBriefing/.test(app));
    check('and the block is rendered',    /React\.createElement\(TripBriefingBlock,/.test(app));
  }

  console.log('\ndashboard-lite shows it, read-only');
  {
    const lite = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');
    check('the briefing is rendered', /data-trip-briefing/.test(lite));
    check('…gated on there being one', /\{meta\?\.notes && \(/.test(lite));
    check('…and no editor is offered',
          !/data-briefing-input|data-edit-briefing|data-save-briefing/.test(lite));
    // Its one trip-meta writer must preserve the briefing too.
    check('its traveler save preserves notes', /notes:meta\.notes\|\|''/.test(lite));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
