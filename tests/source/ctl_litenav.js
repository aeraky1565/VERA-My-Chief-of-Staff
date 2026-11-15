// Negative controls for lite, simplified (the bottom bar, All, Today's "Needs you" and tiles): revert ONE
// rule at a time and confirm test_litenav_ui.js catches it. Needs a browser; skipped where there is none.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_litenav_out');

const FILES = ['docs/dashboard-lite.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const L = 'docs/dashboard-lite.html', TEST = 'test_litenav_ui.js';
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const lite = (from, to) => b => ({ [L]: swap(b[L], from, to) });

const CONTROLS = [
  ['the bar shows tabs this person can’t see', lite('const items = LITE_BAR.filter(b => liteCanOpen_(b.id, b.sub));', 'const items = LITE_BAR;')],
  ['a hidden tab can still be opened', lite("  if (!veraCan_(tab)) return false;\n", '')],
  ['the bar scrolls away with the page', lite('.lite-bar { position: fixed;', '.lite-bar { position: static;')],
  ['the bar sits under the home indicator', lite('calc(8px + env(safe-area-inset-bottom, 0px))', '8px')],
  ['the page leaves no room for the bar', lite('padding: 24px 28px calc(96px + env(safe-area-inset-bottom, 0px));', 'padding: 24px 28px;')],
  ['Needs you puts the latest first', lite('return out.sort(function(a, b) { return (a.days - b.days)', 'return out.sort(function(a, b) { return (b.days - a.days)')],
  ['Needs you has no cap', lite("|| String(a.title).localeCompare(String(b.title)); }).slice(0, 10);", "|| String(a.title).localeCompare(String(b.title)); });")],
  ['Today shows everything at once', lite('const shownNeeds = needs.slice(0, seeAll ? 10 : 3);', 'const shownNeeds = needs.slice(0, 10);')],
  ['a used perk is listed', lite("|| p.frequency === 'Standing' || chPerkUsed_(p, now)) return;", "|| p.frequency === 'Standing') return;")],
  ['a closed card’s perk is listed', lite('if (!card || !cvOpen_(card) || p.autopay', 'if (!card || p.autopay')],
  ['a coupon can be ticked (and deleted)', lite("days: n, tick: false, go: ['shopping', 'coupons']", "days: n, tick: true, go: ['shopping', 'coupons']")],
  ['ticking a perk calls the wrong route', lite("{ action: 'toggle_card_perk', id: n.id }", "{ action: 'mark_card_perk_used', perk: n.id }")],
  ['Home counts every chore (the old Status bug)', lite("&& /daily/i.test(String(c.Cadence || '')) && !liteChecked_(c); })", "&& /daily/i.test(String(c.Cadence || '')) && c.Status !== 'Done'; })")],
  ['All loses Family', lite("  { label: 'Family',   items: [['👶', 'Planning', 'family', 'planning'], ['💊', 'Prescriptions', 'family', 'prescriptions'], ['🎄', 'Wish lists', 'family', 'wishlists'], ['📒', 'Addresses', 'family', 'contacts']] },\n", '')],
  // Travel opens on the subtab it was asked for (its first render) and moves to it if already open (the effect).
  ['All › Bucket list lands on My Trips', b => ({ [L]: swap(swap(b[L], 'useEffect(() => { if (openSub && openSub.id) setTravSub(openSub.id); }, [openSub && openSub.at]);', ''),
    "const [travSub, setTravSub] = useState(() => (openSub && openSub.id) || 'trips');", "const [travSub, setTravSub] = useState('trips');") })],
  ['All › Settings does nothing', lite("if (id === 'settings') { setShowSettings(true); return; }", "if (id === 'settings') { return; }")],
  ['the grocery run stays on Today', lite("{activeTab === 'shopping' && shopSub === 'lists' && <GroceryRunButton", "{activeTab === 'overview' && <GroceryRunButton")],
  ['the tiles go back to bare counts', lite("<span>{t.line == null ? 'Loading…' : t.line}</span>", "<span>{t.line == null ? 'Loading…' : String((t.line.match(/\\d+/) || [''])[0])}</span>")],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
if (!HAS_BROWSER) { console.log('(skipped: no browser here)'); console.log('\nALL CONTROLS BIT'); process.exit(0); }
CONTROLS.forEach(function(c) {
  const name = c[0];
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[1](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });
  const r = cp.spawnSync('node', [TEST], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + TEST + ')');
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)         { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length)   { console.log('  !! NOTHING BIT (patched: ' + changed.join(', ') + ')'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 3).forEach(f => console.log('    - ' + f));
  if (fails.length > 3) console.log('    … and ' + (fails.length - 3) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
