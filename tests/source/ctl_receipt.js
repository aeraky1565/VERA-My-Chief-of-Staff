// Negative controls for "Done shopping" receipts (Pantry.js readReceipt_, receiptClean_,
// receiptLog_; WebApp.js webReceiptScan_): revert ONE rule at a time and confirm
// test_receipt.js catches it. Node only, so these run in CI's controls job too.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_rcpt');

const FILES = ['Pantry.js', 'WebApp.js', 'Code.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const P = 'Pantry.js', W = 'WebApp.js';
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });

const CONTROLS = [
  ['a made-up match is kept', one(P, "var match = allowed[String(x.match || '').trim().toLowerCase()] || '';", "var match = String(x.match || '').trim();")],
  ['a huge photo is sent anyway', one(P, "  if (b64.length > RECEIPT_MAX_B64_) throw new Error('That photo is too large — try again closer to the receipt.');\n", "")],
  ['any file type is sent', one(P, "  if (RECEIPT_MIMES_.indexOf(mime) === -1) throw new Error('That file isn’t a photo.');\n", "")],
  ['a failed call is read as empty', one(P, "  if (resp.getResponseCode() !== 200) throw new Error('Couldn’t read the receipt right now (HTTP ' + resp.getResponseCode() + ').');\n", "")],
  ['another store\'s check-off is filled', one(P, " && String(c[7] || '').trim() === store\n            && String(c[9]", "\n            && String(c[9]")],
  ['last week\'s check-off is filled', one(P, "if (day === today && String(c[2] || '').trim() === x.norm", "if (String(c[2] || '').trim() === x.norm")],
  ['a priced row is overwritten', one(P, " && (c[8] === '' || c[8] === null)) {", ") {")],
  ['the price is not filled in', one(P, "          if (x.price !== null) sh.getRange(i + 2, 9).setValue(x.price);\n", "")],
  ['receipt rows are marked as check-offs', one(P, "if (fresh.length) logPurchaseItems_(fresh, 'receipt');", "if (fresh.length) logPurchaseItems_(fresh, 'checkout');")],
  ['VERA\'s markers stay on a picked line', one(P, "    var name = String((x && x.name) || '').replace(/^🤖\\s*/, '').replace(/\\s*\\(est\\..*?\\)$/, '').trim();", "    var name = String((x && x.name) || '').trim();")],
  ['no lock', one(P, "  if (!lock.tryLock(10000)) throw new Error('Purchase History is busy — try again.');\n", "")],
  ['the scan sends the list with VERA\'s markers', one(W, "String(i.text || '').replace(/^🤖\\s*/, '').replace(/\\s*\\(est\\..*?\\)$/, '').trim(); }).filter(String);", "String(i.text || '').trim(); }).filter(String);")],
  ['an empty save reaches the sheet', one(W, "  if (!Array.isArray(b.items) || !b.items.length) return { ok: false, error: 'No items picked.' };\n", "")],
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
  const r = cp.spawnSync('node', ['test_receipt.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name);
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
