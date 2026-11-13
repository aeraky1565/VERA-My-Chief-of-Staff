// ============================================================
// VERA — PTOStrategy.js  (issue #248)
// Next year's time off: the days that turn holidays and weekends into long breaks.
// ============================================================
//
// PTO Planner › 📅 Next year (and a Time off card in lite):
//   - candidates: a run of days off made by taking 1+ PTO days next to weekends and
//     holidays, for both of you together and for each of you on your own. Each
//     person's holidays come from their work calendar; where next year's aren't
//     posted yet, the US federal list stands in, marked "assumed";
//   - a plan: a strategy picks from them within each person's budget. The budget is
//     next year's allowance plus what rolls over, personal time first (it expires),
//     less the PTO held for pencilled trips, the buffer and any days to keep;
//   - locked trips (calendar) and booked PTO are never clashed with; blackouts are avoided;
//   - Accept writes one VERA-calendar event (never a work calendar) and a row in the
//     "PTO Plan" tab; Skip hides a pick. Accepted picks are fixed in later plans;
//   - nightly: "plan ready" from the trigger date, "use it before Dec 31" in December,
//     "request it at work" N weeks before an accepted break (until the PTO shows on
//     that person's work calendar), and Away mode on the first day when asked.
//
// Strategies are presets of the same settings; Advanced overrides any of them.
// The settings live in one Config row, pto_strategy (JSON), shared by the household.
//
// Layers: pure planning (pts*_ with no Apps Script), then reads, routes and the nightly step.
// ============================================================

var PTS_PEOPLE_ = [{ id: 'ahmed', name: 'Ahmed' }, { id: 'victoria', name: 'Victoria' }];
var PTS_PLAN_TAB_ = 'PTO Plan';
var PTS_PLAN_HEADERS_ = ['ID', 'Year', 'Who', 'Label', 'Off Start', 'Off End', 'PTO Days', 'Status', 'Away', 'Event ID', 'Updated'];
var PTS_FLAG_PREFIX_ = 'PTOPLAN|';
var PTS_SLOTS_ = { longWeekend: 3, midSizeWeek: 2, bigPivot: 1 };

// The four strategies. Each is only a set of the settings below; Advanced overrides any.
var PTS_PRESETS_ = {
  fill321: { label: 'Fill the 3-2-1', about: '3 long weekends, 2 mid-size weeks and 1 big break, each the best value for its slot, spread across the year.',
             mode: 'slots', picks: 'fill', minRatio: 2, spacingWeeks: 4, maxPto: 5 },
  value:   { label: 'Most days off per PTO day', about: 'The breaks that give the most days off for each PTO day, until the budget runs out.',
             mode: 'value', picks: 'fill', minRatio: 2.5, spacingWeeks: 2, maxPto: 4 },
  spread:  { label: 'Spread evenly', about: 'A break every couple of months, using holidays where they help.',
             mode: 'value', picks: 'fill', minRatio: 1.5, spacingWeeks: 8, maxPto: 5 },
  all:     { label: 'Every bridge', about: 'Every good bridge, ranked. Nothing is chosen for you; accept the ones you want.',
             mode: 'all', picks: 'all', minRatio: 2, spacingWeeks: 0, maxPto: 5 },
};
var PTS_DEFAULTS_ = { preset: 'fill321', scope: 'joint_each', skips: 'hidden', reservePencilled: true, personalFirst: true,
  leadWeeks: 6, leadWeeksLong: 8, trigger: '11-25', topN: 10,
  buffer: { ahmed: null, victoria: null }, keep: { ahmed: 0, victoria: 0 }, blackouts: { ahmed: [], victoria: [] } };

// ---- pure: dates ------------------------------------------------------------------

