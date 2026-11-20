// ============================================================
// VERA — FlagQuiet.js (#258)
// Keeps a resolved topic quiet, so the nightly flags don't raise it again the next
// night under a new name ("friendsgiving_prep", then "friendsgiving_contribution").
//
//   • Resolving a flag keeps its topic quiet until the flag's date passes (its Due,
//     else the latest date its words name), or for 7 days when it names none.
//   • "Don't raise this again" mutes a topic for good, until it's unmuted.
//   • A topic is its telling words: the ones that rarely appear in the Flags tab
//     ("Friendsgiving", "Costco", "Dunkin"), never the everyday ones ("AMEX", "task").
//   • Each night, before Claude's flags are written, any that share a topic with an
//     open flag, a quiet one or a muted one is held back, and listed on Flags.
//   • An automatic flag (a nightly check's) resolved by hand isn't reopened while
//     it's quiet; once its check stops raising it, the quiet ends, so it can come back
//     when the situation changes.
// Its tab, "Flag Quiet", is VERA's own: one row per resolved or muted topic.
// ============================================================

var FQ_TAB_ = 'Flag Quiet';
var FQ_HEADERS_ = ['Flag ID', 'Key', 'Title', 'Title Words', 'Words', 'Until', 'Kind', 'Since'];
var FQ_C_ = { ID: 0, KEY: 1, TITLE: 2, TW: 3, W: 4, UNTIL: 5, KIND: 6, SINCE: 7 };
var FQ_DAYS_ = 7;            // quiet for a flag that names no date
var FQ_HORIZON_ = 120;       // a Due further out than this isn't the flag's own
var FQ_NAMED_ = 30;          // nor a date named in its words further out than this
var FQ_LOOKBACK_ = 21;       // days of flags Claude is shown
var FQ_HELD_KEY_ = 'FLAGS_HELD';
var FQ_NEVER_ = 'never';
var FQ_STOP_ = ('about above after again also amex announced another anything around because been before being below between both bring check '
  + 'confirm could daily date dates days does doing done down during each either else even every expires expiring flag flags from good have '
  + 'here into just keep know last later like long look made make many more most much need needed needs never next none note now only open '
  + 'other over past plan planned plans please point ready really reminder right same should since some soon start still such sure take than '
  + 'that their them then there these they thing things this those through time today tomorrow too trip trips under until upcoming very want '
  + 'week weeks well were what when where which while will with within without would year years your ahmed victoria task tasks today’s '
  + 'monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december '
  + 'item items whether worth already left away home verify normalize review audit spike spiked logistics departure departs depart packing itinerary '
  + 'schedule prep payment payments unpaid paid bill bills card cards call calls deadline overdue neglected stalling goal goals recurring weekend '
  + 'visit book booked booking confirmed missing missed gift gifts idea ideas birthday event events deposit funds plan\u2019s').split(/\s+/).reduce(function(m, w) { m[w] = true; return m; }, {});
var FQ_MON_ = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** Pure: a text's words, lower-case, 4+ letters, everyday words left out, each once. */
function fqTokens_(s) {
  var seen = {}, out = [];
  String(s == null ? '' : s).toLowerCase().replace(/[’']s\b/g, '').replace(/[’']/g, '').split(/[^a-z]+/).forEach(function(w) {
    if (w.length < 4 || FQ_STOP_[w] || seen[w]) return;
    seen[w] = true; out.push(w);
  });
  return out;
}

/** Pure: how many flags each word appears in, from [[title, reason], …]. */
function fqDocFreq_(rows) {
  var df = {};
  (rows || []).forEach(function(r) {
    fqTokens_(String(r[0] || '') + ' ' + String(r[1] || '')).forEach(function(w) { df[w] = (df[w] || 0) + 1; });
  });
  return df;
}

/** Pure: the most flags a word can be in and still tell a topic apart. */
function fqRareMax_(n) { return Math.max(3, Math.ceil((n || 0) * 0.03)); }

