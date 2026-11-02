// Negative controls for the Life tab (Life.js, LifeGrowth.js, ComingUp.js, QuickCapture.js and the
// Life blocks in docs/app.js, issue #222 stages 2–5): break ONE rule at a time and confirm a test
// catches it. UI controls run one part of test_life_ui.js (LIFE_ONLY) at phone width.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_life_out');
const FILES = ['Life.js', 'LifeGrowth.js', 'ComingUp.js', 'QuickCapture.js', 'WebApp.js', 'Chat.js', 'Code.js', 'MonthlyReview.js', 'WeekendPlanner.js', 'PlannedPurchases.js',
  'docs/app.js', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const A = 'docs/app.js', I = 'docs/index.html';
const in_ = (f) => (from, to) => b => ({ [f]: swap(b[f], from, to) });
const life = in_('Life.js'), lg = in_('LifeGrowth.js'), cu = in_('ComingUp.js'), qc = in_('QuickCapture.js');
const ui = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });
const TEST = 'test_life.js', UI = 'test_life_ui.js';
const CONTROLS = [
  // Explore
  ['a debrief window of five days', life('var LF_LESSON_WINDOW_DAYS_ = 4;', 'var LF_LESSON_WINDOW_DAYS_ = 5;')],
  ['a manual entry counts as a debrief', life("if (!it || it.source !== 'Chat' || !it.date) return null;", "if (!it || !it.date) return null;")],
  ['a hand-set tag is ignored', life("if (tag) return tag;\n", "")],
  ['Food is not a place', life("if (it.category === 'Travel' || it.category === 'Food') return 'place';", "if (it.category === 'Travel') return 'place';")],
  ['duplicates are not merged', life("var key = lfNorm_(it.interest) + '|' + it.person;", "var key = it.id;")],
  ['two people\'s same words merge', life("var key = lfNorm_(it.interest) + '|' + it.person;", "var key = lfNorm_(it.interest);")],
  ['trip words count as place words', life("var LF_PLACE_STOP_ = ['trip',", "var LF_PLACE_STOP_ = [")],
  ['a donation without a receipt is offered to Tax', life("return r.kind === 'donation' && r.receipt && (r.date || '').slice(0, 4) === y;", "return r.kind === 'donation' && (r.date || '').slice(0, 4) === y;")],
  ['volunteering needs no hours', life("if (g.kind === 'volunteering' && g.hours == null) return 'How many hours?';", "")],
  ['the same weekend wish is added twice', life("if (list.some(function(w) { return lfNorm_(w.text) === lfNorm_(t); })) return list;", "")],
  ['a bought wish moves to Planned Purchases', life("if (!w || !w.item || /^purchased$/i.test(w.status || '')) return null;", "if (!w || !w.item) return null;")],
  ['the Wish List moves every night', life("if (props.getProperty(LF_WISH_MIGRATED_PROP_)) return { moved: 0, reason: 'already moved' };", "")],
  ['the Weekend Planner is not told the wishes', b => ({ 'WeekendPlanner.js': swap(b['WeekendPlanner.js'], "  if (ctx.weekendWishes && ctx.weekendWishes.length) {", "  if (false) {") })],
  // Growth
  ['"daily" reads as once a week', lg("if (/\\b(daily|every ?day)\\b/.test(r)) return 7;", "")],
  ['Now holds four', lg('var LG_NOW_MAX_ = 3;', 'var LG_NOW_MAX_ = 4;')],
  ['the streak counts the open week first', lg("for (var k = weeks.length - 2; k >= 0 && weeks[k].met; k--) streak++;", "for (var k = weeks.length - 1; k >= 0 && weeks[k].met; k--) streak++;")],
  ['practice after today counts', lg("if (!e.date || e.date > today) return;", "if (!e.date) return;")],
  ['finished goals are offered to carry over', lg("return goals.filter(function(g) { return g.focus !== 'done' && (g.year < y || (dec && g.year === y)); })", "return goals.filter(function(g) { return (g.year < y || (dec && g.year === y)); })")],
  ['a trial never asks how it went', lg("var state = decided ? 'decided' : (t.end && today > t.end ? 'ended' : 'active');", "var state = decided ? 'decided' : 'active';")],
  ['one low month is "two running"', lg("if (a[k] && b[k] && a[k] <= 2 && b[k] <= 2) low.push(k);", "if (a[k] && a[k] <= 2) low.push(k);")],
  ['overlapping plans count twice', lg("if (u[1] <= cur || u[0] >= e) return;", "return;")],
  ['an all-day marker fills the evening', lg("if (b === 'other') return;   // an all-day marker", "if (false) return;   // an all-day marker")],
  ['Did it? asks for a goal already logged', lg("if ((logsByGoal[g.id] || []).some(function(e) { return e.date === day; })) return;", "")],
  ['a word inside a word matches', lg("return words.some(function(w) { return (' ' + t + ' ').indexOf(' ' + w) !== -1; });", "return words.some(function(w) { return t.indexOf(w) !== -1; });")],
  ['the nudge waits a day less', lg("return !p || p.daysSince === null || p.daysSince >= days;", "return !p || p.daysSince === null || p.daysSince >= days - 1;")],
  ['a done goal is found for Chat', lg("var open = goals.filter(function(g) { return g.focus !== 'done'; });", "var open = goals;")],
  ['the balance ask is not in the monthly review', b => ({ 'MonthlyReview.js': swap(b['MonthlyReview.js'], "  sections.push(buildLifeBalanceAsk_(label));", "") })],
  // Coming up
  ['the shorter lead wins', cu("if (!best || ty.lead > best.lead) best = ty;", "if (!best || ty.lead < best.lead) best = ty;")],
  ['a recurring event with no place is kept', cu("return !ev.recurring && !ev.mine;", "return !ev.mine;")],
  ['his own blocks are kept', cu("return !ev.recurring && !ev.mine;", "return !ev.recurring;")],
  ['a birthday does not merge into the plan', cu("if (host) { host.dates.push(", "if (false) { host.dates.push(")],
  ['How was it? never shows', cu("var after = away < 0 && away >= -CU_AFTER_DAYS_;", "var after = false;")],
  ['an answered card comes back', cu("if (after && done[ev.id]) return;", "")],
  ['RSVP is not read from the description', cu("var rsvp = String(c.description || '').match(/rsvp[^.\\n]{0,60}/i);", "var rsvp = null;")],
  ['leave-by forgets the ten minutes', cu("var m = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) - driveMin - 10;", "var m = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) - driveMin;")],
  ['a daytime plan clashes', cu("if (c.time && mins(c.time) >= 17 * 60) {", "if (c.time) {")],
  ['plans during a trip are not flagged', cu("(trips || []).forEach(function(t) { if (t.start && t.end && c.day >= t.start && c.day <= t.end", "(trips || []).forEach(function(t) { if (false && t.start && t.end && c.day >= t.start && c.day <= t.end")],
  ['Config rows overwrite yours', cu("CU_DEFAULTS_.forEach(function(p) { if (!have[p[0]]) { sheet.appendRow(p); added++; } });", "CU_DEFAULTS_.forEach(function(p) { sheet.appendRow(p); added++; });")],
  // Quick capture
  ['any Chat action can be filed', qc("if (m && QC_KINDS_.indexOf(m[1]) !== -1) return", "if (m) return")],
  ['without VERA, everything is a note', qc("if (hit) { var m = t.match(/(\\d+)\\s*min/); return { type: 'log_practice', args: [hit, m ? m[1] : '', ''] }; }", "")],
  // UI
  ['Explore: Plan a trip is on Things we love too', ui("view==='places'&&h(\"button\",{className:\"lf-to-trip\"", "h(\"button\",{className:\"lf-to-trip\""), UI, 'explore'],
  ['Explore: Move to… moves only one copy', ui("act({action:'life_interest_tag',id:it.id,ids:it.ids,", "act({action:'life_interest_tag',id:it.id,ids:[it.id],"), UI, 'explore'],
  ['Explore: volunteering asks for an amount', ui("edit.kind==='donation'?h(\"input\",{className:\"lf-give-amount\"", "true?h(\"input\",{className:\"lf-give-amount\""), UI, 'explore'],
  ['Explore: lessons show on any trip', ui("if(!want.length)return[];return data.lessons.filter(function(l){return want.some(", "return data.lessons.filter(function(l){return true||want.some("), UI, 'explore'],
  ['Growth: Now shows waiting goals too', ui("var now=(data.goals||[]).filter(function(g){return g.focus==='now';});", "var now=(data.goals||[]).filter(function(g){return g.focus!=='done';});"), UI, 'growth'],
  ['Growth: Undo is never offered', ui("undo:r.added?{action:'life_practice_undo',goalId:g.id,day:data.today}:null};});},style:lfPill(!p.practisedToday)}", "undo:null};});},style:lfPill(!p.practisedToday)}"), UI, 'growth'],
  ['Growth: minutes are sent as text', ui("minutes:Number(m)},function(r){setMins", "minutes:m},function(r){setMins"), UI, 'growth'],
  ['Growth: ended trials sort last', ui("var order={ended:0,active:1,decided:2};", "var order={ended:2,active:1,decided:0};"), UI, 'growth'],
  ['Growth: Life balance saves with one area rated', ui("var allRated=areas.every(function(k){return rate[k];});", "var allRated=areas.some(function(k){return rate[k];});"), UI, 'growth'],
  ['Growth: Habits is not the year grid', ui("if(sub==='habits')return h(YearInReviewTab,{apiUrl:apiUrl,apiToken:apiToken});", "if(sub==='habits')return h(\"div\",null,'Habits');"), UI, 'growth'],
  ['Coming up: a gift does not open People', ui("if(p.kind==='gift'){onNavigate&&onNavigate('people');return;}", "if(p.kind==='gift'){return;}"), UI, 'comingup'],
  ['Coming up: How was it? saves an empty line', ui("disabled:busy||!note.trim(),onClick:function(){debrief('note');}", "disabled:busy,onClick:function(){debrief('note');}"), UI, 'comingup'],
  ['Coming up: the strip scrolls the page sideways', ui("className:\"cu-row\",style:{display:'flex',gap:10,overflowX:'auto'", "className:\"cu-row\",style:{display:'flex',gap:10,overflowX:'visible'"), UI, 'comingup'],
  ['Quick capture: undo always posts', ui("(u.via==='get'?apiGet(apiUrl,apiToken,p):apiPost(apiUrl,apiToken,p))", "apiPost(apiUrl,apiToken,p)"), UI, 'quick'],
  ['Life: the group is not remembered', ui("try{localStorage.setItem('vera_life_group',id);}catch(e){}", ""), UI, 'explore'],
  ['Life: a deep link is ignored', ui("if(lfInit)o[lfInit.id]=props.initialSub;", ""), UI, 'deeplink'],
];
const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
let allBit = true;
CONTROLS.forEach(function(c) {
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + c[0] + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + c[0] + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const test = c[2] || TEST;
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }, c[3] ? { LIFE_ONLY: c[3] } : {}) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  console.log('\n=== CONTROL: ' + c[0] + '  (' + test + ')');
  if (r.status !== 0 && !fails.length) { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:'); fails.slice(0, 3).forEach(f => console.log('    - ' + f));
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
