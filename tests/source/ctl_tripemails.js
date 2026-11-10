// Negative controls for the Trip emails (TripEmails.js, TsTripPeople and TripEmailsPanel, issue #233):
// revert ONE rule at a time and confirm test_tripemails.js (server) or test_tripemails_ui.js (screen) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tripemails_out');

const FILES = ['TripEmails.js', 'TravelDayBriefing.js', 'Trips.js', 'TripReadiness.js', 'Mailer.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const UI = 'test_tripemails_ui.js', SRV = 'test_tripemails.js', S = 'TripEmails.js';
const srv = (from, to) => b => ({ [S]: swap(b[S], from, to) });

const W = 'WebApp.js', T = 'TravelDayBriefing.js', R = 'TripReadiness.js';
const CONTROLS = [
  ['an old "Both" is only you', srv("if (/^both$/i.test(v)) return [TE_OWNER_, TE_PARTNER_];", "if (/^both$/i.test(v)) return [TE_OWNER_];"), SRV],
  ['travellers are emailed without a switch', srv("var on = tokens.some(function(x) { return teSame_(x, t); });", 'var on = true;'), SRV],
  ['Victoria’s solo trip still emails', srv("if (!youTravel) return { solo: true, list: list, to: [] };", ''), SRV],
  ['her address isn’t from Config', srv("var email = teSame_(t, TE_PARTNER_) ? (o.partnerEmail || '') :", "var email = teSame_(t, TE_PARTNER_) ? '' :"), SRV],
  ['her typed address doesn’t switch her on', srv("if (hit) { hit.on = true; return; }", "if (hit) return;"), SRV],
  ['added addresses are dropped', srv("    list.push({ name: t, email: t, source: 'added', on: true });\n", ''), SRV],
  ['an address goes twice', srv("&& !to.some(function(e) { return teSame_(e, x.email); })) to.push", ") to.push"), SRV],
  ['a bad address is kept', srv("if (teEmailOk_(t)) { if (!out.some(function(x) { return teSame_(x, t); })) out.push(t); } else bad.push(t); return;", 'out.push(t); return;'), SRV],
  ['you can be switched like a guest', srv("if (n && !teSame_(n, TE_OWNER_) && !out.some", "if (n && !out.some"), SRV],
  ['your address reaches the screen', srv("email: x.source === 'added' ? x.email : '',", 'email: x.email,'), SRV],
  ['cancelled trips are listed', srv("&& !/cancel|merged|deleted|archived/i.test(t.status || '')", ''), SRV],
  ['the shared list is offered forever', srv("var legacy = PropertiesService.getScriptProperties().getProperty(TE_LEGACY_PROP_) ? [] :", 'var legacy = false ? [] :'), SRV],
  ['Add to all includes her solo trips', srv("if (travellers.length && !travellers.some(function(x) { return teSame_(x, TE_OWNER_); })) return;", ''), SRV],
  ['the send ignores the per-trip list', b => ({ [T]: swap(b[T], "try { return teRecipientsFor_(tripKey); }", "try { return [CONFIG.MORNING_NUDGE_EMAIL]; }") }), SRV],
  ['everyone goes in To again', b => ({ [T]: swap(b[T], "var mailTo = recipients[0] || CONFIG.MORNING_NUDGE_EMAIL, mailBcc = recipients.slice(1);", "var mailTo = recipients.join(','), mailBcc = [];") }), SRV],
  ['readiness covers everyone again', b => ({ [R]: swap(b[R], "  if (going.length) items = items.filter(", "  if (false) items = items.filter(") }), SRV],
  ['the editor forgets who’s switched on', both("var tokens=others.filter(function(n){return on[n.toLowerCase()];}).concat(added);", 'var tokens=added;')],
  ['a half address is accepted', both("if(!teEmailOk_c(email)){setErr('That doesn’t look like a full email address. Check the part after the @.');return false;}", '')],
  ['the Address Book offers people with no email', both("var ok=teEmailOk_c(p.email);", 'var ok=true;')],
  ['the chips don’t show who’s off', both("x.name+(x.on?'':' · off')", 'x.name')],
  ['the trip summary has no box', both("    h(TsTripPeople,{trip:trip,apiUrl:props.apiUrl,apiToken:props.apiToken,card:card,label:label}),\n", '')],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
const ONLY = process.env.CTL_ONLY;
CONTROLS.forEach(function(c) {
  if (ONLY && c[0] !== ONLY) return;
  const name = c[0];
  if (!HAS_BROWSER && (c[2] || UI) === UI) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const r = cp.spawnSync('node', [c[2] || UI], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + (c[2] || UI) + ')');
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