function ptsAdd_(iso, n) { var p = iso.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)); return d.toISOString().slice(0, 10); }
function ptsDow_(iso) { var p = iso.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
function ptsDays_(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
function ptsIsIso_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && new Date(String(s) + 'T00:00:00Z').toISOString().slice(0, 10) === String(s); }
function ptsYmd_(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
function ptsNthDow_(y, m, dow, n) {   // n-th weekday dow of month m (n = -1: the last)
  if (n > 0) { var first = ptsDow_(ptsYmd_(y, m, 1)); return ptsYmd_(y, m, 1 + ((dow - first + 7) % 7) + (n - 1) * 7); }
  var lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(), last = ptsDow_(ptsYmd_(y, m, lastDay));
  return ptsYmd_(y, m, lastDay - ((last - dow + 7) % 7));
}
function ptsObserved_(iso) { var w = ptsDow_(iso); return w === 6 ? ptsAdd_(iso, -1) : w === 0 ? ptsAdd_(iso, 1) : iso; }

/**
 * Pure: the US federal holidays observed in a year → {ymd: label}. A Saturday holiday is
 * observed the Friday before, a Sunday one the Monday after; New Year's Day on a Saturday
 * is observed on Dec 31 of the year before, so it belongs to that year.
 */
function ptsFederalHolidays_(y) {
  var out = {};
  var put = function(iso, label) { if (iso.slice(0, 4) === String(y)) out[iso] = label; };
  put(ptsObserved_(ptsYmd_(y, 1, 1)), 'New Year’s Day');
  put(ptsObserved_(ptsYmd_(y + 1, 1, 1)), 'New Year’s Day (observed)');
  put(ptsNthDow_(y, 1, 1, 3), 'Martin Luther King Jr. Day');
  put(ptsNthDow_(y, 2, 1, 3), 'Presidents’ Day');
  put(ptsNthDow_(y, 5, 1, -1), 'Memorial Day');
  put(ptsObserved_(ptsYmd_(y, 6, 19)), 'Juneteenth');
  put(ptsObserved_(ptsYmd_(y, 7, 4)), 'Independence Day');
  put(ptsNthDow_(y, 9, 1, 1), 'Labor Day');
  put(ptsNthDow_(y, 10, 1, 2), 'Columbus Day');
  put(ptsObserved_(ptsYmd_(y, 11, 11)), 'Veterans Day');
  put(ptsNthDow_(y, 11, 4, 4), 'Thanksgiving');
  put(ptsObserved_(ptsYmd_(y, 12, 25)), 'Christmas Day');
  return out;
}

// ---- pure: settings ---------------------------------------------------------------

/** Pure: the stored settings merged over the preset and the defaults, cleaned. */
function ptsSettings_(stored) {
  var s = stored && typeof stored === 'object' ? stored : {};
  var preset = PTS_PRESETS_[s.preset] ? s.preset : PTS_DEFAULTS_.preset;
  var out = Object.assign({}, PTS_DEFAULTS_, PTS_PRESETS_[preset], { preset: preset });
  var o = s.overrides && typeof s.overrides === 'object' ? s.overrides : {};
  var num = function(v, lo, hi) { if (v === '' || v === null || v === undefined) return null; var n = Number(v); return isFinite(n) && n >= lo && n <= hi ? n : null; };
  var changed = [];
  var set = function(k, v) { if (v !== null && v !== undefined && v !== out[k]) { out[k] = v; changed.push(k); } };
  set('minRatio', num(o.minRatio, 1, 10));
  set('spacingWeeks', num(o.spacingWeeks, 0, 26));
  set('maxPto', num(o.maxPto, 1, 15));
  set('topN', num(o.topN, 1, 50));
  set('leadWeeks', num(o.leadWeeks, 1, 26));
  set('leadWeeksLong', num(o.leadWeeksLong, 1, 26));
  if (['fill', 'top', 'all'].indexOf(o.picks) !== -1) set('picks', o.picks);
  if (['hidden', 'return'].indexOf(o.skips) !== -1) set('skips', o.skips);
  if (['joint_each', 'joint', 'each'].indexOf(o.scope) !== -1) set('scope', o.scope);
  if (typeof o.reservePencilled === 'boolean') set('reservePencilled', o.reservePencilled);
  if (typeof o.personalFirst === 'boolean') set('personalFirst', o.personalFirst);
  if (/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(o.trigger || ''))) set('trigger', o.trigger);
  out.buffer = Object.assign({}, PTS_DEFAULTS_.buffer); out.keep = Object.assign({}, PTS_DEFAULTS_.keep); out.blackouts = { ahmed: [], victoria: [] };
  PTS_PEOPLE_.forEach(function(p) {
    var b = num((o.buffer || {})[p.id], 0, 30); if (b !== null) { out.buffer[p.id] = b; changed.push('buffer'); }
    var k = num((o.keep || {})[p.id], 0, 30); if (k !== null && k !== 0) { out.keep[p.id] = k; changed.push('keep'); }
    var bl = ptsBlackouts_((o.blackouts || {})[p.id]); if (bl.length) { out.blackouts[p.id] = bl; changed.push('blackouts'); }
  });
  out.changed = changed.filter(function(k, i, a) { return a.indexOf(k) === i; });
  return out;
}

/** Pure: blackouts as [[start, end]] from "2027-03-22..2027-03-31, 2027-06-30" or a list. */
function ptsBlackouts_(raw) {
  var parts = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(/[,;\n]+/);
  var out = [];
  parts.forEach(function(x) {
    var a, b;
    if (Array.isArray(x)) { a = String(x[0] || '').trim(); b = String(x[1] || x[0] || '').trim(); }
    else { var m = String(x).trim().split(/\s*(?:\.\.|–|—|to)\s*/); a = m[0]; b = m[1] || m[0]; }
    if (ptsIsIso_(a) && ptsIsIso_(b) && a <= b && ptsDays_(a, b) <= 366) out.push([a, b]);
  });
  return out.slice(0, 20);
}

// ---- pure: candidates -------------------------------------------------------------

/** Pure: is this day off for a person (a weekend or one of their holidays)? */
function ptsOff_(person, iso) { var w = ptsDow_(iso); return w === 0 || w === 6 || !!(person.holidays && person.holidays[iso]); }
function ptsOverlaps_(a1, b1, a2, b2) { return a1 <= b2 && a2 <= b1; }
function ptsInRanges_(a, b, ranges) { return (ranges || []).some(function(r) { return ptsOverlaps_(a, b, r[0], r[1]); }); }

/**
 * Pure: every break worth taking in [from, to] for a group of people (both of you, or
 * one). A break is a run of days where each member is off or takes PTO; it can't be
 * stretched by a day everyone already has off, holds at least one PTO day and a weekend
 * or holiday, costs each member at most maxPto, and is worth at least minRatio days
 * off per PTO day. Busy ranges (locked trips, booked PTO, reserves) and a member's
 * blackouts rule a break out. PTO days in Jan of the next year don't count here.
 * → [{who, start, end, days, pto:{id:[dates]}, cost, ratio, holidays:[labels], slot, assumed}]
 */
function ptsCandidates_(group, from, to, opts) {
  opts = opts || {};
  var maxPto = opts.maxPto || 5, minRatio = opts.minRatio || 1, year = String(to).slice(0, 4);
  var allOff = function(iso) { return group.every(function(p) { return ptsOff_(p, iso); }); };
  var out = [];
  for (var s = from; s <= to; s = ptsAdd_(s, 1)) {
    if (allOff(ptsAdd_(s, -1))) continue;                  // could start a day earlier for free
    for (var len = 3; len <= 16; len++) {
      var e = ptsAdd_(s, len - 1);
      if (e > ptsAdd_(to, 3)) break;
      if (allOff(ptsAdd_(e, 1))) continue;                  // could end a day later for free
      var pto = {}, ok = true, any = 0, worst = 0, hol = {}, weekend = false, assumed = false;
      for (var i = 0; i < group.length && ok; i++) {
        var p = group[i], days = [];
        for (var d = s; d <= e; d = ptsAdd_(d, 1)) {
          var w = ptsDow_(d);
          if (w === 0 || w === 6) { weekend = true; continue; }
          if (p.holidays && p.holidays[d]) { hol[p.holidays[d]] = true; if (p.assumed) assumed = true; continue; }
          if (d.slice(0, 4) !== year) { ok = false; break; }   // PTO next January belongs to next year's plan
          days.push(d);
        }
        if (!ok) break;
        if (days.length > maxPto) { ok = false; break; }
        if (ptsInRanges_(s, e, p.busy) || ptsInRanges_(s, e, p.blackouts)) { ok = false; break; }
        pto[p.id] = days; any += days.length; worst = Math.max(worst, days.length);
      }
      if (!ok || !any || (!weekend && !Object.keys(hol).length)) continue;
      var ratio = Math.round(len / worst * 100) / 100;
      if (ratio < minRatio) continue;
      out.push({ who: group.length > 1 ? 'joint' : group[0].id, start: s, end: e, days: len, pto: pto, cost: worst, ratio: ratio,
        holidays: Object.keys(hol), assumed: assumed, slot: ptsSlot_(worst, len) });
    }
  }
  return out;
}

/** Pure: the 3-2-1 slot a break fills (PTO.js classifyPTOBlock_'s rule, on days off). */
function ptsSlot_(ptoDays, calDays) { return ptoDays <= 3 && calDays <= 5 ? 'longWeekend' : ptoDays <= 7 ? 'midSizeWeek' : 'bigPivot'; }
function ptsId_(c) { var all = []; Object.keys(c.pto).forEach(function(k) { all = all.concat(c.pto[k]); }); all.sort(); return c.who + ':' + (all[0] || c.start) + ':' + (all[all.length - 1] || c.end); }
function ptsRank_(a, b) { return (b.ratio - a.ratio) || (b.days - a.days) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0); }

/** Pure: a short name for a break — its holiday, else its month. */
function ptsLabel_(c) {
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var h = (c.holidays || []).filter(function(x) { return !/observed/i.test(x); });
  if (h.some(function(x) { return /christmas/i.test(x); }) && (c.holidays || []).some(function(x) { return /new year/i.test(x); })) return 'Christmas to New Year';
  if (h.length) return h[0].replace(/ Day$/, '') + (c.days >= 7 ? ' week' : ' weekend');
  return (c.days >= 7 ? 'A week in ' : 'A long weekend in ') + MON[Number(c.start.slice(5, 7)) - 1];
}

/**
 * Pure: where a pencilled trip's PTO is held. Exact dates are kept; otherwise, in each
 * of its months (in the year), the run of `days` days that costs its travellers the
 * fewest PTO days, clear of busy ranges and blackouts; the first month that fits wins.
 * → {label, start, end, who:[ids], cost:{id:n}} or null
 */
