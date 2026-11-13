// Negative controls for #218: revert ONE rule at a time and confirm test_people.js
// (or, for the panel, test_people_ui.js) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_people');
const FILES = ['People.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const P = 'People.js', W = 'WebApp.js', APP = 'docs/app.js', LITE = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [APP]: swap(b[APP], from, to), [LITE]: swap(b[LITE], from, to) });
const NODE = 'test_people.js', UI = 'test_people_ui.js';
// The UI test loads index.html, which carries app.js inside it: rebuild it from the mutated app.js.
const withIndex = mut => b => { const p = mut(b); if (p[APP]) { const a = b[APP], i = b['docs/index.html']; p['docs/index.html'] = i.split(a).join(p[APP]); if (p['docs/index.html'] === i) throw new Error('index.html does not carry app.js verbatim'); } return p; };
const CONTROLS = [
  ['the shared token no longer the owner', b => ({ [P]: swap(b[P], "  if (webToken && t === webToken) return", "  if (false) return") }), NODE],
  ['codes compared as typed', b => ({ [P]: swap(swap(b[P], "  var h = hashOf(peopleNormalize_(t));", "  var h = hashOf(t);"), "Utilities.DigestAlgorithm.SHA_256, peopleNormalize_(code), Utilities.Charset.UTF_8", "Utilities.DigestAlgorithm.SHA_256, String(code), Utilities.Charset.UTF_8") }), NODE],
  ['the code itself is stored', b => ({ [P]: swap(b[P], "hashes: [peopleHash_(code)], created:", "hashes: [peopleHash_(code)], code: code, created:") }), NODE],
  ['a new code replaces the old ones', b => ({ [P]: swap(b[P], "    p.hashes = (p.hashes || []).concat([peopleHash_(code)]);", "    p.hashes = [peopleHash_(code)];") }), NODE],
  ['sign out leaves the codes working', b => ({ [P]: swap(b[P], "    p.hashes = [];\n    peopleWrite_(d);", "    peopleWrite_(d);") }), NODE],
  ['anyone can manage people', b => ({ [P]: swap(b[P], "function peopleOwnerOnly_() { return _veraWho_ && _veraWho_.owner ? null :", "function peopleOwnerOnly_() { return _veraWho_ ? null :") }), NODE],
  ['a taken name allowed', b => ({ [P]: swap(b[P], "  if ((people || []).some(function(p) { return p.name.toLowerCase() === n.toLowerCase(); })) return n + ' is already listed';\n", "") }), NODE],
  ['ambiguous letters in codes', b => ({ [P]: swap(b[P], "var PEOPLE_CODE_ALPHABET_ = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';", "var PEOPLE_CODE_ALPHABET_ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';") }), NODE],
  ['a sync overwrites ticks', b => ({ [P]: swap(b[P], "    if (!c || !c.id || ids[c.id]) return;", "    if (!c || !c.id) return;") }), NODE],
  ['a new person starts unticked', b => ({ [P]: swap(b[P], "r.push(i === 0 ? n : i === 1 ? '' : true);", "r.push(i === 0 ? n : i === 1 ? '' : false);") }), NODE],
  ['FALSE as text is ticked', b => ({ [P]: swap(b[P], "return !(cell === false || String(cell).trim().toUpperCase() === 'FALSE');", "return cell !== false;") }), NODE],
  ['the owner can lock itself out', b => ({ [P]: swap(b[P], " && !(owner && PEOPLE_OWNER_KEEPS_.indexOf(id) !== -1)", "") }), NODE],
  ['People & access shown to everyone', b => ({ [P]: swap(b[P], "  if (!who.owner) a.hidden = a.hidden.concat(PEOPLE_OWNER_KEEPS_.slice(1));", "") }), NODE],
  ['malformed ids accepted', b => ({ [P]: swap(b[P], "return c && /^(full|lite):[a-z_]+(\\/[a-z_]+)?$/.test(String(c.id || ''));", "return c && c.id;") }), NODE],
  ['checkboxes over the whole tab', b => ({ [P]: swap(b[P], "sh.getRange(3, 4, v.length - 2, v[0].length - 3).insertCheckboxes();", "sh.getRange(1, 1, v.length, v[0].length).insertCheckboxes();") }), NODE],
  ['Slack’s token ignored', b => ({ [P]: swap(b[P], "  return slackPostToken_(e, body) === want;", "  return true;") }), NODE],
  ['Slack form posts unchecked', b => ({ [W]: swap(b[W], "    if (!slackPostOk_(e, null)) return errOut_('Unauthorized', 401);\n", "") }), NODE],
  ['the old token check is back', b => ({ [W]: swap(b[W], "  return !!veraIdentify_(token);", "  return token === getWebToken_();") }), NODE],
  ['the menus don’t hide anything', both("return by[id]&&veraCan_(name+'/'+id);", "return by[id];"), NODE],
  ['the full tab bar unfiltered', b => ({ [APP]: swap(b[APP], "VERA_MAIN_TABS.map(t=>t.id).filter(tab=>veraCan_(tab)).map(tab=>", "VERA_MAIN_TABS.map(t=>t.id).map(tab=>") }), NODE],
  ['a lite-view person stays on full', b => ({ [APP]: swap(b[APP], "if(d.view==='lite'&&!d.owner){window.location.replace('dashboard-lite.html');return;}", "") }), NODE],
  ['lite’s tab bar unfiltered', b => ({ [LITE]: swap(b[LITE], "{TOP_TABS.filter(tab => veraCan_(tab.id)).map(tab => (", "{TOP_TABS.map(tab => (") }), NODE],
  ['the panel shows the owner a sign-out', withIndex(b => ({ [APP]: swap(b[APP], "!p.owner&&p.codes>0&&h(\"button\"", "p.codes>=0&&h(\"button\"") })), UI],
  ['the code never shown', withIndex(b => ({ [APP]: swap(b[APP], "setShown({name:r.name,code:r.code});});}},busy==='people_add'", "});}},busy==='people_add'") })), UI],
];
let allBit = true;
CONTROLS.forEach(([name, mut, test]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => { try { fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT, f)); } catch (e) {} });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', timeout: 280000, env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
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
