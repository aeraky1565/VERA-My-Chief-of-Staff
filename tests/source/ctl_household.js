// Negative controls for test_household.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_household');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['HouseholdInfo.js'], FULL = ['docs/app.js', 'docs/index.html'], ALL = FULL.concat(['docs/dashboard-lite.html']);
const CONTROLS = [
  ['"No" reads as not set', swapIn(S, "  if (s === 'no' || s === 'false' || s === 'n') return false;\n", '')],
  ['a save without the switches clears them', swapIn(S, "  if (p === undefined || p === null || p === '') return prev;", "  if (p === undefined || p === null || p === '') return '';")],
  ['a gone line is written over', swapIn(S, "  if (rowNum > sheet.getLastRow()) return { ok: false, error: 'That line is gone; reload' };\n", '')],
  ['the new columns aren’t named on an old sheet', swapIn(S, "  if (!String(head[0]).trim() || !String(head[1]).trim()) sheet.getRange(1, 7, 1, 2).setValues([['Private', 'Emergency']]);\n", '')],
  ['Still right ✓ stamps every section', swapIn(S, "if (String(r[0]).trim() === section) { dates[i][0] = today; count++; }", "{ dates[i][0] = today; count++; }")],
  ['the route isn’t wired', swapIn(['WebApp.js'], "      case 'household_section_checked': return jsonOut_(webHouseholdSectionChecked_(e));", '')],
  ['the guide ignores the line’s own switch', swapIn(ALL, "return r&&(r.private===true||(r.private!==false&&hfGuideSensitive_(r.label)));", "return r&&hfGuideSensitive_(r.label);")],
  ['a line never set is shown in full', swapIn(ALL, "return r&&(r.private===true||(r.private!==false&&hfGuideSensitive_(r.label)));", "return r&&r.private===true;")],
  ['an impossible date is a countdown', swapIn(FULL, "if(isNaN(dt)||dt.getUTCMonth()!==+q[1]-1||dt.getUTCDate()!==+q[2])return '';", '')],
  ['search reads private values', swapIn(FULL, "[r.label,hhIsPrivate_(r)?'':r.value,r.notes,ss.subsection]", "[r.label,r.value,r.notes,ss.subsection]")],
  ['suggestions include what you have', swapIn(FULL, "return HH_SUGGEST_.filter(function(g){return !g.re.test(text);});", "return HH_SUGGEST_.slice();")],
  ['an ended contract still links', swapIn(FULL, "return (contracts||[]).filter(function(c){return !/terminated|cancel/i.test(String(c.status||''));}).filter(", "return (contracts||[]).filter(")],
  ['no emergency card', swapIn(FULL, "stars.length>0&&h('div',{className:'hh-em'}", "false&&h('div',{className:'hh-em'}")],
  ['copy copies the label', swapIn(FULL, "var copy=function(r){var t=String(r.value);", "var copy=function(r){var t=String(r.label);")],
  ['Save drops the ⭐', swapIn(FULL, "private:String(!!f.private),star:String(!!f.star)}", "private:String(!!f.private),star:'false'}")],
  ['the edit sheet loses the section', swapIn(FULL, "if(s)r=Object.assign({section:s.section,subsection:(ss&&ss.subsection)||''},r);", '')],
  ['the Contracts chip goes nowhere', swapIn(FULL, "if(onOpenTab)onOpenTab('finances','contracts');", '')],
  ['the sections aren’t a list on a computer', swapIn(['docs/index.html'], ".hh-body { display: grid; grid-template-columns: 220px minmax(0, 1fr); align-items: start; }", ".hh-body { display: flex; }")],
];
const T = 'test_household.js';
let allBit = true;
const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
CONTROLS.forEach(([name, mut]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const ui = Object.keys(patch).some(f => f.startsWith('docs/'));
  if (ui && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  fs.readdirSync(path.join(SRC_DIR, 'docs')).forEach(f => { const s = path.join(SRC_DIR, 'docs', f), d = path.join(OUT, 'docs', f); if (!fs.existsSync(d) && fs.statSync(s).isFile()) fs.copyFileSync(s, d); });
  const r = cp.spawnSync('node', [T], { cwd: __dirname, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_CTL_FAST: '1' }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name);
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
