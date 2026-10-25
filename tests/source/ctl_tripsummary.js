// Negative controls for the itinerary Summary (TripSummaryView): revert ONE rule
// at a time and confirm test_tripsummary.js catches it. Node only, like every
// control. A change to the shared block is made in BOTH dashboards, so each
// control tests the rule itself rather than the parity check.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_trsum');

const FILES = ['docs/app.js', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [L]: swap(b[L], from, to) });
const TEST = 'test_tripsummary.js';

const CONTROLS = [
  ['an overnight flight\'s night counts as missing', both("if((m.endDate&&m.endDate>it.date)||(it.startTime&&it.endTime&&it.endTime<it.startTime))inAir[it.date]=it;", '')],
  ['the last night (at home) needs a stay', both('var nights=days.slice(0,-1);', 'var nights=days.slice(0);')],
  ['a Board … Disembark cruise covers nothing', both('if(board&&off&&board.date<off.date)for', 'if(false)for')],
  ['amber overrides red', both("if(health!=='red')health='amber';reasons.push('a tight connection');", "health='amber';reasons.push('a tight connection');")],
  ['driving yourself still needs a booking home', both("needDep=days.length>1&&!TS_SELF_TRANSPORT[o.returnMode||'']", 'needDep=days.length>1')],
  ['a decided option still counts as open', both("return m.tentative===true&&m.decisionStatus!=='decided';", 'return m.tentative===true;')],
  ['every option of a group is counted', both("return !m.optionGroup||m.isRepresentative===true;});", 'return true;});')],
  ['a hotel\'s bare name counts as a city', both("if(String(it.location||'').indexOf(',')===-1)return;", '')],
  ['a travel day ignores where the move ends', both('if(!c){var mv=movesOn(d);for(var k=mv.length-1;k>=0&&!c;k--)c=tsMoveDest_(mv[k]);}', '')],
  ['airport codes stay as the city', both("if(/^[A-Z]{3}$/.test(dayCity[d])&&i+1<days.length", "if(false&&i+1<days.length")],
  ['check-in opens 48 h before', both('var opens=dep-24*3600000;', 'var opens=dep-48*3600000;')],
  ['the decision wording drifts from today\'s', both("return 'Still deciding — '+n+' options'", "return 'Deciding: '+n+' options'")],
  ['a tight connection waits for the whole gap', both('var TS_TIGHT_RATIO=0.7;', 'var TS_TIGHT_RATIO=1.5;')],
  ['the lite copy drifts', b => ({ [L]: swap(b[L], "'Nothing booked'", "'Not booked'") })],
  ['full: Agenda stays the default', b => ({ [A]: swap(b[A], "React.useState('summary');", "React.useState('agenda');") })],
  ['full: VERA Notices shows on Summary too', b => ({ [A]: swap(b[A], "viewMode!=='summary'&&allNotices.length>0", 'allNotices.length>0') })],
  // ---- Agenda (stage 2) ----
  ['any gap counts as free time', both('if(free>=60)(out[a.id]', 'if(free>=0)(out[a.id]')],
  ['the drive is not taken off free time', both('var free=gap-drive;', 'var free=gap;')],
  ['full: + Add item is missing from Agenda', b => ({ [A]: swap(b[A], ",viewMode==='agenda'&&/*#__PURE__*/React.createElement(TsAgendaToolbar,{onAdd:onAdd,busy:busy})", '') })],
  ['full: the add form ignores the day it was opened for', b => ({ [A]: swap(b[A], "React.useState(isEdit?item.date||'':defaults&&defaults.date||'');", "React.useState(isEdit?item.date||'':'');") })],
  ['full: VERA Notices repeats what each day now shows', b => ({ [A]: swap(b[A], ".filter(function(n){return n.type!=='timeline_gap'&&n.type!=='missing_hotel'&&n.type!=='missing_transport';});", ';') })],
  ['lite: the add form ignores the day it was opened for', b => ({ [L]: swap(b[L], "(defaults?.date||tripStartDate||'')", "(tripStartDate||'')") })],
  ['lite: the end-of-day slots are missing', b => ({ [L]: swap(b[L], "{date !== '_undated' && <TsDayEnd date={date} summary={agendaSum} onAdd={onAdd} busy={busy} />}", '') })],
  // ---- documents (stage 3) ----
  ['a passport that runs out is only amber', both("if(st==='expires')e.red=true;", '')],
  ['a visa to arrange is not flagged', both("if(p.color==='red'||p.color==='yellow')visas.push(", "if(false)visas.push(")],
  ['red no longer comes first', both("  attention=attention.filter(function(a){return a.level==='red';}).concat(attention.filter(function(a){return a.level!=='red';}));\n", '')],
  ['full: the Visa view is back', b => ({ [A]: swap(b[A], "['summary','agenda','map'].map(function(mode)", "['summary','agenda','map','visa'].map(function(mode)") })],
  // ---- Home travel card (stage 4) ----
  ['leave-by gives up at the first stop without a drive', both("    if(!leg||leg.driveMins==null)continue;// no cached drive for this stop: try the next", "    if(!leg||leg.driveMins==null)break;")],
  ['a leave-by time already past still shows', both("var t=tsMins_(b.startTime)-leg.driveMins;if(t<now)continue;", "var t=tsMins_(b.startTime)-leg.driveMins;")],
  ['the trip\'s last night is a gap, not home', both("lastNight?{kind:'home',title:''}:", '')],
  ['flights repeat in Next up', both("return it.type!=='flight'&&!TS_STAY_TYPES[it.type]&&(!it.startTime", "return !TS_STAY_TYPES[it.type]&&(!it.startTime")],
  ['lite: the travel card lacks the today pieces', b => ({ [L]: swap(b[L], "/*#__PURE__*/React.createElement(TsTodayCard,{trip:trip,items:items,day:displayDay,departing:departing,apiUrl:apiUrl,apiToken:apiToken,onViewItinerary:function(){if(onViewItinerary)onViewItinerary(trip);}}),", '') })],
  ['lite: Agenda stays the default', b => ({ [L]: swap(b[L], "tripTabs[tripKey] || 'summary'", "tripTabs[tripKey] || 'agenda'") })],
];

let allBit = true;
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
  const r = cp.spawnSync('node', [TEST], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
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