function ptsReserveFor_(trip, people, year) {
  var who = trip.who && trip.who.length ? trip.who : people.map(function(p) { return p.id; });
  var members = people.filter(function(p) { return who.indexOf(p.id) !== -1; });
  var costOf = function(s, e) { var c = {}; members.forEach(function(p) { var n = 0; for (var d = s; d <= e; d = ptsAdd_(d, 1)) if (!ptsOff_(p, d)) n++; c[p.id] = n; }); return c; };
  if (trip.start && trip.end) return trip.start.slice(0, 4) === String(year) ? { label: trip.label, start: trip.start, end: trip.end, who: who, cost: costOf(trip.start, trip.end) } : null;
  var days = Math.max(2, Math.min(30, trip.days || 7));
  var months = (trip.months || []).filter(function(m) { return m.slice(0, 4) === String(year); });
  for (var i = 0; i < months.length; i++) {
    var best = null, last = ptsAdd_(ptsAdd_(months[i] + '-01', 32).slice(0, 7) + '-01', -1);
    for (var s = months[i] + '-01'; s <= last; s = ptsAdd_(s, 1)) {
      var e = ptsAdd_(s, days - 1);
      if (members.some(function(p) { return ptsInRanges_(s, e, p.busy) || ptsInRanges_(s, e, p.blackouts); })) continue;
      var c = costOf(s, e), t = 0; Object.keys(c).forEach(function(k) { t += c[k]; });
      if (!best || t < best.t) best = { t: t, s: s, e: e, c: c };
    }
    if (best) return { label: trip.label, start: best.s, end: best.e, who: who, cost: best.c };
  }
  return null;
}

/**
 * Pure: the plan for a year.
 * input: { year, today, settings (ptsSettings_), people: [{id, name, holidays, assumed,
 *   blackouts, busy:[[s,e]], budget:{vacation, carry, personal, booked, buffer, keep, capCarry}}],
 *   locked:[{label,start,end}], pencilled:[{label, start, end, months, days, who}],
 *   saved:{id:{status, who, start, end, pto, label}} }
 * → { year, picks:[…], more:[…], skipped:[…], reserves:[…], budget:{id:{…}}, slots:{id:{…}} }
 */