/** Pure: a flag's topic → {title: rare words of its title, all: rare words of title and reason}. */
function fqTopic_(title, reason, df, n) {
  var max = fqRareMax_(n), rare = function(w) { return ((df || {})[w] || 0) <= max; };
  var t = fqTokens_(title).filter(rare).slice(0, 5);
  var all = fqTokens_(String(title || '') + ' ' + String(reason || '')).filter(rare).slice(0, 10);
  return { title: t, all: all };
}

/**
 * Pure: same topic? Two telling words in common, one of them in both titles; or three
 * in common, one of them in a title. One shared place name alone ("Florida") isn't enough.
 */
function fqSame_(a, b) {
  if (!a || !b) return false;
  var common = (a.all || []).filter(function(w) { return (b.all || []).indexOf(w) !== -1; });
  if (common.length < 2) return false;
  var inBoth = common.some(function(w) { return (a.title || []).indexOf(w) !== -1 && (b.title || []).indexOf(w) !== -1; });
  if (inBoth) return true;
  return common.length >= 3 && common.some(function(w) { return (a.title || []).indexOf(w) !== -1 || (b.title || []).indexOf(w) !== -1; });
}

/** Pure: 'yyyy-MM-dd' + n days. */
function fqAddDays_(iso, n) {
  var d = new Date(String(iso) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Pure: the dates a text names (2026-11-21, Nov 21, November 21st), as 'yyyy-MM-dd', near today. */
function fqDatesIn_(text, todayIso) {
  var s = String(text || ''), out = [], y = Number(String(todayIso).slice(0, 4));
  var iso = s.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  iso.forEach(function(d) { out.push(d); });
  var re = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi, m;
  while ((m = re.exec(s))) {
    var mon = FQ_MON_[m[1].toLowerCase().slice(0, m[1].toLowerCase().indexOf('sept') === 0 ? 4 : 3)];
    var day = Number(m[2]);
    if (mon == null || day < 1 || day > 31) continue;
    var d = new Date(Date.UTC(y, mon, day, 12));
    if (d.getUTCMonth() !== mon) continue;
    var iso2 = d.toISOString().slice(0, 10);
    if (iso2 < fqAddDays_(todayIso, -180)) iso2 = new Date(Date.UTC(y + 1, mon, day, 12)).toISOString().slice(0, 10);
    out.push(iso2);
  }
  return out;
}

/** Pure: how long a resolved flag stays quiet: its Due, else the latest date it names, else 7 days. */
function fqUntil_(flag, todayIso) {
  var horizon = fqAddDays_(todayIso, FQ_HORIZON_);
  var ok = function(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= todayIso && d <= horizon; };
  var due = String((flag && flag.due) || '');
  if (ok(due)) return due;
  var near = fqAddDays_(todayIso, FQ_NAMED_);
  var named = fqDatesIn_(String((flag && flag.flag) || '') + ' ' + String((flag && flag.reason) || ''), todayIso)
    .filter(function(d) { return ok(d) && d <= near; }).sort();
  if (named.length) return named[named.length - 1];
  return fqAddDays_(todayIso, FQ_DAYS_);
}

/** Pure: a quiet row still in force today? Muted ones always are. */
function fqActive_(q, todayIso) {
  var u = String((q && q.until) || '');
  return u === FQ_NEVER_ || (u !== '' && u >= todayIso);
}

/** Pure: a Flag Quiet row → object. */
function fqRowObj_(r) {
  var list = function(v) { return String(v || '').split(',').map(function(w) { return w.trim(); }).filter(Boolean); };
  var d = function(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v || '').trim(); };
  return { id: String(r[FQ_C_.ID] || ''), key: String(r[FQ_C_.KEY] || ''), title: String(r[FQ_C_.TITLE] || ''),
           topic: { title: list(r[FQ_C_.TW]), all: list(r[FQ_C_.W]) }, until: d(r[FQ_C_.UNTIL]),
           kind: String(r[FQ_C_.KIND] || ''), since: d(r[FQ_C_.SINCE]) };
}

/**
 * Pure: tonight's candidates → {keep, held}. A candidate is held when its topic is
 * that of an open flag, a muted one, or a resolved one still quiet. A candidate that
 * says what changed (`changed`) may come back to a resolved topic; never to a muted one.
 * ctx: {open:[{flag,reason,key,date,auto,source}], quiet:[rowObj], df, n, today}
 */
function fqHoldBack_(cands, ctx) {
  var df = ctx.df || {}, n = ctx.n || 0, today = ctx.today;
  var open = (ctx.open || []).map(function(o) { return { o: o, t: fqTopic_(o.flag, o.reason, df, n) }; });
  var quiet = (ctx.quiet || []).filter(function(q) { return fqActive_(q, today); });
  var keep = [], held = [];
  (cands || []).forEach(function(c) {
    var t = fqTopic_(c.flag, c.reason, df, n), why = '';
    var mute = quiet.filter(function(q) { return q.kind === 'muted' && fqSame_(t, q.topic); })[0];
    if (mute) why = 'You muted this topic on ' + mute.since + ': ' + mute.title;
    if (!why) {
      var hit = open.filter(function(x) { return fqSame_(t, x.t); })[0];
      if (hit) why = hit.o.auto ? 'VERA’s own check already has this open: ' + hit.o.flag
                                : 'Same topic as a flag still open since ' + (hit.o.date || 'earlier') + ': ' + hit.o.flag;
    }
    if (!why && !String(c.changed || '').trim()) {
      var q = quiet.filter(function(x) { return x.kind !== 'muted' && fqSame_(t, x.topic); })[0];
      if (q) why = 'Same topic as a flag you resolved ' + q.since + ' · quiet until ' + q.until + ': ' + q.title;
    }
    if (why) { held.push({ source: c.source || '', flag: c.flag || '', reason: c.reason || '', urgency: c.urgency || 'Low', key: c.key || '', due: c.due || '', why: why }); return; }
    var k = Object.assign({}, c);
    var ch = String(c.changed || '').trim();
    if (ch && String(k.reason || '').indexOf('What changed:') !== 0) k.reason = 'What changed: ' + ch + '. ' + (k.reason || '');
    keep.push(k);
    open.push({ o: { flag: k.flag, reason: k.reason, date: today, auto: false }, t: t });   // one per topic in a night
  });
  return { keep: keep, held: held };
}

/**
 * Pure: the RECENT FLAGS block for the nightly prompt: the last 3 weeks of flags with
 * their state, and the topics muted or quiet, so Claude reuses names and leaves them be.
 * rows: Flags rows; quiet: rowObjs.
 */
function fqPromptSection_(rows, quiet, todayIso) {
  var from = fqAddDays_(todayIso, -FQ_LOOKBACK_), byKey = {};
  (quiet || []).forEach(function(q) { if (q.key) byKey[q.key] = q; });
  var d = function(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10); };
  var lines = [];
  (rows || []).forEach(function(r) {
    var date = d(r[1]), key = String(r[9] || '').trim();
    if (!key || date < from) return;
    if (typeof flagAutoOf_ === 'function' && flagAutoOf_(key)) return;   // VERA's own checks: listed below as covered
    var resolved = String(r[8] || '').toLowerCase() === 'yes', q = byKey[key];
    var state = q && q.kind === 'muted' ? 'MUTED (never raise again)'
      : resolved ? 'resolved' + (q && fqActive_(q, todayIso) ? ', quiet until ' + q.until : '') : 'open';
    lines.push('- ' + key + ' · "' + String(r[3] || '').slice(0, 90) + '" · ' + state);
  });
  lines = lines.slice(-60);
  (quiet || []).forEach(function(q) {
    if (q.kind === 'muted' && !lines.some(function(l) { return l.indexOf('- ' + q.key + ' ') === 0; }))
      lines.push('- ' + (q.key || '(no key)') + ' · "' + q.title.slice(0, 90) + '" · MUTED (never raise again)');
  });
  return 'RECENT FLAGS (last ' + FQ_LOOKBACK_ + ' days, with what the user did):\n' + (lines.length ? lines.join('\n') : '- none') + '\n' +
    'RULES FOR REPEATS:\n' +
    '- If a flag above is about the same topic, reuse its key exactly. Never invent a new key for an old topic.\n' +
    '- Do NOT raise a topic that is resolved and quiet, or MUTED, or still open. The user has already seen it.\n' +
    '- Only if something has really changed since it was resolved (a new date, a missed deadline, a new fact), raise it with a NEW key and add "changed": "<what changed, in a few words>".\n' +
    '- Leave alone what VERA\'s own checks already cover: card perks and credits, gift ideas for important dates, chores and upkeep, ' +
    'vehicles, gym check-ins, prescriptions, FSA/HSA, food to use up, trip decisions, PTO, agents not running.\n\n';
}

