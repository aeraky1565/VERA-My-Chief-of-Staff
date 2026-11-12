// Negative controls for #vera-act-now: revert ONE rule at a time and confirm
// test_actnow.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_actnow');
const FILES = ['Slack.js', 'Code.js', 'WebApp.js', 'Aria.js', 'docs/app.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const CONTROLS = [
  ['act-now has no channel of its own', b => ({ 'Slack.js': swap(b['Slack.js'], "    'act-now':     'SLACK_ACT_NOW_CHANNEL_ID',\n", "") })],
  ['no fallback: posts are lost until the ID is set', b => ({ 'Slack.js': swap(b['Slack.js'], "    if (!id) id = props.getProperty(map.notifications) || '';\n", "") })],
  ['the Config tab is not read', b => ({ 'Slack.js': swap(b['Slack.js'], "(getConfigValues() || {})['slack_act_now_channel_id']", "({})['slack_act_now_channel_id']") })],
  ['any Config text is taken as the ID', b => ({ 'Slack.js': swap(b['Slack.js'], "    if (!/^[CG][A-Z0-9]{6,}$/.test(id)) id = '';\n", "") })],
  ['every channel falls back', b => ({ 'Slack.js': swap(b['Slack.js'], "if (!id && short === 'act-now') {", "if (!id) {") })],
  ['Book now stays in #vera-notifications', b => ({ 'Code.js': swap(b['Code.js'], "channel: 'vera-act-now',       description: 'ARIA says", "channel: 'vera-notifications', description: 'ARIA says") })],
  ['the picker doesn\'t offer it', b => ({ 'docs/app.js': swap(b['docs/app.js'], "{value:'vera-act-now',label:'#vera-act-now'},", "") })],
  ['the server refuses it', b => ({ 'WebApp.js': swap(b['WebApp.js'], "'vera-notifications', 'vera-act-now', 'vera-logs'", "'vera-notifications', 'vera-logs'") })],
];
let allBit = true;
CONTROLS.forEach(([name, mut]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const r = cp.spawnSync('node', ['test_actnow.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name);
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