function ptsPlan_(input) {
  var st = input.settings || ptsSettings_({}), year = input.year, today = input.today;
  var from = ptsAdd_(today, 1) > year + '-01-01' ? ptsAdd_(today, 1) : year + '-01-01', to = year + '-12-31';
  var saved = input.saved || {};
  var people = input.people.map(function(p) {
    var busy = (p.busy || []).slice();
    (input.locked || []).forEach(function(t) { busy.push([t.start, t.end]); });
    return Object.assign({}, p, { busy: busy, blackouts: (p.blackouts || []).concat((st.blackouts || {})[p.id] || []) });
  });
  var byId = {}; people.forEach(function(p) { byId[p.id] = p; });
  // Reserves for pencilled trips (they're busy for the bridges).
  var reserves = [];
  if (st.reservePencilled) (input.pencilled || []).forEach(function(t) {
    var r = ptsReserveFor_(t, people, year);
    if (!r) return;
    reserves.push(r);
    r.who.forEach(function(id) { if (byId[id]) byId[id].busy.push([r.start, r.end]); });
  });
  // Budgets: allowance + carryover + personal − booked − reserved − buffer − keep.
  var budget = {}, left = {}, slots = {};
  people.forEach(function(p) {
    var b = p.budget || {}, reserved = 0;
    reserves.forEach(function(r) { reserved += (r.cost && r.cost[p.id]) || 0; });
    var buffer = st.buffer && st.buffer[p.id] != null ? st.buffer[p.id] : (b.buffer || 0);
    var keep = (st.keep && st.keep[p.id]) || b.keep || 0;
    var total = (b.vacation || 0) + (b.carry || 0) + (b.personal || 0);
    budget[p.id] = { vacation: b.vacation || 0, carry: b.carry || 0, personal: b.personal || 0, booked: b.booked || 0, reserved: reserved, buffer: buffer, keep: keep,
      capCarry: b.capCarry == null ? null : b.capCarry, accrual: b.accrual || null, accepted: 0, planned: 0 };
    left[p.id] = total - (b.booked || 0) - reserved - buffer - keep;
    slots[p.id] = { longWeekend: PTS_SLOTS_.longWeekend, midSizeWeek: PTS_SLOTS_.midSizeWeek, bigPivot: PTS_SLOTS_.bigPivot };
    (input.lockedSlots && input.lockedSlots[p.id] || []).forEach(function(s) { if (slots[p.id][s] > 0) slots[p.id][s]--; });
  });
  reserves.forEach(function(r) { var days = ptsDays_(r.start, r.end) + 1, worst = 0; Object.keys(r.cost).forEach(function(k) { worst = Math.max(worst, r.cost[k]); }); var sl = ptsSlot_(worst, days); r.slot = sl; r.who.forEach(function(id) { if (slots[id] && slots[id][sl] > 0) slots[id][sl]--; }); });
  // Candidates per group, in order: together first, then each.
  var groups = [];
  if (st.scope !== 'each' && people.length > 1) groups.push(people);
  if (st.scope !== 'joint') people.forEach(function(p) { groups.push([p]); });
  var cands = [], jointKeys = {};
  groups.forEach(function(g, gi) { ptsCandidates_(g, from, to, st).forEach(function(c) {
    // A break you'd both take anyway is listed once, as together.
    var k = c.start + '|' + c.end;
    if (c.who === 'joint') jointKeys[k] = true; else if (jointKeys[k]) c.twin = true;   // still pickable when the joint one doesn't fit
    c.group = gi; c.id = ptsId_(c); c.label = ptsLabel_(c); cands.push(c);
  }); });
  var chosen = [], skipped = [], ids = {};
  var membersOf = function(c) { return c.who === 'joint' ? people.map(function(p) { return p.id; }) : [c.who]; };
  var clash = function(c) {
    var m = membersOf(c);
    return chosen.some(function(x) {
      var mx = membersOf(x);
      if (!m.some(function(id) { return mx.indexOf(id) !== -1; })) return false;
      if (ptsOverlaps_(c.start, c.end, x.start, x.end)) return true;
      var gap = st.spacingWeeks * 7;
      return gap > 0 && x.status !== 'accepted' && (Math.abs(ptsDays_(x.end, c.start)) < gap && Math.abs(ptsDays_(c.end, x.start)) < gap);
    });
  };
  var spend = function(c) { membersOf(c).forEach(function(id) { left[id] -= (c.pto[id] || []).length; if (slots[id][c.slot] > 0) slots[id][c.slot]--; }); };
  var fits = function(c) { return membersOf(c).every(function(id) { return left[id] >= (c.pto[id] || []).length; }); };
  // Accepted picks are fixed.
  Object.keys(saved).forEach(function(id) {
    var s = saved[id];
    if (s.status !== 'accepted' || String(s.year) !== String(year)) return;
    var c = { id: id, who: s.who, start: s.start, end: s.end, days: ptsDays_(s.start, s.end) + 1, pto: s.pto || {}, label: s.label, status: 'accepted', holidays: s.holidays || [], away: !!s.away };
    var worst = 0; Object.keys(c.pto).forEach(function(k) { worst = Math.max(worst, c.pto[k].length); });
    c.cost = worst; c.ratio = worst ? Math.round(c.days / worst * 100) / 100 : c.days; c.slot = ptsSlot_(worst, c.days);
    spend(c); chosen.push(c); ids[id] = true;
    membersOf(c).forEach(function(m) { budget[m] && (budget[m].accepted += (c.pto[m] || []).length); });
  });
  var isSkipped = function(c) { return saved[c.id] && saved[c.id].status === 'skipped'; };
  var ordered = cands.slice().sort(function(a, b) { return (a.group - b.group) || ptsRank_(a, b); });
  if (st.skips === 'hidden') ordered = ordered.filter(function(c) { if (isSkipped(c)) { skipped.push(c); return false; } return true; });
  else ordered.sort(function(a, b) { return (isSkipped(a) ? 1 : 0) - (isSkipped(b) ? 1 : 0); });
  var more = [];
  ordered.forEach(function(c) {
    if (ids[c.id]) return;
    var wantSlot = st.mode !== 'slots' || membersOf(c).every(function(id) { return slots[id][c.slot] > 0; });
    var take = st.mode !== 'all' && wantSlot && fits(c) && !clash(c);
    if (take) { c.status = 'suggested'; spend(c); chosen.push(c); ids[c.id] = true; membersOf(c).forEach(function(m) { budget[m].planned += (c.pto[m] || []).length; }); return; }
    // Not chosen: a good alternative when it doesn't overlap a chosen break or another listed one.
    if (!c.twin && !chosen.concat(more).some(function(x) { return x.who === c.who && ptsOverlaps_(c.start, c.end, x.start, x.end); })) { c.status = 'idea'; more.push(c); }
  });
  // The days each person's PTO lands on: booked, reserved, accepted and suggested.
  var ptoDates = function(p) {
    var out = [];
    (p.booked || []).forEach(function(b) { for (var d = b[0]; d <= b[1]; d = ptsAdd_(d, 1)) if (d.slice(0, 4) === String(year) && !ptsOff_(p, d)) out.push(d); });
    reserves.forEach(function(r) { if (r.who.indexOf(p.id) !== -1) for (var d = r.start; d <= r.end; d = ptsAdd_(d, 1)) if (!ptsOff_(p, d)) out.push(d); });
    chosen.forEach(function(c) { (c.pto[p.id] || []).forEach(function(d) { out.push(d); }); });
    return out.sort();
  };
  // What rolls into the year after, and what the accrual cap would cost. Personal time
  // goes on the latest days (it expires Dec 31 and isn't in the capped balance), so
  // vacation comes off the balance as early as the plan allows.
  var roll = function(p) {
    var b = budget[p.id], spent = b.booked + b.reserved + b.accepted + b.planned;
    var personalUsed = st.personalFirst ? Math.min(b.personal, spent) : Math.max(0, Math.min(b.personal, spent - (b.vacation + b.carry)));
    var vacUsed = spent - personalUsed;
    b.personalUnused = b.personal - personalUsed;
    b.rollsOver = Math.max(0, b.vacation + b.carry - vacUsed);
    b.left = left[p.id];
    if (b.accrual) {
      var dates = ptoDates(p);
      var vacDates = dates.slice(0, Math.max(0, dates.length - personalUsed));
      var chk = ptsAccrualCheck_(b.accrual, b.carry, vacDates, year);
      // Lost this year at the cap, plus next January's accrual if too much rolls over.
      b.lostNextJan = b.capCarry == null ? 0 : Math.max(0, b.rollsOver - b.capCarry);
      b.lost = Math.round((chk.lost + b.lostNextJan) * 10) / 10; b.timeline = chk.timeline; b.takeBy = chk.takeBy; b.firstLoss = chk.firstLoss;
    } else b.lost = b.capCarry == null ? 0 : Math.max(0, b.rollsOver - b.capCarry);
    return b.personalUnused + b.lost;
  };
  // Nothing should expire: personal time left over, accruals lost at the cap, or vacation
  // above what may roll over get the best breaks still open (no slot or spacing rule;
  // never past the buffer). For the cap, breaks before the first lost accrual come first.
  if (st.mode !== 'all') people.forEach(function(p) {
    var need = roll(p), guard = 0;
    while (need > 0 && guard++ < 40) {
      var b = budget[p.id], by = b.lost > 0 && b.firstLoss ? b.firstLoss : null, room = Math.max(need, b.lost > 0 ? 5 : 0);
      var topUp = function(a, c) {
        var ea = by && (a.pto[p.id] || []).some(function(d) { return d < by; }) ? 1 : 0, ec = by && (c.pto[p.id] || []).some(function(d) { return d < by; }) ? 1 : 0;
        return (ec - ea) || ((c.holidays.length ? 1 : 0) - (a.holidays.length ? 1 : 0)) || (Math.min((c.pto[p.id] || []).length, room) - Math.min((a.pto[p.id] || []).length, room)) || ptsRank_(a, c);
      };
      var pick = ordered.slice().sort(topUp).filter(function(c) {
        if (ids[c.id] || membersOf(c).indexOf(p.id) === -1) return false;
        var mine = (c.pto[p.id] || []).length;
        if (!mine || mine > room || !fits(c)) return false;
        if (by && !(c.pto[p.id] || []).some(function(d) { return d < by; }) && b.personalUnused <= 0) return false;
        return !chosen.some(function(x) { return membersOf(x).some(function(id) { return membersOf(c).indexOf(id) !== -1; }) && ptsOverlaps_(c.start, c.end, x.start, x.end); });
      })[0];
      if (!pick) break;
      pick.status = 'suggested'; pick.reason = b.lost > 0 && by ? 'cap' : 'use'; spend(pick); chosen.push(pick); ids[pick.id] = true;
      membersOf(pick).forEach(function(m) { budget[m].planned += (pick.pto[m] || []).length; });
      if (more.indexOf(pick) !== -1) more.splice(more.indexOf(pick), 1);
      for (var mi = more.length - 1; mi >= 0; mi--) if (more[mi].who === pick.who && ptsOverlaps_(pick.start, pick.end, more[mi].start, more[mi].end)) more.splice(mi, 1);
      need = roll(p);
    }
  });
  var picks = chosen.slice().sort(function(a, b) { return a.start < b.start ? -1 : 1; });
  var moreOut = more.sort(ptsRank_);
  if (st.picks === 'top') { var all = picks.concat(moreOut).sort(ptsRank_); picks = all.slice(0, st.topN).sort(function(a, b) { return a.start < b.start ? -1 : 1; }); moreOut = []; }
  else if (st.picks === 'all') { picks = picks.concat(moreOut).sort(ptsRank_).slice(0, 60).sort(function(a, b) { return a.start < b.start ? -1 : 1; }); moreOut = []; }
  people.forEach(roll);
  return { year: year, from: from, picks: picks, more: moreOut.slice(0, 12), skipped: skipped.slice(0, 20), reserves: reserves, budget: budget, slotsLeft: slots,
    settings: st, people: people.map(function(p) { return { id: p.id, name: p.name, assumed: !!p.assumed, holidays: p.holidays, blackouts: p.blackouts, busy: p.busy }; }), locked: input.locked || [] };
}

/**
 * Pure: the vacation balance through a year that accrues monthly against a cap
 * (Verizon: an equal share of the annual days on `day` of each month, Jan–Oct; a
 * month's accrual is lost as far as it would take the balance over the cap).
 * acc: {annual, day, cap} in days; carry: Jan 1 balance; vacDates: the vacation days
 * taken (sorted). → { timeline:[{date, before, posted, lost, after}], lost, firstLoss,
 *   takeBy:[{date, atLeast, used, met}] } — takeBy: the vacation days that must be gone
 *   by each accrual day for nothing to be lost.
 */