// ---- Sheet ---------------------------------------------------------------

var _fqRows_ = null;

function fqSheet_() { return ensureSheet(getSpreadsheet(), FQ_TAB_, FQ_HEADERS_); }

/** Every Flag Quiet row, as objects with their row numbers (memoized per execution). */
function fqRows_() {
  if (_fqRows_) return _fqRows_;
  var sh = fqSheet_(), last = sh.getLastRow();
  var vals = last >= 2 ? sh.getRange(2, 1, last - 1, FQ_HEADERS_.length).getValues() : [];
  _fqRows_ = vals.map(function(r, i) { var o = fqRowObj_(r); o.row = i + 2; return o; });
  return _fqRows_;
}

function fqToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/** The flags read once for a topic: df over every flag ever written. */
function fqFlagRows_() {
  var sh = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, FLAG_HEADERS.length).getValues();
}

/** Writes a quiet row for a flag just resolved or muted. → its until. */
function fqRemember_(flagRow, kind) {
  var rows = fqFlagRows_(), df = fqDocFreq_(rows.map(function(r) { return [r[3], r[4]]; }));
  var flag = { flag: String(flagRow[3] || ''), reason: String(flagRow[4] || ''), due: typeof flagDueCell_ === 'function' ? flagDueCell_(flagRow[11]) : '' };
  var t = fqTopic_(flag.flag, flag.reason, df, rows.length), today = fqToday_();
  var until = kind === 'muted' ? FQ_NEVER_ : fqUntil_(flag, today);
  var id = String(flagRow[0] || '');
  var sh = fqSheet_();
  // One row per flag: resolving twice, or muting after resolving, replaces it.
  fqRows_().filter(function(q) { return q.id && q.id === id; }).map(function(q) { return q.row; })
    .sort(function(a, b) { return b - a; }).forEach(function(r) { sh.deleteRow(r); });
  sh.appendRow([id, String(flagRow[9] || ''), flag.flag, t.title.join(','), t.all.join(','), until, kind, today]);
  _fqRows_ = null;
  return until;
}

