// The "Your assistants" roster on Home, in both dashboards: the backend's
// rosterLinks_, its place in the status payload, and the shared roster block that
// the full dashboard and dashboard-lite must carry word for word.
//
// The rendering itself is driven in test_roster_ui.js. Invented sheet ids only.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const WEB = read('WebApp.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error('unterminated: ' + name);
}

// ============ rosterLinks_ ======================================================
console.log('rosterLinks_');
{
  const S = vm.createContext({});
  vm.runInContext(WEB.match(/var ROSTER_NAMES_ = [^\n]*/)[0] + '\n' + extractFn(WEB, 'rosterLinks_'), S);
  const links = cfg => { S.cfg = cfg; return vm.runInContext('rosterLinks_(cfg)', S); };
  const PLAN = 'InventedPlannerId_0123456789-abcdefgh', AGENT = 'InventedAgentSheet_9876543210-zyxwvut';
  const sheet = id => 'https://docs.google.com/spreadsheets/d/' + id + '/edit';

  const all = links({
    roster_link_pies: 'https://pies.example.test/home', roster_link_vera: 'https://dash.example.test/',
    roster_link_willa: sheet(PLAN), roster_link_tess: '  ' + AGENT + '  ',
    roster_link_hailey: 'http://hailey.example.test', roster_link_aria: 'https://aria.example.test/trip?x=1',
  });
  check('every assistant has a link from its own Config row', JSON.stringify(Object.keys(all)) === '["PIES","VERA","WILLA","TESS","HAILEY","ARIA"]'
        && all.PIES === 'https://pies.example.test/home' && all.VERA === 'https://dash.example.test/'
        && all.HAILEY === 'http://hailey.example.test' && all.ARIA === 'https://aria.example.test/trip?x=1', JSON.stringify(all));
  check('a full link is kept as is', all.WILLA === sheet(PLAN), all.WILLA);
  check('a bare sheet id becomes its link, trimmed', all.TESS === sheet(AGENT), all.TESS);
  check('the roster row wins over the fallback', links({ roster_link_willa: 'https://w.example.test/', planner_sheet_id: PLAN }).WILLA === 'https://w.example.test/');

  const fb = links({ planner_sheet_id: PLAN, career_alert_sheet_id: AGENT });
  check('WILLA falls back to planner_sheet_id', fb.WILLA === sheet(PLAN), fb.WILLA);
  check('TESS falls back to career_alert_sheet_id', fb.TESS === sheet(AGENT), fb.TESS);
  check('the others have no fallback', fb.PIES === '' && fb.VERA === '' && fb.HAILEY === '' && fb.ARIA === '');
  check('blank rows give no link', Object.values(links({ roster_link_pies: '', planner_sheet_id: '' })).every(v => v === ''));
  check('no Config at all gives no links', Object.values(links(undefined)).every(v => v === '') && Object.keys(links(undefined)).length === 6);
  check('a non-web link gives no link', links({ roster_link_aria: 'javascript:alert(1)' }).ARIA === '' && links({ roster_link_pies: 'file:///C:/pies' }).PIES === '');
  check('a short junk value gives no link', links({ roster_link_tess: 'TBD' }).TESS === '');
  check('a link with a space or quote gives no link', links({ roster_link_vera: 'https://a.test/x y' }).VERA === '' && links({ roster_link_vera: 'https://a.test/"x' }).VERA === '');
}

// ============ the status payload ===============================================
console.log('\nthe status payload');
{
  const fn = extractFn(WEB, 'webGetStatus_');
  const n = (fn.match(/rosterLinks:\s*rosterLinks_\(/g) || []).length;
  const returns = (fn.match(/\breturn \{/g) || []).length;
  check('every status return carries rosterLinks', n >= 2 && n === returns, n + ' of ' + returns);
}

// ============ the shared roster block ==========================================
console.log('\nthe shared roster block');
const START = '// ---- Your assistants (the roster)', END = '// ---- /Your assistants ----';
// The block up to the next top-level function: enough to search one component's body.
const fnBody = (src, name) => { const a = src.indexOf('function ' + name + '('); return a === -1 ? '' : src.slice(a, src.indexOf('\nfunction ', a + 1)); };
const block = src => {
  const a = src.indexOf(START), b = src.indexOf(END);
  return a === -1 || b === -1 ? null : src.slice(a, b + END.length);
};
const A = block(APP), L = block(LITE);
check('the full dashboard has the roster block', !!A);
check('dashboard-lite has the roster block', !!L);
check('the two copies are identical', A && L && A === L);

let roster = [];
if (A) {
  const S = vm.createContext({ React: { createElement: () => null } });
  vm.runInContext(A + '\nthis.R = VERA_ROSTER;', S);
  roster = S.R;
}
const by = n => roster.find(r => r.name === n) || {};
check('six assistants, in order', JSON.stringify(roster.map(r => r.name)) === '["PIES","VERA","WILLA","TESS","HAILEY","ARIA"]',
      JSON.stringify(roster.map(r => r.name)));
check('each acronym is spelled out', by('PIES').breakdown === 'Personal Intelligence & Execution System'
      && by('VERA').breakdown === 'Virtual Executive & Reminder Assistant'
      && by('WILLA').breakdown === 'Work-optional Income & Lifestyle Longevity Analyzer'
      && by('TESS').breakdown === 'Tailored Employment Search Scout'
      && by('HAILEY').breakdown === 'Home Alerts, Inventory & Listings Evaluator, Yours'
      && by('ARIA').breakdown === 'Airfare Radar & Itinerary Alerts');
check('ARIA is not built yet, and says what it waits on', by('ARIA').state === 'planned' && /trip details/.test(by('ARIA').note));
check('the other five are live, HAILEY included', ['PIES', 'VERA', 'WILLA', 'TESS', 'HAILEY'].every(n => by(n).state === 'live'));
check('PIES says it lives in the work environment and tracks the professional workflow', /work environment/.test(by('PIES').note) && /professional workflow/.test(by('PIES').purpose));
check('every link comes from status, VERA falling back to the page', A && /var href=L\[r\.name\]\|\|\(r\.name==='VERA'\?veraHref:''\);/.test(A));
check('an unlinked name says which Config row to fill', A && /'Add roster_link_'\+r\.name\.toLowerCase\(\)\+' to Config to link it'/.test(A));
check('links open in a new tab without handing over the opener', A && /target:'_blank',rel:'noopener'/.test(A));
check('no sheet id is written in the block', A && !/(?=[A-Za-z0-9_-]*[A-Za-z0-9])[A-Za-z0-9_-]{25,}/.test(A.replace(/-{4,}/g, '')));

// ============ wiring ============================================================
console.log('\nwiring');
check('Home renders the roster with status’s links and this page as VERA',
      /React\.createElement\(VeraRoster,\{links:status&&status\.rosterLinks,veraHref:window\.location\.origin\+window\.location\.pathname\}\)/.test(fnBody(APP, 'HomeTab')));
check('lite’s Overview renders it with VERA pointing at the full dashboard',
      /<VeraRoster links=\{status && status\.rosterLinks\} veraHref="\.\/" \/>/.test(fnBody(LITE, 'OverviewLiteTab')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
