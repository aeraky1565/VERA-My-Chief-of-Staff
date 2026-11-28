// Negative controls for test_slackcompact.js: undo ONE detail of the compact Slack layout
// and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_sc');
const FILES = ['Slack.js', 'Notify.js', 'Aria.js', 'Reminders.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const T = 'test_slackcompact.js';
const CONTROLS = [
  ["messages go out uncompacted", "Slack.js", "  if (blocks)   payload.blocks    = slackCompact_(blocks);", "  if (blocks)   payload.blocks    = blocks;"],
  ["the morning check-in goes out uncompacted", "Slack.js", "blocks: slackCompact_(blocks) }),", "blocks: blocks }),"],
  ["choices stay as buttons", "Slack.js", "var plain = els.length >= 3 && els.every(", "var plain = false && els.every("],
  ["the label stays its own line", "Slack.js", "if (label != null) out[out.length - 1] = { type: 'section', block_id: b.block_id,", "if (false) out[out.length - 1] = { type: 'section', block_id: b.block_id,"],
  ["every dropdown shares one id", "Slack.js", "action_id: 'vera_pick_' + (b.block_id || i)", "action_id: 'vera_pick'"],
  ["a pick loses its button", "Slack.js", "value: (String(e.action_id || '') + SLACK_PICK_SEP_ + String(e.value == null ? '' : e.value)).slice(0, 150) };", "value: String(e.value == null ? '' : e.value).slice(0, 150) };"],
  ["picks aren't read back", "Slack.js", "if (k > 0) { a.action_id = v.slice(0, k); a.value = v.slice(k + SLACK_PICK_SEP_.length); }", ""],
  ["the handler ignores picks", "Slack.js", "var payload = slackNormalizeAction_(JSON.parse(payloadStr));", "var payload = JSON.parse(payloadStr);"],
  ["the footer isn't used for the rest", "Slack.js", "    if (foot != null) i++;\n", "    foot = null;\n"],
  ["two left over stay buttons", "Slack.js", "var more = rest.length === 1 ? rest[0]", "var more = rest.length ? rest[0]"],
  ["the original blocks are changed", "Slack.js", "var src = JSON.parse(JSON.stringify(blocks)), out = [];", "var src = blocks, out = [];"],
  ["Done stays after the movement tap", "Slack.js", "  return slackNoControls_(blocks).map(function(b) {\n    return b.block_id === 'move_row' ?", "  return (blocks || []).map(function(b) {\n    return b.block_id === 'move_row' ?"],
  ["the dropdown line loses its id", "Slack.js", "out.push({ type: 'section', block_id: b.block_id, text: { type: 'mrkdwn', text: '_Pick one_' }, accessory: pick });", "out.push({ type: 'section', text: { type: 'mrkdwn', text: '_Pick one_' }, accessory: pick });"],
  ["Remind me stays in the menu", "Notify.js", "var opts = acc.options.filter(function(o) { return String(o.value || '').indexOf('act_remind::') !== 0; });", "var opts = acc.options;"],
  ["a menu of one stays a menu", "Notify.js", "        else if (opts.length === 1) {", "        else if (false) {"],
  ["a lone Remind me stays", "Notify.js", "      if (acc.action_id === 'act_remind') delete c.accessory;", "      if (false) delete c.accessory;"],
].map(c => [c[0], b => ({ [c[1]]: swap(b[c[1]], c[2], c[3]) }), T]);

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0], test = c[2];
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
  const env = Object.assign({}, process.env, { VERA_ROOT: OUT });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
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
