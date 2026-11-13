// Negative controls for #239 phase 2 (step 2 and the readiness check): revert ONE rule at
// a time and confirm test_tripids2.js (or the panel's browser test) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tripids2');
const FILES = ['Trips.js', 'TripIds.js', 'Code.js', 'WebApp.js', 'PackPlus.js', 'TripGifts.js', 'TripShare.js', 'TripActuals.js', 'LeavingHome.js',
  'TravelDayBriefing.js', 'PostTripCapture.js', 'PreTripBriefing.js', 'Luggage.js', 'Aria.js', 'TripDecisions.js', 'Reminders.js', 'Claude.js',
  'Chat.js', 'GenerationInputs.js', 'MyTrips.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const NODE = 'test_tripids2.js', UI = 'test_tripids_ui.js';
const CONTROLS = [
  ['the ID is ignored (key only)', one('Trips.js', "  if (id) { var want = tripIdOf_(tripKey); if (want) return id === want; }\n", ''), NODE],
  ['the ID only adds rows, never removes another trip\'s', one('Trips.js', "if (want) return id === want; }", "if (want && id === want) return true; }"), NODE],
  ['the trip\'s ID looked up for every row', one('Trips.js', "  if (typeof _tripIdOfCache_ === 'object') _tripIdOfCache_[k] = id;\n", ''), NODE],
  ['a registry change keeps the old ID', one('Trips.js', "_tripKeySetCache_ = {}; _tripIdOfCache_ = {}; }", "_tripKeySetCache_ = {}; }"), NODE],
  ['tallies ignore the ID', one('Trips.js', "  return tripIdCellOf_(idCell) || String(keyCell == null ? '' : keyCell).trim();", "  return String(keyCell == null ? '' : keyCell).trim();"), NODE],
  ['TripMeta: the ID row doesn\'t win', one('Trips.js', "  if (want) for (var j = 0; j < (cells || []).length; j++) if (tripIdCellOf_(idCells[j]) === want) return j;\n", ''), NODE],
  ['TripMeta: another trip\'s row is read', one('Trips.js', "    if (other(i)) continue;\n", ''), NODE],
  ['packing back on keys', one('PackPlus.js', "return tripRowIs_(r.tripKey, r.tripId, tripKey); }); }", "return pkKeyMatch_(r.tripKey, tripKey); }); }"), NODE],
  ['packing rows lose their ID', one('PackPlus.js', ", tripId: String(r[PACKING_ITEM_HEADERS.length - 1] || '').trim() };", " };"), NODE],
  ['gift budget back on keys', one('TripGifts.js', "!tripRowIs_(r[1], r[TRIP_BUDGET_HEADERS.length - 1], tripKey) || String(r[2]).trim().toLowerCase() !== 'gifts') return;", "!tripKeyMatches_(r[1], tripKey) || String(r[2]).trim().toLowerCase() !== 'gifts') return;"), NODE],
  ['a reader added on keys (the scan)', one('TripShare.js', "!tripRowIs_(r[1], r[ITINERARY_HEADERS.length - 1], tripKey)) return;", "!tripKeyMatches_(r[1], tripKey)) return;"), NODE],
  ['a writer switched early', one('WebApp.js', "    if (tripRowMatches_(rows[i][1], keys) &&", "    if (tripRowIs_(rows[i][1], rows[i][TRIP_DECISION_HEADERS.length - 1], tripKey) &&"), NODE],
  ['itinerary items lose their ID', one('WebApp.js', "        tripId:    tripIdCellOf_(row[ITINERARY_HEADERS.length - 1]),\n", ''), NODE],
  ['actuals ignore the trip\'s ID', one('TripActuals.js', "    var mine = want && /^TRIP-/.test(id) ? id === want\n      : key", "    var mine = key"), NODE],
  ['leaving-home runs lose their ID', one('LeavingHome.js', "tripId: String(r[11] || '').trim(), _row", "_row"), NODE],
  ['tone read by key', one('TravelDayBriefing.js', "tripRowIs_(data[i][0], data[i][TRIP_META_HEADERS.length - 1], tripKey)", "tripKeyMatches_(data[i][0], tripKey)"), NODE],
  ['the check fills IDs', one('TripIds.js', "if (write && r.filled) sh.getRange", "if (r.filled) sh.getRange"), NODE],
  ['the check counts would-be fills as filled', one('TripIds.js', "var withId = r.withId - (write ? 0 : r.filled), blank = r.blank + (write ? 0 : r.filled);", "var withId = r.withId, blank = r.blank;"), NODE],
  ['clean since restarts every night', one('TripIds.js', "String(prev) <= todayIso ? String(prev) : todayIso;", "false ? String(prev) : todayIso;"), NODE],
  ['ready without the week', one('TripIds.js', "days >= TID_CLEAN_DAYS_ }", "days >= 0 }"), NODE],
  ['a moved column doesn\'t block', one('TripIds.js', "  var cleanNow = !scan.blank && !scan.mismatched && !scan.tabs.some(function(t) { return t.skipped; });", "  var cleanNow = !scan.blank && !scan.mismatched;"), NODE],
  ['the nightly fill doesn\'t record', one('TripIds.js', "  tripIdRecordClean_(out);\n", ''), NODE],
  ['no route', one('WebApp.js', "      case 'trip_id_check':         return jsonOut_(webTripIdCheck_());   // TripIds.js (#239): read only\n", ''), NODE],
  ['the panel says ready too soon', ui("var status=data.ready?{", "var status=data.cleanNow?{"), UI],
  ['the panel drops the rows to fix', ui("issues.length>0&&h(", "false&&h("), UI],
  ['the panel isn\'t in System', ui(",cur==='trip_ids'&&h(SysTripIds,{apiUrl:apiUrl,apiToken:apiToken})", ''), UI],
];
let allBit = true;
// The dashboard controls drive a real browser. The CI job that runs controls has none (the
// browser job runs the screens themselves), so there they are skipped and said so; locally they run.
const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();
CONTROLS.forEach(([name, mut, test]) => {
  if (test === UI && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT, f)));
  // test_tripids2 lists every .js at the root (the key-only scan), so the rest come along unchanged.
  fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js') && !files[f]).forEach(f => fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT, f)));
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_CTL_FAST: '1' }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