/** Is this key quiet tonight? (An automatic flag resolved or muted by hand.) */
function fqKeyQuiet_(key) {
  if (!key) return false;
  var today = fqToday_();
  return fqRows_().some(function(q) { return q.key === key && fqActive_(q, today); });
}

/** Ends the quiet of resolved keys whose check no longer raises them: the situation changed. Mutes stay. */
function fqClearKeys_(keys) {
  if (!keys || !keys.length) return 0;
  var set = {}; keys.forEach(function(k) { set[k] = true; });
  var gone = fqRows_().filter(function(q) { return q.kind !== 'muted' && set[q.key]; }).map(function(q) { return q.row; });
  if (!gone.length) return 0;
  var sh = fqSheet_();
  gone.sort(function(a, b) { return b - a; }).forEach(function(r) { sh.deleteRow(r); });
  _fqRows_ = null;
  return gone.length;
}

/** Drops rows whose quiet has ended. */
function fqPrune_() {
  var today = fqToday_();
  var gone = fqRows_().filter(function(q) { return !fqActive_(q, today); }).map(function(q) { return q.row; });
  if (!gone.length) return 0;
  var sh = fqSheet_();
  gone.sort(function(a, b) { return b - a; }).forEach(function(r) { sh.deleteRow(r); });
  _fqRows_ = null;
  return gone.length;
}

/** The nightly prompt's block, read from the sheets. '' if anything fails. */
function fqPromptBlock_() {
  try { return fqPromptSection_(fqFlagRows_(), fqRows_(), fqToday_()); }
  catch (e) { Logger.log('fqPromptBlock_: ' + e.message); return ''; }
}