function ptsAccrualCheck_(acc, carry, vacDates, year) {
  var a = (acc.annual || 0) / 10, day = acc.day || 16, cap = acc.cap || 0;
  var used = function(before) { var n = 0; (vacDates || []).forEach(function(d) { if (d < before) n++; }); return n; };
  var posted = 0, lost = 0, firstLoss = '', timeline = [], takeBy = [];
  for (var m = 1; m <= 10; m++) {
    var date = ptsYmd_(year, m, Math.min(day, 28)), u = used(date);
    var before = carry + posted - u;
    var l = Math.max(0, Math.min(a, before + a - cap));
    posted += a - l; lost += l;
    if (l > 0 && !firstLoss) firstLoss = date;
    timeline.push({ date: date, before: Math.round(before * 10) / 10, posted: Math.round((a - l) * 10) / 10, lost: Math.round(l * 10) / 10, after: Math.round((before + a - l) * 10) / 10 });
    var need = Math.ceil(carry + m * a - cap - 1e-9);
    if (need > 0) takeBy.push({ date: date, atLeast: need, used: u, met: u >= need });
  }
  // Keep only the milestones where the requirement steps up.
  takeBy = takeBy.filter(function(t, i, arr) { return !i || t.atLeast > arr[i - 1].atLeast; });
  return { timeline: timeline, lost: Math.round(lost * 10) / 10, firstLoss: firstLoss, takeBy: takeBy };
}

/**
 * Pure: this year's leftovers — personal time (it expires Dec 31) and vacation above
 * what may roll over — and the best breaks still open to spend them on.
 * people: [{id, name, holidays, busy, blackouts, personalLeft (days), vacationLeft, capCarry}]
 */
function ptsUseItBefore_(people, today, settings) {
  var y = Number(today.slice(0, 4)), to = y + '-12-31', from = ptsAdd_(today, 1);
  var rows = people.map(function(p) {
    var over = p.capCarry == null ? 0 : Math.max(0, (p.vacationLeft || 0) - p.capCarry);
    return { id: p.id, name: p.name, personal: Math.max(0, p.personalLeft || 0), overCap: over, total: Math.max(0, p.personalLeft || 0) + over };
  });
  var need = {}; rows.forEach(function(r) { need[r.id] = r.total; });
  var st = Object.assign({}, settings || ptsSettings_({}), { minRatio: 1.5, maxPto: 5 });
  var picks = [];
  if (rows.some(function(r) { return r.total > 0; })) {
    var groups = [], who = people.filter(function(p) { return need[p.id] > 0; });
    if (who.length > 1) groups.push(who);
    who.forEach(function(p) { groups.push([p]); });
    var cands = [];
    groups.forEach(function(g) { ptsCandidates_(g, from, to, st).forEach(function(c) { c.id = ptsId_(c); c.label = ptsLabel_(c); cands.push(c); }); });
    cands.filter(function(c) { return Object.keys(c.pto).every(function(id) { return c.pto[id].length <= need[id]; }); }).sort(ptsRank_).forEach(function(c) {
      if (picks.length >= 3 || picks.some(function(x) { return ptsOverlaps_(c.start, c.end, x.start, x.end); })) return;
      picks.push(c);
    });
  }
  return { year: y, people: rows, picks: picks, any: rows.some(function(r) { return r.total > 0; }) };
}

/** Pure: is the plan due to be announced? From the trigger day, or earlier once every person's holidays are real. */
function ptsPlanDue_(today, trigger, people) {
  var t = String(today).slice(0, 4) + '-' + (trigger || '11-25');
  if (today >= t) return true;
  return String(today).slice(5, 7) >= '10' && (people || []).length > 0 && people.every(function(p) { return !p.assumed; });
}

/** Pure: the "request it at work" flags wanted today for accepted picks. pending(id, person) → still not on their work calendar. */
function ptsRequestFlags_(accepted, today, st, pending, names) {
  var out = {};
  (accepted || []).forEach(function(c) {
    Object.keys(c.pto || {}).forEach(function(pid) {
      var days = c.pto[pid] || [];
      if (!days.length) return;
      var lead = (days.length >= 5 ? st.leadWeeksLong : st.leadWeeks) * 7, first = days[0];
      var by = ptsAdd_(first, -lead);
      if (today < by || today > first || !pending(c, pid)) return;
      out[PTS_FLAG_PREFIX_ + 'REQ|' + c.id + '|' + pid] = { flag: '🏢 Request ' + days.length + ' PTO day' + (days.length === 1 ? '' : 's') + ' at work: ' + (names[pid] || pid) + ', ' + c.label,
        reason: 'Take ' + days.join(', ') + '. It’s ' + ptsDays_(today, first) + ' days away; this clears once it’s on the work calendar.', urgency: ptsDays_(today, first) <= 14 ? 'High' : 'Medium', due: first };
    });
  });
  return out;
}

// ---- reads (Apps Script) -----------------------------------------------------------

function ptsToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function ptsSettingsRead_() {
  var raw = '';
  try { raw = String((getConfigValues() || {}).pto_strategy || ''); } catch (e) {}
  var stored = {}; try { stored = raw ? JSON.parse(raw) : {}; } catch (e) { stored = {}; }
  return ptsSettings_(stored);
}

function ptsPlanSheet_() { return ensureSheet(getSpreadsheet(), PTS_PLAN_TAB_, PTS_PLAN_HEADERS_); }

/** The PTO Plan tab: {id: {status, year, who, label, start, end, pto, away, eventId, row}}. */
function ptsSaved_() {
  var out = {}, sh = getSpreadsheet().getSheetByName(PTS_PLAN_TAB_);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, PTS_PLAN_HEADERS_.length).getValues().forEach(function(r, i) {
    var id = String(r[0] || '').trim(); if (!id) return;
    var pto = {}; try { pto = JSON.parse(r[6] || '{}'); } catch (e) {}
    out[id] = { id: id, year: String(r[1]), who: String(r[2]), label: String(r[3]), start: ptsCell_(r[4]), end: ptsCell_(r[5]), pto: pto, status: String(r[7] || '').toLowerCase(),
      away: String(r[8]).toLowerCase() === 'yes', eventId: String(r[9] || ''), row: i + 2 };
  });
  return out;
}
function ptsCell_(v) { return v instanceof Date && !isNaN(v.getTime()) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v == null ? '' : v).trim().slice(0, 10); }

