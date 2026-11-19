// Negative controls for test_checkins.js: undo ONE agreed detail of the check-ins and
// confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_ci');
const FILES = ['Slack.js', 'Notify.js', 'GymTracker.js', 'Reminders.js', 'Chat.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const T = 'test_checkins.js';
const CONTROLS = [
  ["the morning title is the old one", "Slack.js", "'\u2600\ufe0f *Morning.* How are you starting the day?'", "'\u2600\ufe0f *Morning Check-In* \u2014 3 quick taps:'"],
  ["labels are buttons again", "Slack.js", "blocks.push({ type: 'context', block_id: 'wellness_lbl_' + id, elements: [{ type: 'mrkdwn', text: '*' + label + '*' }] });", ""],
  ["mood is 1\u20135 again", "Slack.js", "row('mood', 'Mood', WELL_MOOD_);", "row('mood', 'Mood', [1, 2, 3, 4, 5].map(function(n) { return [n, String(n)]; }));"],
  ["a tap leaves the label behind", "Slack.js", "return (blocks || []).filter(function(b) { return b.block_id !== 'wellness_lbl_' + metric; }).map(", "return (blocks || []).map("],
  ["the evening count is dropped", "Slack.js", "(n > 0 ? ' You logged ' + n + ' movement break' + (n === 1 ? '' : 's') + '.' : '')", "''"],
  ["no Stretch button", "Slack.js", "      { type: 'button', text: { type: 'plain_text', text: '\ud83e\uddd8 Stretch' },       action_id: 'evening_move_stretch', value: 'stretch' },\n", ""],
  ["no tomorrow line", "Slack.js", "  if (ctx.extra) blocks.push(", "  if (false) blocks.push("],
  ["the old ids stop working", "Slack.js", "  evening_checkin_yes: 'gym', evening_checkin_walk: 'walk', evening_checkin_no: 'none' };", " };"],
  ["Gym marks any open session (the old bug)", "GymTracker.js", "var log = getGymLog_(), mine = log.filter(function(s) { return s.date === today; });", "var log = getGymLog_(), mine = log;"],
  ["a walk is added twice", "GymTracker.js", "} else if (type && !mine.some(", "} else if (type && ![].some("],
  ["the week starts on Sunday", "GymTracker.js", "back = (d.getDay() + 6) % 7;", "back = d.getDay();"],
  ["tomorrow includes all-day events", "Notify.js", "return !e.allDay && String(e.start || '').slice(0, 10) === tomorrowIso && e.title;", "return String(e.start || '').slice(0, 10) === tomorrowIso && e.title;"],
  ["paid bills still show", "Notify.js", "|| String(r[6] || '').trim() === month) return false;", ") return false;"],
  ["the evening gets no context", "Reminders.js", "sendEveningCheckinSlack_(typeof eveningContext_ === 'function' ? eveningContext_(now) : null);", "sendEveningCheckinSlack_(null);"],
  ["movement is plain text again", "Notify.js", "sendNudge_('movement_' + today + '_' + slot, 'Movement', m.text, 'movement', null, m.blocks);", "sendNudge_('movement_' + today + '_' + slot, 'Movement', m.text, 'movement');"],
  ["a tap doesn't move the next one out", "Notify.js", "  if (moveTooSoon_(mv0.tapAt, now.getTime())) return false;\n", ""],
  ["Skip is counted as Done", "Notify.js", "  if (how === 'done') mv.done = (mv.done || 0) + 1;", "  mv.done = (mv.done || 0) + 1;"],
  ["no Next one line", "Notify.js", "(after.length ? 'Next one around ' + moveClock_(after[0]) + '.' : 'That\\u2019s the last one today.')", "''"],
  ["the live handler ignores Done", "Slack.js", "    } else if (actionId === 'move_done' || actionId === 'move_skip') {", "    } else if (false) {"],
  ["a question is logged as a workout", "GymTracker.js", "  if (/\\?/.test(t) || /^(what|how|when|why|where|who|can|could|should|would|will|do|does|did i|is|are|was|tell|show|remind|add|please)\\b/.test(t)) return null;", ""],
  ["a bare no counts as not today", "GymTracker.js", "  if (/^(not today|skipped( (it|today))?", "  if (/^(no|not today|skipped( (it|today))?"],
  ["the workout word can come anywhere", "GymTracker.js", "if (EVENING_TYPED_WORDS_[i][1].test(lead)) { type = EVENING_TYPED_WORDS_[i][0]; break; }", "if (words.some(function(w) { return EVENING_TYPED_WORDS_[i][1].test(w); })) { type = EVENING_TYPED_WORDS_[i][0]; break; }"],
  ["'in 30 min' is read as details", "GymTracker.js", "if (minutes !== null && /^\\d/.test(String(text).trim())) return { kind: 'details'", "if (minutes !== null) return { kind: 'details'"],
  ["typed answers before tonight's check-in", "GymTracker.js", "  try { if (!wasRecentlySent_('mobility_' + today, 1440)) return null; } catch (e) { return null; }", ""],
  ["the minutes aren't saved", "GymTracker.js", "      if (p.minutes) sheet.getRange(row.rowNum, WK_MIN_COL_).setValue(p.minutes);", ""],
  ["chat never asks", "Chat.js", "    var moveAnswer = typeof eveningTypedAnswer_ === 'function' ? eveningTypedAnswer_(trimmedMsg, new Date()) : null;", "    var moveAnswer = null;"],
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
