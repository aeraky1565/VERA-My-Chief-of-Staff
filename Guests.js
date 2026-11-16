// ============================================================
// VERA — Guests.js
// Hosting › Guests: stays come from the calendar (getUpcomingGuests_, PTO.js). Every stay gets
// the same prep list, edited once (Config guest_prep_list, one item per line); what's ticked for
// each stay, and how many people you're cooking for, live in a small Guest Prep tab
// (Stay | Item | Value | Updated), made the first time something is ticked.
// ============================================================

var GP_TAB_ = 'Guest Prep';
var GP_HEADERS_ = ['Stay', 'Item', 'Value', 'Updated'];
var GP_DEFAULT_ = ['Clean sheets on the guest bed', 'Fresh towels', 'Wi-Fi card out', 'Clear a drawer and hangers', 'Groceries for the stay'];
var GP_PEOPLE_ = '__people';
var GP_PAST_DAYS_ = 365;

/** Pure: the prep list from Config guest_prep_list (one per line, or ';'), else the default. */
function gpList_(cfg) {
  var raw = String((cfg && cfg['guest_prep_list']) || '').trim();
  if (!raw) return GP_DEFAULT_.slice();
  var seen = {};
  return raw.split(/\r?\n|;/).map(function(s) { return s.trim(); }).filter(function(s) { var k = s.toLowerCase(); if (!s || seen[k]) return false; seen[k] = true; return true; });
}

/** Pure: a stay's key: its title and arrival day. */
function gpStayKey_(g) { return String(g.label || '').trim() + '|' + String(g.arrivalDate || '').slice(0, 10); }

/** Pure: how many guests a title names ("Mom & Dad", "Rania", "The Lins (4)"): (N) wins, else names split on & , and. */
function gpGuessGuests_(label) {
  var s = String(label || ''), m = /\((\d{1,2})\)/.exec(s);
  if (m) return Math.max(1, Number(m[1]));
  s = s.replace(/\b(visit(ing|s)?|staying|stay|guests?|here|in town|arrive[sd]?)\b/gi, ' ');
  var parts = s.split(/\s*(?:&|,|\+|\band\b)\s*/i).map(function(x) { return x.trim(); }).filter(Boolean);
  return Math.max(1, parts.length);
}

function gpSheet_(make) {
  var ss = getSpreadsheet(), sh = ss.getSheetByName(GP_TAB_);
  if (!sh && make) { sh = ss.insertSheet(GP_TAB_); sh.getRange(1, 1, 1, GP_HEADERS_.length).setValues([GP_HEADERS_]); }
  return sh;
}

/** Per stay key: {checked:[items], people:N|null}. */
function gpRead_() {
  var sh = gpSheet_(false), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function(r) {
    var k = String(r[0]).trim(), item = String(r[1]).trim(); if (!k || !item) return;
    var o = out[k] = out[k] || { checked: [], people: null };
    if (item === GP_PEOPLE_) { var n = parseInt(r[2], 10); if (n > 0) o.people = n; }
    else if (r[2] === true || String(r[2]).toUpperCase() === 'TRUE') o.checked.push(item);
  });
  return out;
}

/** Sets one row (stay, item) to value, adding it when there's none. */
function gpSet_(stay, item, value) {
  return veraLocked_(function() {
    var sh = gpSheet_(true), n = sh.getLastRow() - 1, now = new Date();
    if (n > 0) {
      var rows = sh.getRange(2, 1, n, 2).getValues();
      for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim() === stay && String(rows[i][1]).trim() === item) { sh.getRange(i + 2, 3, 1, 2).setValues([[value, now]]); return true; }
    }
    sh.appendRow([stay, item, value, now]);
    return true;
  });
}

/** GET get_guests — stays (now and coming, and the past year's), each with its prep ticks and headcount, and the prep list. */
function webGuests_() {
  var cfg = readPTOConfig_(), stays = getUpcomingGuests_(cfg, GP_PAST_DAYS_), prep = gpList_(getConfigValues()), saved = {};
  try { saved = gpRead_(); } catch (e) { saved = {}; }
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var guests = [], past = [];
  stays.forEach(function(g) {
    var k = gpStayKey_(g), s = saved[k] || { checked: [], people: null };
    var x = Object.assign({}, g, { stayKey: k, checked: s.checked.filter(function(i) { return prep.indexOf(i) !== -1; }), people: s.people || gpGuessGuests_(g.label) });
    (g.departureDate < today ? past : guests).push(x);
  });
  past.sort(function(a, b) { return a.arrivalDate < b.arrivalDate ? 1 : -1; });
  return { ok: true, guests: guests, past: past, prep: prep };
}

/** GET guest_prep_check — stay, item, on: ticks or unticks one prep item for a stay. */
function webGuestPrepCheck_(e) {
  var p = (e && e.parameter) || {}, stay = String(p.stay || '').trim(), item = String(p.item || '').trim();
  if (!stay || !item || item === GP_PEOPLE_) throw new Error('stay and item required');
  gpSet_(stay, item, String(p.on) !== 'false');
  return { ok: true, stay: stay, item: item, on: String(p.on) !== 'false' };
}

/** GET guest_people — stay, n: how many guests (1–20). */
function webGuestPeople_(e) {
  var p = (e && e.parameter) || {}, stay = String(p.stay || '').trim(), n = parseInt(p.n, 10);
  if (!stay) throw new Error('stay required');
  if (!(n >= 1 && n <= 20)) throw new Error('n must be 1 to 20');
  gpSet_(stay, GP_PEOPLE_, n);
  return { ok: true, stay: stay, people: n };
}

/** GET guest_prep_list — items (one per line): the standard list every stay gets. */
function webGuestPrepList_(e) {
  var raw = String(((e && e.parameter) || {}).items || '');
  var list = gpList_({ guest_prep_list: raw });
  if (!raw.trim()) list = GP_DEFAULT_.slice();
  setConfigRow_('guest_prep_list', list.join('\n'), 'The guest-prep checklist every stay gets (Hosting › Guests)');
  return { ok: true, prep: list };
}
