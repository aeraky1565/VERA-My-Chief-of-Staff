// Negative controls for the full dashboard's Home (computer layout): break ONE rule at a time and
// confirm test_fullhome_ui.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_fullhome');
const FILES = ['WebApp.js', 'docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const css = (from, to) => b => ({ 'docs/index.html': swap(b['docs/index.html'], from, to) });
const T = 'test_fullhome_ui.js';
const CONTROLS = [
  ['Today reads another calendar route', ui("{action:'get_todays_events'}", "{action:'todays_events_off'}")],
  ['Today hides a missing calendar', ui("d.calendarFound===false?h('div',{className:'fh-none'},'Couldn’t find the Joint Chaos calendar')", "false?null")],
  ['the trip chip ignores a trip underway', ui("if(on){var n=days(on.endDate||on.startDate);", "if(false){var n=0;")],
  ['Coming up shows past events', ui("var cs=(c.cards||[]).filter(function(x){return !x.after;});", "var cs=(c.cards||[]);")],
  ['practice is never behind', ui("return need>0&&need>=left;", "return false;")],
  ['a line over plan isn’t amber', ui("hot:s.over>0||s.left<0}", "hot:s.left<0}")],
  ['a birthday with no ideas isn’t amber', ui("hot:n.days<=14&&!n.ideas}", "hot:false}")],
  ['the pick ignores urgency', ui("var urgent=fhGlancePick_(tiles),", "var urgent='coming',")],
  ['a birthday isn’t first', ui("var order=['birthday','money','practice'];", "var order=['money','practice','birthday'];")],
  ['a peek sticks after leaving Home', ui("  var[peek,setPeek]=React.useState(null);", "  var[peek,setPeek0]=React.useState(window.__fhPeek||null);var setPeek=function(v){window.__fhPeek=v;setPeek0(v);};")],
  ['no mark on the urgent chip', ui("x.id===urgent&&x.hot?h('span',{className:'fh-gdot','aria-hidden':'true'}):null", "null")],
  ['all four cards again', ui("tiles.filter(function(x){return x.id===(peek||urgent);})[0]||tiles[0];", "tiles[0];")],
  ['At a glance leaves Home', ui("React.createElement(FhGlance,{apiUrl:apiUrl,apiToken:apiToken,onNavigate:onNavigate})", "null")],
  ['the pick-one slot comes back', b => ({ 'docs/app.js': b['docs/app.js'] + '\nfunction HomeSlot(){}' })],
  ['Needs you lists low flags', ui("(f.urgency==='High'||f.urgency==='Medium')", "true")],
  ['Needs you drops overdue tasks', ui("if(!t.isOverdue&&(n==null||n>3))return;", "if(t.isOverdue||n==null||n>3)return;")],
  ['Needs you isn’t soonest first', ui("return (a.days-b.days)||", "return 0||")],
  ['Needs you shows everything at once', ui("var shown=all?rows:rows.slice(0,fhNeedsShown_(!fhIsPhone_()));", "var shown=rows;")],
  ['Needs you shows five on a phone too', ui("function fhNeedsShown_(wide){return wide?5:3;}", "function fhNeedsShown_(wide){return 5;}")],
  ['Needs you drops the lite extras', ui("liteNeedsYou_({cards:ex.cards,coupons:ex.coupons,chores:ex.chores},new Date())", "[]")],
  ['the shared Needs you block drifts', b => ({ 'docs/dashboard-lite.html': swap(b['docs/dashboard-lite.html'], "function liteDueText_(n) { return n < 0 ? (-n) + 'd overdue'", "function liteDueText_(n) { return n < 0 ? (-n) + ' days overdue'") })],
  ['the mail tile leaves Home', ui("React.createElement(FhMailTile,{counter:mailCounter,busy:mailCounterBusy,onReset:onResetMailCounter,onNavigate:onNavigate}),", "")],
  ['the old big-number cards come back', ui("function FhMailTile(", "function MailCounterCard(){}\nfunction FhMailTile(")],
  ['a high flag isn’t amber', ui("hot:hi.length>0}:{lines:['All clear']", "hot:false}:{lines:['All clear']")],
  ['overdue tasks aren’t amber', ui("hot:over.length>0}:{lines:['Nothing open']", "hot:false}:{lines:['Nothing open']")],
  ['Money drops groceries', ui("if(g&&g.actual!=null){", "if(false){")],
  ['packing left on a near trip isn’t amber', ui("hot=d!=null&&d<=3&&done<it.length;", "hot=false;")],
  ['Shopping shows lists with nothing to buy', ui(".filter(function(x){return x.n>0;}).sort(function(a,b){return b.n-a.n;});\n  return {lines:s.length", ".sort(function(a,b){return b.n-a.n;});\n  return {lines:s.length")],
  ['Got the mail! is gone', ui("busy?'Resetting…':'✓ Got the mail!'", "busy?'Resetting…':'Reset'")],
  ['Money ignores paid bills', ui("return !b.paid&&b.dueDay!=null&&b.dueDay>=day;", "return b.dueDay!=null&&b.dueDay>=day;")],
  ['System health ignores a late assistant', ui("bad:bad2>0,text:'Assistants '", "bad:false,text:'Assistants '")],
  ['System health ignores Trip IDs', ui("bad:n>0||sk>0,", "bad:false,")],
  ['a stopped nightly run looks fine', ui("var bad=!at||age>26||!!nl.stoppedAt;", "var bad=!at||age>26;")],
  ['System health doesn’t open System', ui("onClick:function(){onNavigate('system');},onKeyDown:", "onClick:function(){},onKeyDown:")],
  ['no nightly route', b => ({ 'WebApp.js': swap(b['WebApp.js'], "case 'home_nightly':", "case 'home_nightly_off':") })],
  ['one column on a computer', css(".fh-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);", ".fh-cols { display: grid; grid-template-columns: 1fr;")],
  ['the phone loses the mockup’s order (Needs you before At a glance)', css("      .fh-glance { order: 3; }\n", "")],
  ['Mail back after Shopping (the old order)', ui("React.createElement(FhMailTile,{counter:mailCounter,busy:mailCounterBusy,onReset:onResetMailCounter,onNavigate:onNavigate}),(function(){var t=fhProjTile_(", "(function(){var t=fhProjTile_(")],
  ['no FSA & HSA tile', ui(",React.createElement(FhHsaTile,{apiUrl:apiUrl,apiToken:apiToken,onNavigate:onNavigate})", "")],
  ['FSA & HSA never amber', ui("if(f.warn)hot=true;", "")],
  ['FSA & HSA shows last year’s used-up FSA', ui("return x.daysLeft==null||x.daysLeft>=0;", "return true;")],
  ['FSA & HSA opens Finances on its summary', ui("VERA_GOTO_.finances='hsafsa';onNavigate('finances');", "onNavigate('finances');")],
  ['tiles stay two across on a wide window', css(".fh-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }", ".fh-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }")],
];
let allBit = true;
const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();
CONTROLS.forEach(([name, mut]) => {
  if (!HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT, f)));
  const r = cp.spawnSync('node', [T], { cwd: __dirname, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_CTL_FAST: '1' }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name + '  (' + T + ')');
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
