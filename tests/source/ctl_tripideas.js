// Negative controls for Trip Ideas, stage 1 (TripIdeas.js and the shared
// TripIdeasView block): revert ONE rule at a time and confirm test_tripideas.js
// catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tideas');

const FILES = ['TripIdeas.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const T = 'TripIdeas.js', W = 'WebApp.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [L]: swap(b[L], from, to) });
const TEST = 'test_tripideas.js';

const CONTROLS = [
  ['an unknown mode drops the leg', b => ({ [T]: swap(b[T], "return { kind: 'move', mode: tiOneOf_(l.mode, TI_MODES_, 'other'),", "if (TI_MODES_.indexOf(l.mode) === -1) return null; return { kind: 'move', mode: l.mode,") })],
  ['a backwards nights range is kept', b => ({ [T]: swap(b[T], "if (lo != null && hi != null && lo > hi) { var t = lo; lo = hi; hi = t; }\n  var budget", "var budget") })],
  ['a backwards cost range is kept', b => ({ [T]: swap(b[T], "    if (lo > hi) { var t = lo; lo = hi; hi = t; }\n    out[k]", "    out[k]") })],
  ['an empty cost category is stored as zero', b => ({ [T]: swap(b[T], "    if (lo == null && hi == null) return;\n", "    if (lo == null && hi == null) { lo = 0; hi = 0; }\n") })],
  ['saving an idea always appends', b => ({ [T]: swap(b[T], "    var row = idea.id ? tiRowOf_(sheet, w, idea.id) : -1;\n    if (idea.id && row === -1)", "    var row = -1;\n    if (false)") })],
  ['an option for a missing idea is accepted', b => ({ [T]: swap(b[T], "    if (tiRowOf_(tiIdeasSheet_(), TRIP_IDEAS_HEADERS.length, opt.ideaId) === -1) return { ok: false, error: 'That idea no longer exists' };\n", '') })],
  ['deleting an idea leaves its options', b => ({ [T]: swap(b[T], "      if (String(rows[k][1]).trim() === id) { os.deleteRow(k + 2); removed++; }", "      if (false) { os.deleteRow(k + 2); removed++; }") })],
  ['a repeated mode reads twice', both("if(w!==prev)out.push(w);prev=w;", "out.push(w);prev=w;")],
  ['within the budget only needs the low end', both("if(total.high<=b)return 'within';", "if(total.low<=b)return 'within';")],
  ['a card counts ruled-out options', both("return o.ideaId===idea.id&&o.flag!=='out';});", "return o.ideaId===idea.id;});")],
  ['months across a year lose the year', both("var oneYear=ms[0].slice(0,4)===ms[ms.length-1].slice(0,4);", "var oneYear=true;")],
  ['any truthy vera marks a leg as VERA\'s', b => ({ [T]: swap(b[T], "note: tiStr_(l.note, 120), vera: l.vera === true, piece: tiOneOf_(l.piece, TI_PIECE_KINDS_, '') } : null;", "note: tiStr_(l.note, 120), vera: !!l.vera, piece: tiOneOf_(l.piece, TI_PIECE_KINDS_, '') } : null;") })],
  ['either/or pieces lose their slot', b => ({ [T]: swap(b[T], "group: kind === 'choice' ? (tiStr_(p.group, 60) || 'Choice') : '',", "group: '',") })],
  ['anchors are not required in every option', b => ({ [T]: swap(b[T], "out.push('Anchors (must be in every option):');", "out.push('Anchors:');") })],
  ['an option with no route is saved', b => ({ [T]: swap(b[T], "return c.name && c.legs.length ? c : null;", "return c.name ? c : null;") })],
  ['VERA can build any number of options', b => ({ [T]: swap(b[T], "}).filter(Boolean).slice(0, TI_ASK_MAX_);\n  return { options: options,", "}).filter(Boolean);\n  return { options: options,") })],
  ['a retried ask builds again', b => ({ [T]: swap(b[T], "  if (!askId) return tiAsk_(body);\n", "  return tiAsk_(body);\n") })],
  ['a built "also possible" stays on the list', b => ({ [T]: swap(b[T], "var also = focus ? (idea.alsoPossible || []).filter(function(a) { return a.name !== focus; }) : got.alsoPossible;", "var also = focus ? (idea.alsoPossible || []) : got.alsoPossible;") })],
  ['the ask route is missing', b => ({ [W]: swap(b[W], "      case 'trip_idea_ask':              return jsonOut_(webAskVeraTripIdea_(body));\n", '') })],
  ['the plan forgets the wishes', both("if(k.wish.length)bits.push(", "if(false)bits.push(")],
  ['lite drifts from the full block', b => ({ [L]: swap(b[L], "function tiMoney_(n){n=Number(n)||0;", "function tiMoney_(n){n=Number(n)||1;") })],
  ['the save route is missing', b => ({ [W]: swap(b[W], "      case 'trip_idea_save':             return jsonOut_(webSaveTripIdea_(body));\n", '') })],
  ['Trip Ideas is not in the full Travel menu', b => ({ [A]: swap(b[A], "const subTabs=[{id:'ideas',label:'💡 Trip Ideas',", "const subTabs=[{id:'ideas_off',label:'💡 Trip Ideas',") })],
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