/** One person's view of a year: holidays (real or assumed), booked PTO, budget. Cached for 6 hours. */
function ptsPerson_(p, year, today) {
  var cfg = p.id === 'ahmed' ? readPTOConfig_() : readVictoriaPTOConfig_();
  var cache = null, key = 'pts_' + p.id + '_' + year + '_' + today, got = null;
  try { cache = CacheService.getScriptCache(); got = JSON.parse(cache.get(key) || 'null'); } catch (e) {}
  if (!got) {
    var holidays = {}, booked = [], bookedDays = 0, remVac = null, remPersH = null;
    try {
      var res = getPTOEvents_(Object.assign({}, cfg, { year: year }));
      (res.holidays || []).forEach(function(h) { holidays[h.date] = h.label; });
      (res.events || []).forEach(function(ev) { booked.push([ev.startDate, ev.endDate]); bookedDays += ev.type === 'PTO-Personal' ? (ev.hours || 0) / 8 : (ev.weekdays || 0); });
      if (year === cfg.year) { var stats = computePTOStats_(res, cfg, new Date()); remVac = stats.remaining.vacationDays; remPersH = stats.remaining.personalHours; }
    } catch (e) { Logger.log('pto_strategy: ' + p.name + '’s work calendar couldn’t be read for ' + year); }
    got = { holidays: holidays, booked: booked, bookedDays: bookedDays, remVac: remVac, remPersH: remPersH };
    try { cache.put(key, JSON.stringify(got), 21600); } catch (e) {}
  }
  var assumed = Object.keys(got.holidays).length < 3;
  // Ahmed's vacation accrues monthly (Jan–Oct) against a cap (PTO.js computeAccrualCapStatus_):
  // 150% of the annual days, 125% from 2026-12-31. What may roll over is what still leaves
  // room for next January's accrual.
  var annual = cfg.vacationDays, capCarry = null, accrual = null;
  var capFor = function(y) { return annual * ((y + '-01-01') > ACCRUAL_CAP_SWITCH_DATE_ ? 1.25 : 1.5); };
  if (p.id === 'ahmed') { accrual = { annual: annual, day: cfg.accrualDay || 16, cap: capFor(year) }; capCarry = Math.floor(capFor(year + 1) - annual / 10); }
  else { var mc = Number((getConfigValues() || {}).victoria_pto_max_carryover); if (isFinite(mc) && mc > 0) capCarry = mc; }
  return { cfg: cfg, holidays: assumed ? ptsFederalHolidays_(year) : got.holidays, assumed: assumed, booked: got.booked, bookedDays: got.bookedDays,
    remVac: got.remVac, remPersH: got.remPersH, capCarry: capCarry, accrual: accrual };
}

/** Pencilled trips (Trip Ideas pulled into My Trips, not yet on the calendar). */
function ptsPencilled_(today) {
  try {
    var ideas = tiRows_(tiIdeasSheet_(), TRIP_IDEAS_HEADERS.length).filter(function(r) { return String(r[0]).trim(); }).map(tiIdeaFromRow_);
    return mtPencilled_(ideas, {}, today).filter(function(t) { return !t.expired; }).map(function(t) {
      var who = mtTraveler_(t.travelers);
      return { label: t.title, start: t.exact ? t.exactStart : '', end: t.exact ? t.exactEnd : '', months: t.months, days: t.days || 7,
        who: who === 'Ahmed' ? ['ahmed'] : who === 'Victoria' ? ['victoria'] : ['ahmed', 'victoria'] };
    });
  } catch (e) { Logger.log('pto_strategy: pencilled trips unavailable'); return []; }
}

/** Everything the planner needs for a year, read once. */
function ptsInputs_(year, today, st) {
  var saved = ptsSaved_();
  var locked = [];
  try { locked = (getUpcomingTravel_(readPTOConfig_()) || []).map(function(t) { return { label: t.label, start: t.startDate, end: t.endDate }; }); } catch (e) { Logger.log('pto_strategy: upcoming trips unavailable'); }
  var acceptedIds = {}; Object.keys(saved).forEach(function(id) { if (saved[id].status === 'accepted') acceptedIds[id] = true; });
  var people = PTS_PEOPLE_.map(function(p) {
    var v = ptsPerson_(p, year, today), cfg = v.cfg;
    var thisYear = year === Number(today.slice(0, 4));
    var carry = 0, vacation = cfg.vacationDays, personal = Math.floor((cfg.personalHours || 0) / 8);
    if (year === cfg.year) { vacation = v.remVac != null ? v.remVac : cfg.vacationDays + cfg.rolloverDays; personal = Math.floor((v.remPersH != null ? v.remPersH : cfg.personalHours) / 8); }
    else if (year === cfg.year + 1) {
      var now = ptsPerson_(p, cfg.year, today);
      var left = now.remVac != null ? now.remVac : 0;
      carry = now.capCarry == null ? Math.max(0, left) : Math.max(0, Math.min(left, now.capCarry));
    }
    // Booked PTO on the work calendar is busy; for this year it's already out of the balance.
    var busy = v.booked.slice();
    Object.keys(saved).forEach(function(id) { var s = saved[id]; if (s.status === 'accepted' && (s.who === p.id || s.who === 'joint')) busy = busy.filter(function(b) { return !(b[0] >= s.start && b[1] <= s.end); }); });
    // The month-by-month cap check needs the Jan 1 balance, so it runs for a year that hasn't started.
    return { id: p.id, name: p.name, holidays: v.holidays, assumed: v.assumed, blackouts: [], busy: busy, booked: thisYear ? [] : v.booked,
      budget: { vacation: vacation, carry: carry, personal: personal, booked: thisYear ? 0 : Math.round(v.bookedDays), buffer: cfg.bufferDays || 0, keep: 0,
        capCarry: v.capCarry, accrual: thisYear ? null : v.accrual } };
  });
  return { year: year, today: today, settings: st, people: people, locked: locked, pencilled: ptsPencilled_(today), saved: saved };
}

/** Which year the subtab shows by default: next year from October on. */
function ptsDefaultYear_(today) { var y = Number(today.slice(0, 4)); return Number(today.slice(5, 7)) >= 10 ? y + 1 : y; }

/** This year's leftovers card. */
function ptsUseItCard_(today, st) {
  var y = Number(today.slice(0, 4));
  var people = PTS_PEOPLE_.map(function(p) {
    var v = ptsPerson_(p, y, today);
    return { id: p.id, name: p.name, holidays: v.holidays, busy: v.booked, blackouts: (st.blackouts || {})[p.id] || [],
      personalLeft: Math.floor((v.remPersH || 0) / 8), vacationLeft: v.remVac || 0, capCarry: v.capCarry };
  });
  return ptsUseItBefore_(people, today, st);
}

// ---- routes ------------------------------------------------------------------------

/** GET pto_strategy [year] → { plan, useIt, presets, settings, defaultYear } */
function webPtoStrategy_(p) {
  p = p || {};
  try {
    var today = ptsToday_(), st = ptsSettingsRead_();
    var y = Number(p.year) || ptsDefaultYear_(today), ty = Number(today.slice(0, 4));
    if (y < ty || y > ty + 1) return { ok: false, error: 'Pick this year or next' };
    var plan = ptsPlan_(ptsInputs_(y, today, st));
    var useIt = null; try { useIt = ptsUseItCard_(today, st); } catch (e) { Logger.log('pto_strategy: leftovers unavailable'); }
    var presets = {}; Object.keys(PTS_PRESETS_).forEach(function(k) { presets[k] = { label: PTS_PRESETS_[k].label, about: PTS_PRESETS_[k].about }; });
    return { ok: true, today: today, defaultYear: ptsDefaultYear_(today), years: [ty, ty + 1], plan: plan, useIt: useIt, presets: presets, settings: st };
  } catch (e) { return { ok: false, error: 'The plan couldn’t be worked out: ' + e.message }; }
}

/** POST pto_strategy_settings { preset, overrides } → saved, then the fresh plan. reset:true clears overrides. */
function webPtoStrategySettings_(b) {
  b = b || {};
  var stored = { preset: PTS_PRESETS_[b.preset] ? b.preset : 'fill321', overrides: b.reset ? {} : (b.overrides && typeof b.overrides === 'object' ? b.overrides : {}) };
  var clean = ptsSettings_(stored);
  setConfigRow_('pto_strategy', JSON.stringify(stored));
  try { if (typeof _configCache_ !== 'undefined') _configCache_ = null; } catch (e) {}
  return Object.assign(webPtoStrategy_({ year: b.year }), { saved: true, changed: clean.changed });
}