/** Nightly, before Claude's flags are written: hold back the repeats, keep the list for Flags. → the flags to write. */
function flagHoldBackRun_(flags) {
  try {
    fqPrune_();
    var rows = fqFlagRows_(), today = fqToday_();
    var open = rows.filter(function(r) {
      return r[0] !== '' && String(r[8]).toLowerCase() !== 'yes';
    }).map(function(r) {
      return { flag: String(r[3] || ''), reason: String(r[4] || ''), key: String(r[9] || ''), date: r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[1] || ''),
               auto: typeof flagAutoOf_ === 'function' && !!flagAutoOf_(r[9]), source: String(r[2] || '') };
    });
    var out = fqHoldBack_(flags, { open: open, quiet: fqRows_(), df: fqDocFreq_(rows.map(function(r) { return [r[3], r[4]]; })), n: rows.length, today: today });
    veraStoreSet_(FQ_HELD_KEY_, JSON.stringify({ on: today, items: out.held.slice(0, 20) }));
    if (out.held.length) Logger.log('flagHoldBackRun_: held back ' + out.held.length + ': ' + out.held.map(function(h) { return h.key || h.flag; }).join(', '));
    return out.keep;
  } catch (e) {
    Logger.log('flagHoldBackRun_ (non-fatal, writing all): ' + e.message);
    return flags;
  }
}

// ---- Routes --------------------------------------------------------------

/** GET flags_quiet → {held, heldOn, muted, quiet}. */
function webFlagsQuiet_() {
  var held = { on: '', items: [] };
  try { var raw = veraStoreGet_(FQ_HELD_KEY_); if (raw) held = JSON.parse(raw); } catch (e) {}
  var today = fqToday_(), rows = fqRows_().filter(function(q) { return fqActive_(q, today); });
  var view = function(q) { return { id: q.id, key: q.key, title: q.title, until: q.until, since: q.since, words: q.topic.title.length ? q.topic.title : q.topic.all.slice(0, 3) }; };
  return { ok: true, heldOn: held.on || '', held: (held.items || []).map(function(h, i) { return Object.assign({ i: i }, h); }),
           muted: rows.filter(function(q) { return q.kind === 'muted'; }).map(view),
           quiet: rows.filter(function(q) { return q.kind !== 'muted'; }).map(view) };
}

/** POST flag_mute {id}: resolves the flag and never raises its topic again. */
function webFlagMute_(id) {
  var found = findFlagRow_(id);
  var row = found.sheet.getRange(found.rowNum, 1, 1, FLAG_HEADERS.length).getValues()[0];
  found.sheet.getRange(found.rowNum, 9).setValue('Yes');
  fqRemember_(row, 'muted');
  try { if (row[9]) recordFlagOutcome_(String(row[9]), 'resolved'); } catch (e) {}
  return { ok: true, id: id, action: 'muted' };
}

/** POST flag_unmute {id}: the topic can be raised again. */
function webFlagUnmute_(id) {
  if (!id) return { ok: false, error: 'Missing id' };
  var rows = fqRows_().filter(function(q) { return q.id === String(id) && q.kind === 'muted'; });
  if (!rows.length) return { ok: false, error: 'That topic isn’t muted' };
  var sh = fqSheet_();
  rows.map(function(q) { return q.row; }).sort(function(a, b) { return b - a; }).forEach(function(r) { sh.deleteRow(r); });
  _fqRows_ = null;
  return { ok: true, id: id, action: 'unmuted' };
}

/** POST flag_raise_held {i}: writes one held-back flag after all. */
function webFlagRaiseHeld_(i) {
  var held = { on: '', items: [] };
  try { held = JSON.parse(veraStoreGet_(FQ_HELD_KEY_) || '{"items":[]}'); } catch (e) {}
  var n = Number(i), f = (held.items || [])[n];
  if (!f) return { ok: false, error: 'That flag is no longer in the list' };
  var written = writeFlags([{ source: f.source, flag: f.flag, reason: f.reason, urgency: f.urgency, key: f.key, due: f.due, changed: 'raised by you' }]);
  held.items.splice(n, 1);
  veraStoreSet_(FQ_HELD_KEY_, JSON.stringify(held));
  return written ? { ok: true, action: 'raised' } : { ok: false, error: 'It’s already in your flags' };
}
