// Negative controls for test_notesview.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_notesview');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['one Related To only', swapIn(FULL, "var rel=String(relatedTo||'').split(/[;,]/).map(", "var rel=[String(relatedTo||'')].map(")],
  ['short names match inside words', swapIn(FULL, "return r===n||(n.length>=4&&r.indexOf(n)!==-1)", "return r===n||(r.indexOf(n)!==-1)")],
  ['a Vault note shows on a person', swapIn(FULL, "return !n.vault&&ntMatch_(n.relatedTo,names);", "return ntMatch_(n.relatedTo,names);")],
  ['search matches any word, not every word', swapIn(FULL, "return w.every(function(x){return hay.indexOf(x)!==-1;});", "return w.some(function(x){return hay.indexOf(x)!==-1;});")],
  ['search reads inside the Vault', swapIn(FULL, "function ntHay_(n){if(n.vault)return n.hideLabel?'':String(n.title||'').toLowerCase();", "function ntHay_(n){")],
  ['matches aren’t highlighted', swapIn(FULL, "return i%2?h('mark',{key:i,className:'nq-mark'},p):p;", "return p;")],
  ['not pinned first', swapIn(FULL, "return (b.pinned?1:0)-(a.pinned?1:0)||String(b.updated", "return String(b.updated")],
  ['an old category isn’t a tag', swapIn(FULL, "if(c&&c!=='general'&&c!=='quick-capture'&&l.indexOf(c)===-1)l.push(c);", "")],
  ['tag counts include a hidden label', swapIn(FULL, "(notes||[]).forEach(function(n){if(n.vault&&n.hideLabel)return;ntTagsOf_(n)", "(notes||[]).forEach(function(n){ntTagsOf_(n)")],
  ['Back today shows every note', swapIn(FULL, "return n.backOn&&n.backOn<=today;", "return true;")],
  ['a Vault body shows on its card', swapIn(FULL, "n.vault?h('div',{className:'nq-body nq-hidden'},'Hidden · tap to open'):", "")],
  ['a Vault note opens shown', swapIn(FULL, "var _r=React.useState(!n.vault),shown=_r[0]", "var _r=React.useState(true),shown=_r[0]")],
  ['a tick changes the wrong line', swapIn(FULL, "return String(content||'').split('\\n').map(function(l,i){if(i!==line)return l;", "return String(content||'').split('\\n').map(function(l,i){if(i!==line+1)return l;")],
  ['the Vault isn’t offered for a password', swapIn(FULL, "if(!v&&!ed&&ntLooksSecret_(body)&&window.confirm(", "if(false&&window.confirm(")],
  ['newer doesn’t replace older', swapIn(FULL, "var older=r.kind==='note'?ntReplaces_(body,p.notes||[],r.id):null;", "var older=null;")],
  ['no suggested tag', swapIn(FULL, "sug&&h('button',{type:'button',className:'nq-sug'", "false&&h('button',{type:'button',className:'nq-sug'")],
  ['Undo does nothing', swapIn(FULL, "function undo(){var r=toast;setToast(null);apiPost(", "function undo(){var r=toast;setToast(null);(function(){return Promise.resolve();})(")],
  ['no look-alikes in Tidy tags', swapIn(FULL, "alike.length>0&&h('div',{className:'nq-alike'}", "false&&h('div',{className:'nq-alike'}")],
  ['cards on a phone', swapIn(FULL, "      .nq-grid { display: flex; flex-direction: column; gap: 0; border-top: 1px solid #1e3060; }\n", "")],
  ['cards show 3 lines', swapIn(FULL, "-webkit-line-clamp: 4; -webkit-box-orient: vertical; white-space: pre-line; overflow-wrap: anywhere; }\n    .nq-hidden", "-webkit-line-clamp: 3; -webkit-box-orient: vertical; white-space: pre-line; overflow-wrap: anywhere; }\n    .nq-hidden")],
  ['no Jot a note on Home', swapIn(FULL, "React.createElement(JotNoteTile,{apiUrl:apiUrl,apiToken:apiToken}),", "")],
  ['/ doesn’t reach the search', swapIn(FULL, "if(box){e.preventDefault();box.focus();}", "")],
  ['Home search doesn’t open Notes', swapIn(FULL, "localStorage.setItem('vera_life_sub','notes');", "")],
  ['it says nothing about privacy', swapIn(FULL, "Notes are yours alone and private: VERA reads only the ones marked ✨. Nothing here goes to Memory.", "Your notes.")],
  ['projects show every note', swapIn(FULL, "return p.projectName&&ntLinked_(notes,[p.projectName]).length;", "return p.projectName;")],
  ['no person notes', swapIn(FULL, "h(LinkedNotes,{notes:notes||[],names:[person]}),", "")],
];
const T = 'test_notesview.js';
let allBit = true;
const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
CONTROLS.forEach(([name, mut]) => {
  if (process.env.CTL_ONLY && name !== process.env.CTL_ONLY) return;
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