/** Finds a pick in a fresh plan (or the leftovers card) by its id. */
function ptsFindPick_(id, year) {
  var today = ptsToday_(), st = ptsSettingsRead_();
  var plan = ptsPlan_(ptsInputs_(year, today, st));
  var all = plan.picks.concat(plan.more).concat(plan.skipped);
  if (year === Number(today.slice(0, 4))) { try { all = all.concat(ptsUseItCard_(today, st).picks); } catch (e) {} }
  return all.filter(function(c) { return c.id === id; })[0] || null;
}

/** POST pto_plan_accept { id, year } → on the VERA calendar and in the PTO Plan tab. */
function webPtoPlanAccept_(b) {
  b = b || {};
  var year = Number(b.year), id = String(b.id || '');
  if (!id || !year) return { ok: false, error: 'id and year required' };
  var c = ptsFindPick_(id, year);
  if (!c) return { ok: false, error: 'That break isn’t in the plan any more' };
  return veraLocked_(function() {
    var sh = ptsPlanSheet_(), saved = ptsSaved_(), eventId = '';
    if (saved[id] && saved[id].status === 'accepted') return { ok: true, id: id, already: true };
    try {
      var cal = getCalendarByName_(readPTOConfig_().veraCalendarName);
      if (cal) {
        var days = []; Object.keys(c.pto).forEach(function(k) { days = days.concat(c.pto[k]); }); days = days.filter(function(d, i, a) { return a.indexOf(d) === i; }).sort();
        var p = c.end.split('-').map(Number), q = c.start.split('-').map(Number);
        var ev = cal.createAllDayEvent('🌴 Time off: ' + c.label, new Date(q[0], q[1] - 1, q[2]), new Date(p[0], p[1] - 1, p[2] + 1),
          { description: 'Planned with VERA (PTO Planner › Next year). PTO days: ' + days.join(', ') + '. Request them at work; this event is VERA’s note, not the request.' });
        eventId = ev.getId();
      }
    } catch (e) { Logger.log('pto_plan_accept: the VERA calendar event couldn’t be made'); }
    var row = [id, year, c.who, c.label, c.start, c.end, JSON.stringify(c.pto), 'accepted', '', eventId, ptsToday_()];
    if (saved[id]) sh.getRange(saved[id].row, 1, 1, PTS_PLAN_HEADERS_.length).setValues([row]);
    else sh.appendRow(row);
    return { ok: true, id: id, onCalendar: !!eventId, label: c.label, days: c.days, longBreak: c.days >= 5 };
  });
}

/** POST pto_plan_skip { id, year, undo } → hidden (or shown again). */
function webPtoPlanSkip_(b) {
  b = b || {};
  var year = Number(b.year), id = String(b.id || '');
  if (!id || !year) return { ok: false, error: 'id and year required' };
  return veraLocked_(function() {
    var sh = ptsPlanSheet_(), saved = ptsSaved_();
    if (b.undo) { if (saved[id] && saved[id].status === 'skipped') sh.getRange(saved[id].row, 8).setValue('unskipped'); return { ok: true, id: id, action: 'unskipped' }; }
    if (saved[id] && saved[id].status === 'accepted') return { ok: false, error: 'Remove it first; it’s accepted' };
    var parts = id.split(':');
    var row = [id, year, parts[0], String(b.label || ''), '', '', '{}', 'skipped', '', '', ptsToday_()];
    if (saved[id]) sh.getRange(saved[id].row, 1, 1, PTS_PLAN_HEADERS_.length).setValues([row]); else sh.appendRow(row);
    return { ok: true, id: id, action: 'skipped' };
  });
}

/** POST pto_plan_remove { id } → an accepted break taken back off the plan and the VERA calendar. */
function webPtoPlanRemove_(b) {
  var id = String((b || {}).id || '');
  return veraLocked_(function() {
    var saved = ptsSaved_(), s = saved[id];
    if (!s || s.status !== 'accepted') return { ok: false, error: 'That break isn’t accepted' };
    try { if (s.eventId) { var cal = getCalendarByName_(readPTOConfig_().veraCalendarName); var ev = cal && cal.getEventById(s.eventId); if (ev) ev.deleteEvent(); } } catch (e) { Logger.log('pto_plan_remove: the calendar event couldn’t be removed'); }
    ptsPlanSheet_().getRange(s.row, 8).setValue('removed');
    return { ok: true, id: id, action: 'removed' };
  });
}

/** POST pto_plan_follow { id, what: 'away'|'trip' } → Away mode on its first day, or a pencilled Trip Idea. */
function webPtoPlanFollow_(b) {
  b = b || {};
  var id = String(b.id || ''), saved = ptsSaved_(), s = saved[id];
  if (!s || s.status !== 'accepted') return { ok: false, error: 'Accept the break first' };
  if (b.what === 'away') {
    var on = b.on !== false && b.on !== 'false';
    veraLocked_(function() { ptsPlanSheet_().getRange(s.row, 9).setValue(on ? 'yes' : ''); });
    return { ok: true, id: id, away: on };
  }
  if (b.what === 'trip') {
    if (typeof webMyTripPencil_ !== 'function') return { ok: false, error: 'Trip Ideas aren’t available' };
    var who = s.who === 'joint' ? 'Both' : s.who === 'ahmed' ? 'Ahmed' : 'Victoria';
    var r = webMyTripPencil_({ trip: { title: s.label, exactStart: s.start, exactEnd: s.end, travelers: who, note: 'From the PTO plan (' + s.start + ' to ' + s.end + ').' } });
    return r && r.ok ? { ok: true, id: id, idea: r.idea && r.idea.id } : r;
  }
  return { ok: false, error: 'what must be away or trip' };
}

/**
 * Pure: one person's accepted breaks for a year, for their own PTO subtab: each break,
 * whether its PTO is on their work calendar yet (events: [{startDate, endDate}]), the
 * PTO still to request, and the 3-2-1 slots the breaks fill.
 * → { breaks:[{id, label, start, end, days, onCalendar}], pending, slots:{longWeekend, midSizeWeek, bigPivot} }
 */
function ptsPlanFor_(saved, pid, year, events) {
  var out = { breaks: [], pending: 0, slots: { longWeekend: 0, midSizeWeek: 0, bigPivot: 0 } };
  Object.keys(saved || {}).forEach(function(id) {
    var s = saved[id];
    if (s.status !== 'accepted' || String(s.year) !== String(year) || (s.who !== pid && s.who !== 'joint')) return;
    var days = (s.pto || {})[pid] || [];
    var on = days.filter(function(d) { return (events || []).some(function(e) { return d >= e.startDate && d <= (e.endDate || e.startDate); }); }).length;
    var onCalendar = days.length > 0 && on === days.length;
    out.breaks.push({ id: id, label: s.label, start: s.start, end: s.end, days: days.length, onCalendar: onCalendar });
    out.pending += days.length - on;
    if (days.length) out.slots[ptsSlot_(days.length, ptsDays_(s.start, s.end) + 1)]++;
  });
  out.breaks.sort(function(a, b) { return a.start < b.start ? -1 : 1; });
  return out;
}

// ---- Weekend Planner -----------------------------------------------------------------

