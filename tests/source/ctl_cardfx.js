// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The ones that matter most restore a permissive default — a card offered for spending
// abroad on an assumption rather than a tick — because that is the failure with a price
// attached.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_cfx');
const EXTRA = ['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'];
const ROOT_JS = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
ROOT_JS.concat(EXTRA).forEach(f => {
  const p = path.join(SRC_DIR, f);
  if (fs.existsSync(p)) BASE[f] = fs.readFileSync(p, 'utf8');
});

// docs/app.js is minified and dashboard-lite.html is not, so most mutations have to be
// applied to each in its own spelling. Where a control should hold for both, it patches
// both — a derived row that works in one copy only is half shipped.
const CONTROLS = {
  // ---- the permissive default, which is the expensive mistake ---------------
  'blank reads as fee-free (every unmarked card is offered abroad)': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "noFxFee:         String(r[13] == null ? '' : r[13]).trim().toLowerCase() === 'yes',",
      "noFxFee:         String(r[13] == null ? '' : r[13]).trim().toLowerCase() !== 'no',"),
  }),
  'the flag defaults to Yes the way active does': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "noFxFee:         String(r[13] == null ? '' : r[13]).trim().toLowerCase() === 'yes',",
      "noFxFee:         String(r[13] || 'Yes').trim().toLowerCase() === 'yes',"),
  }),
  // Dropped rather than kept green: String(undefined) is "undefined", not NaN, so
  // removing the `== null` guard changes nothing for a string comparison and the
  // mutation was a non-difference. The guard still reads better beside creditLimit,
  // which IS a Number and does go NaN — but a control that cannot fail proves nothing.
  'the flag is not trimmed': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "String(r[13] == null ? '' : r[13]).trim().toLowerCase() === 'yes'",
      "String(r[13] == null ? '' : r[13]).toLowerCase() === 'yes'"),
  }),
  'the flag is case-sensitive': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "String(r[13] == null ? '' : r[13]).trim().toLowerCase() === 'yes'",
      "String(r[13] == null ? '' : r[13]).trim() === 'Yes'"),
  }),
  'the fee filter is dropped (fee-charging cards are offered)': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "return c.active==='Yes'&&c.noFxFee;", "return c.active==='Yes';"),
  }),
  'the active filter is dropped from the derived row': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "return c.active==='Yes'&&c.noFxFee;", "return c.noFxFee;"),
  }),

  // ---- the ranking ---------------------------------------------------------
  'it ranks on the best rate in ANY category': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "if(!GENERAL_SPEND_CATS[r.category])return;", ""),
  }),
  'Everything Else stops counting as general spend': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "var GENERAL_SPEND_CATS={'General Spend':1,'Everything Else':1};",
      "var GENERAL_SPEND_CATS={'General Spend':1};"),
  }),
  'it keeps the WORST general rate instead of the best': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "if(!best||parseFloat(r.rate)>parseFloat(best.rate))best=r;",
      "if(!best||parseFloat(r.rate)<parseFloat(best.rate))best=r;"),
  }),
  'unrated cards sort first instead of last': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "if(isNaN(ar))return 1;if(isNaN(br))return -1;return br-ar;",
      "if(isNaN(ar))return -1;if(isNaN(br))return 1;return br-ar;"),
  }),
  'two unrated cards keep an unstable order': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "if(isNaN(ar)&&isNaN(br))return a.cardName.localeCompare(b.cardName);",
      "if(isNaN(ar)&&isNaN(br))return 0;"),
  }),
  'a fee-free card with no general rate is dropped': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      ":{cardName:c.cardName,rate:'',rateType:'',conditions:''};})",
      ":null;}).filter(function(x){return !!x;})"),
  }),
  'the row shows more than the top 2': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "result.push({category:'International Travel',top:intl.slice(0,2)});",
      "result.push({category:'International Travel',top:intl});"),
  }),

  // ---- the empty case ------------------------------------------------------
  'an empty row is pushed when nothing is marked': b => ({
    'docs/app.js': b['docs/app.js'].replace("if(intl.length){", "if(true){"),
  }),

  // ---- the collision guard -------------------------------------------------
  'the derived row is pushed even when a typed one exists': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "if(existing){existing.top=existing.top.concat(intl).slice(0,2);}\nelse{",
      "if(false){existing.top=existing.top.concat(intl).slice(0,2);}\nelse{")
      .replace("if(existing){existing.top=existing.top.concat(intl).slice(0,2);}else{",
               "if(false){existing.top=existing.top.concat(intl).slice(0,2);}else{"),
  }),

  // ---- sorting -------------------------------------------------------------
  'the derived row is appended without re-sorting': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "result.sort(function(a,b){return a.category.localeCompare(b.category);});}", "}"),
  }),

  // ---- the label helper ----------------------------------------------------
  'the label does not degrade, so an unrated card renders "(  )"': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "function cheatLabel(r){var s=r.rate?(r.cardName+' ('+r.rate+' '+r.rateType+')'):r.cardName;",
      "function cheatLabel(r){var s=r.cardName+' ('+r.rate+' '+r.rateType+')';"),
    'docs/dashboard-lite.html': b['docs/dashboard-lite.html'].replace(
      "  var s = r.rate ? (r.cardName + ' (' + r.rate + ' ' + r.rateType + ')') : r.cardName;",
      "  var s = r.cardName + ' (' + r.rate + ' ' + r.rateType + ')';"),
  }),
  'the Copy button goes back to its own copy of the label': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "var cardStrs=row.top.map(cheatLabel).join(' / ');",
      "var cardStrs=row.top.map(function(r){var s=r.cardName+' ('+r.rate+' '+r.rateType+')';if(r.conditions)s+=' | '+r.conditions;return s;}).join(' / ');"),
  }),
  'the panel goes back to its own copy of the label': b => ({
    'docs/dashboard-lite.html': b['docs/dashboard-lite.html'].replace(
      "                        var label = cheatLabel(r);",
      "                        var label = r.cardName + ' (' + r.rate + ' ' + r.rateType + ')';\n                        if (r.conditions) label += ' | ' + r.conditions;"),
  }),
  'conditions stop being appended': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "if(r.conditions)s+=' | '+r.conditions;return s;}", "return s;}"),
  }),

  // ---- the column ----------------------------------------------------------
  'the header is removed': b => ({
    'Code.js': b['Code.js'].replace(", 'No FX Fee'];", "];"),
  }),
  'the header moves, leaving the read index behind': b => ({
    'Code.js': b['Code.js'].replace(
      "'Notes', 'Credit Limit', 'No FX Fee'];", "'Notes', 'No FX Fee', 'Credit Limit'];"),
  }),
  'the colMap index is off by one (the flag writes into Notes)': b => ({
    'WebApp.js': b['WebApp.js'].replace('creditLimit:13, noFxFee:14 }',
                                        'creditLimit:13, noFxFee:12 }'),
  }),
  'the colMap entry is missing, so the field is never written': b => ({
    'WebApp.js': b['WebApp.js'].replace('creditLimit:13, noFxFee:14 }', 'creditLimit:13 }'),
  }),
  'webAddCard_ stops writing the column': b => ({
    'WebApp.js': b['WebApp.js'].replace("    (p.noFxFee         || '').trim(),\n", ''),
  }),

  // ---- the two representations meeting -------------------------------------
  'the modal stops converting the boolean, so editing clears the flag': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      ",card,{noFxFee:(card&&card.noFxFee)?'Yes':'No'})", ",card)"),
    'docs/dashboard-lite.html': b['docs/dashboard-lite.html'].replace(
      "    ? Object.assign({}, blank, card, { noFxFee: (card && card.noFxFee) ? 'Yes' : 'No' })",
      "    ? Object.assign({}, blank, card)"),
  }),

  // ---- the second dashboard -------------------------------------------------
  'only the main dashboard gets the row': b => ({
    'docs/dashboard-lite.html': b['docs/dashboard-lite.html'].replace(
      "var GENERAL_SPEND_CATS = { 'General Spend': 1, 'Everything Else': 1 };",
      "var GENERAL_SPEND_CATS_UNUSED = { 'General Spend': 1 };"),
  }),
  'only the main dashboard gets the icon': b => ({
    'docs/dashboard-lite.html': b['docs/dashboard-lite.html'].replace(
      "  'International Travel': '🌍',\n", ''),
  }),
  'only the lite dashboard badges fee-free cards': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      'c.noFxFee&&/*#__PURE__*/React.createElement("span",{title:"No foreign transaction fee',
      'false&&/*#__PURE__*/React.createElement("span",{title:"No foreign transaction fee'),
  }),
  'index.html is not rebuilt from app.js': b => ({
    'docs/index.html': b['docs/index.html'].replace(/GENERAL_SPEND_CATS/g, 'STALE_BUNDLE'),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true });
  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });

  const r = cp.spawnSync('node', ['test_cardfx.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
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