/** Accepted breaks in the next `days` days, as Weekend Planner windows (#248). */
function ptsPlanWindows_(today, days) {
  var t = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd'), end = ptsAdd_(t, days || 21), out = [];
  var saved = {}; try { saved = ptsSaved_(); } catch (e) { return out; }
  Object.keys(saved).forEach(function(id) {
    var s = saved[id];
    if (s.status !== 'accepted' || !s.start || s.end < t || s.start > end) return;
    var all = []; Object.keys(s.pto || {}).forEach(function(k) { all = all.concat(s.pto[k]); });
    out.push({ startDate: s.start, endDate: s.end, workdays: all.filter(function(d, i, a) { return a.indexOf(d) === i; }).length, bridgeType: 'planned-break',
      weekendStart: s.start, weekendEnd: s.end, totalCalDays: ptsDays_(s.start, s.end) + 1, label: s.label });
  });
  return out;
}

/** Pure: weekend windows with the planned breaks added; a planned break replaces any window it overlaps. */
function ptsMergeWindows_(windows, planned) {
  var keep = (windows || []).filter(function(w) { return !(planned || []).some(function(p) { return ptsOverlaps_(w.startDate, w.weekendEnd || w.endDate, p.startDate, p.endDate); }); });
  return keep.concat(planned || []).sort(function(a, b) { return a.startDate < b.startDate ? -1 : 1; });
}

// ---- nightly -------------------------------------------------------------------------

/**
 * Nightly (#248): the PTO plan's flags, and Away mode on an accepted break's first day.
 *   PTOPLAN|READY|<year>   from the trigger day while next year's plan has picks not yet accepted or skipped;
 *   PTOPLAN|USE|<person>|<year>   in December while personal time or over-cap vacation is unspent;
 *   PTOPLAN|REQ|<id>|<person>     N weeks before an accepted break until its PTO shows on the work calendar.
 */
function checkPTOStrategy_() {
  if (typeof isNotifEnabled_ === 'function' && !isNotifEnabled_('pto_strategy')) return { skipped: 'off' };
  var today = ptsToday_(), st = ptsSettingsRead_(), wanted = {}, y = Number(today.slice(0, 4));
  var names = {}; PTS_PEOPLE_.forEach(function(p) { names[p.id] = p.name; });
  var saved = ptsSaved_();
  // Plan ready
  try {
    var inputs = ptsInputs_(y + 1, today, st);
    if (ptsPlanDue_(today, st.trigger, inputs.people)) {
      var plan = ptsPlan_(inputs), open = plan.picks.filter(function(c) { return c.status === 'suggested'; });
      if (open.length) {
        var off = 0, pto = 0; open.forEach(function(c) { off += c.days; pto += c.cost; });
        wanted[PTS_FLAG_PREFIX_ + 'READY|' + (y + 1)] = { flag: '🗓 ' + (y + 1) + '’s PTO plan is ready', reason: open.length + ' break' + (open.length === 1 ? '' : 's') + ', ' + off + ' days off for ' + pto + ' PTO days. Accept or skip them in PTO Planner › Next year.', urgency: 'Medium' };
      }
    }
  } catch (e) { Logger.log('checkPTOStrategy_: next year’s plan unavailable — ' + e.message); }
  // Use it before Dec 31
  if (today.slice(5, 7) === '12') {
    try {
      ptsUseItCard_(today, st).people.forEach(function(r) {
        if (!r.total) return;
        wanted[PTS_FLAG_PREFIX_ + 'USE|' + r.id + '|' + y] = { flag: '⏳ ' + r.name + ': ' + r.total + ' day' + (r.total === 1 ? '' : 's') + ' to use before Dec 31',
          reason: (r.personal ? r.personal + ' personal (it doesn’t roll over)' : '') + (r.personal && r.overCap ? ' and ' : '') + (r.overCap ? r.overCap + ' vacation over what rolls over' : '') + '.', urgency: 'High', due: y + '-12-31' };
      });
    } catch (e) { Logger.log('checkPTOStrategy_: leftovers unavailable'); }
  }
  // Request it at work
  var accepted = Object.keys(saved).map(function(id) { return saved[id]; }).filter(function(s) { return s.status === 'accepted'; })
    .map(function(s) { return { id: s.id, label: s.label, pto: s.pto, start: s.start, end: s.end }; });
  var pending = function(c, pid) {
    try { var v = ptsPerson_({ id: pid, name: names[pid] }, Number((c.pto[pid] || [''])[0].slice(0, 4)), today); return !(c.pto[pid] || []).every(function(d) { return v.booked.some(function(b) { return d >= b[0] && d <= b[1]; }); }); }
    catch (e) { return true; }
  };
  Object.assign(wanted, ptsRequestFlags_(accepted, today, st, pending, names));
  var sheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (sheet) upsertKeyedFlags_(sheet, PTS_FLAG_PREFIX_, 'PTO', wanted, today);
  // Away mode on an accepted break's first day, when asked.
  Object.keys(saved).forEach(function(id) {
    var s = saved[id];
    if (s.status === 'accepted' && s.away && s.start === today && typeof awaySet_ === 'function') { try { awaySet_(true, s.end, s.label); } catch (e) { Logger.log('checkPTOStrategy_: Away mode couldn’t be turned on'); } }
  });
  return { flags: Object.keys(wanted).length };
}

/** The morning email's section (Nov–Dec): the plan's open picks and this year's leftovers. → {html, text} or null */
function ptsEmailSection_() {
  var today = ptsToday_(), m = today.slice(5, 7);
  if (m !== '11' && m !== '12') return null;
  if (typeof isNotifEnabled_ === 'function' && !isNotifEnabled_('pto_strategy')) return null;
  var st = ptsSettingsRead_(), y = Number(today.slice(0, 4)), lines = [];
  try {
    var inputs = ptsInputs_(y + 1, today, st);
    if (ptsPlanDue_(today, st.trigger, inputs.people)) ptsPlan_(inputs).picks.filter(function(c) { return c.status === 'suggested'; }).slice(0, 4).forEach(function(c) {
      var take = []; Object.keys(c.pto).forEach(function(k) { take = take.concat(c.pto[k]); });
      take = take.filter(function(d, i, a) { return a.indexOf(d) === i; }).sort();
      lines.push('<b>' + ptsEsc_(c.label) + '</b>: take ' + take.length + ' day' + (take.length === 1 ? '' : 's') + ' (' + take[0] + (take.length > 1 ? ' to ' + take[take.length - 1] : '') + '), get ' + c.days + ' off');
    });
  } catch (e) {}
  try { ptsUseItCard_(today, st).people.forEach(function(r) { if (r.total) lines.push('Still to use in ' + y + ': ' + ptsEsc_(r.name) + '’s ' + r.total + ' day' + (r.total === 1 ? '' : 's')); }); } catch (e) {}
  if (!lines.length) return null;
  var html = '<div style="margin:0 0 20px;padding:14px 16px;border:1px solid #e3e6ef;border-radius:8px;"><p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0d1b3e;">🌴 Time off</p><ul style="margin:0;padding-left:18px;font-size:14px;color:#333;">' +
    lines.map(function(l) { return '<li style="margin:0 0 4px;">' + l + '</li>'; }).join('') + '</ul></div>';
  return { html: html, text: 'Time off:\n' + lines.map(function(l) { return '  ' + l.replace(/<[^>]+>/g, ''); }).join('\n') };
}
function ptsEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
