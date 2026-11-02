// ============================================================
// VERA — PlannerGoals.js
// Finances › Goals, read live from the work-optional planner's sheet (the same
// sheet the Net Worth tab reads: Config `planner_sheet_id`).
// ============================================================
//
// The planner belongs to another system, so the Net Worth rules hold here too:
//
//   1. VERA ONLY READS IT. The read goes through nwReadTabs_ (NetWorth.js), which
//      calls getSheetByName and getDataRange().getValues() and nothing else.
//   2. EVERY READ IS BY LABEL. Columns by header (nwCol_), settings by key. A
//      required column that can't be found makes the goals UNAVAILABLE, never a guess.
//
// What the tab shows, per goal (one row of the planner's Goals tab):
//   · one-off and reserve goals: saved against the target. A goal linked to the
//     house takes its target from the house plan: price × down % + closing costs.
//     A one-off over its target is READY (the money waits for the purchase); a goal
//     the planner marks achieved is REACHED.
//   · yearly budgets: what's planned against the budget, this year and next, from
//     the planner's Plan items: items whose Goal names this goal, plus — for a travel
//     budget — every trip.
//   · the share columns ("Ahmed share", …) are each person's share of the TARGET.
//   · a reserve goal also shows the planner's 12-month cash low against its floor.
// ============================================================

var PG_KINDS_ = { 'one-off': 'one-off', 'oneoff': 'one-off', 'one off': 'one-off', 'reserve': 'reserve',
                  'yearly budget': 'yearly', 'yearly': 'yearly', 'budget': 'yearly' };

/** A cell's text, trimmed. */
function pgText_(v) { return String(v == null ? '' : v).trim(); }

/**
 * Goals: Goal | Kind | Priority | Status | Target | Target month | Saved or kept |
 * <name> share … | Linked to house. Share columns are whatever headers end in
 * " share", so a new person's column shows rather than being dropped.
 */
function pgParseGoals_(grid) {
  if (!grid || grid.length < 1) return nwUnavailable_('the Goals tab is empty');
  var h = grid[0];
  var cols = { goal: nwCol_(h, 'Goal'), kind: nwCol_(h, 'Kind'), status: nwCol_(h, 'Status'),
               target: nwCol_(h, 'Target'), saved: nwCol_(h, 'Saved or kept') };
  var missing = Object.keys(cols).filter(function(k) { return cols[k] === -1; });
  if (missing.length) return nwUnavailable_('the Goals tab has no ' + missing.join(', ') + ' column');
  var prio = nwCol_(h, 'Priority'), month = nwCol_(h, 'Target month'), house = nwCol_(h, 'Linked to house');
  var shares = [];
  h.forEach(function(x, i) { var m = pgText_(x).match(/^(.+?)\s+share$/i); if (m) shares.push({ who: m[1], col: i }); });
  var goals = [];
  for (var r = 1; r < grid.length; r++) {
    var row = grid[r], name = pgText_(row[cols.goal]);
    if (!name) continue;
    var kindRaw = nwNorm_(row[cols.kind]);
    goals.push({
      name:     name,
      kind:     PG_KINDS_[kindRaw] || kindRaw || 'one-off',
      priority: prio === -1 ? '' : nwNorm_(row[prio]),
      status:   nwNorm_(row[cols.status]) || 'active',
      target:   nwNumber_(row[cols.target]),
      month:    month === -1 ? '' : nwIsoMonth_(row[month]),
      saved:    nwNumber_(row[cols.saved]),
      house:    house === -1 ? false : nwBool_(row[house]),
      shares:   shares.map(function(s) { return { who: s.who, amount: nwNumber_(row[s.col]) }; })
                      .filter(function(s) { return s.amount; }),
    });
  }
  return { status: 'ok', goals: goals };
}

/** Settings Key/Value pairs, as {key: raw value}. */
function pgSettings_(grid) {
  var out = {};
  if (!grid || grid.length < 1) return out;
  var k = nwCol_(grid[0], 'Key'), v = nwCol_(grid[0], 'Value');
  if (k === -1 || v === -1) return out;
  for (var r = 1; r < grid.length; r++) { var key = pgText_(grid[r][k]); if (key) out[key] = grid[r][v]; }
  return out;
}

/** The house plan from Settings: price, down %, closing costs, month. null when it's off or incomplete. */
function pgHouse_(settings) {
  if (!settings || !('house.price' in settings)) return null;
  if ('house.on' in settings && !nwBool_(settings['house.on'])) return null;
  var price = nwNumber_(settings['house.price']), pct = nwNumber_(settings['house.downPct']);
  if (!price || pct === null) return null;
  var extra = nwNumber_(settings['house.extra']) || 0;
  return { price: price, downPct: pct, extra: extra, month: nwIsoMonth_(settings['house.date']),
           down: Math.round(price * pct / 100 + extra) };
}

/** Outputs: when the planner last calculated ("Nov 1, 2026"), and the 12-month cash low. */
function pgOutputs_(grid) {
  var out = { calculated: '', cashLow: null, cashLowWhen: '' };
  (grid || []).forEach(function(row) {
    var a = pgText_(row[0]);
    var m = a.match(/^Calculated\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
    if (m && !out.calculated) out.calculated = m[1];
    if (nwNorm_(a) === '12-month cash low') {
      out.cashLow = nwNumber_(row[1]);
      out.cashLowWhen = pgText_(row[2]).split(';')[0].trim();
    }
  });
  return out;
}

/** Pure: is a planned spend counted against this yearly budget? */
function pgCounts_(goal, item) {
  if (item.goal) return nwNorm_(item.goal) === nwNorm_(goal.name);
  return /travel|trip/i.test(goal.name) && nwNorm_(item.category) === 'trip';
}

/** Pure: the Goals tab's payload from the parsed pieces. today: 'yyyy-MM-dd'. */
function pgBuild_(goals, house, plans, outputs, floor, today) {
  var year = Number(today.slice(0, 4)), thisMonth = today.slice(0, 7);
  var list = goals.map(function(g) {
    var x = { name: g.name, kind: g.kind, priority: g.priority, status: g.status, saved: g.saved,
              target: g.target, month: g.month, shares: g.shares, house: g.house };
    if (g.house && house) {
      x.target = house.down; x.targetFrom = 'house';
      x.houseLine = { price: house.price, downPct: house.downPct, extra: house.extra, month: house.month };
      if (!x.month) x.month = house.month;
    }
    if (g.kind === 'yearly') {
      x.years = [year, year + 1].map(function(y) {
        var items = (plans || []).filter(function(p) { return p.month && Number(p.month.slice(0, 4)) === y && pgCounts_(g, p); })
          .map(function(p) { return { item: p.item, month: p.month, amount: p.amount || 0, confidence: p.confidence, past: p.month < thisMonth }; });
        var planned = items.reduce(function(n, p) { return n + p.amount; }, 0);
        var next = items.filter(function(p) { return !p.past; })[0] || null;
        return { year: y, planned: planned, left: x.target != null ? x.target - planned : null, items: items, next: next };
      });
    }
    if (g.status === 'achieved') x.state = 'reached';
    else if (g.status === 'paused') x.state = 'paused';
    else if (g.kind !== 'yearly' && x.target > 0 && x.saved >= x.target) x.state = g.kind === 'one-off' ? 'ready' : 'reached';
    else x.state = 'active';
    if (g.kind !== 'yearly' && x.target > 0) x.pct = Math.round(x.saved / x.target * 100);
    if (g.kind === 'reserve' && outputs && outputs.cashLow != null) x.cashLow = { amount: outputs.cashLow, when: outputs.cashLowWhen, floor: floor };
    return x;
  });
  var rank = { active: 0, paused: 1, ready: 2, reached: 3 };
  list.sort(function(a, b) {
    return (rank[a.state] - rank[b.state]) || ((a.priority === 'must' ? 0 : 1) - (b.priority === 'must' ? 0 : 1));
  });
  var done = list.filter(function(g) { return g.state === 'ready' || g.state === 'reached'; }).length;
  var setAside = list.reduce(function(n, g) { return n + (g.saved || 0); }, 0);
  var toGo = list.filter(function(g) { return g.state === 'active'; }).reduce(function(n, g) {
    var left = g.kind === 'yearly' ? (g.years[0].left || 0) : (g.target || 0) - (g.saved || 0);
    return n + Math.max(0, left);
  }, 0);
  return { goals: list, summary: { count: list.length, done: done, setAside: setAside, toGo: toGo } };
}

/** GET ?action=planner_goals — the Goals tab. Reads the planner; never writes it. */
function webGetPlannerGoals_() {
  var cfg = getConfigValues();
  var sheetId = String(cfg['planner_sheet_id'] || '').trim();
  if (!sheetId) return { ok: true, configured: false };
  var tabs;
  try { tabs = nwReadTabs_(sheetId, ['Goals', 'Settings', 'Plan items', 'Outputs']); }
  catch (e) { return { ok: false, error: 'Couldn’t open the planner sheet: ' + e.message }; }
  var parsed = tabs['Goals'] ? pgParseGoals_(tabs['Goals']) : nwUnavailable_('the planner has no "Goals" tab');
  if (parsed.status !== 'ok') return { ok: true, configured: true, status: 'unavailable', reason: parsed.reason };
  var settings = pgSettings_(tabs['Settings']);
  var plans = tabs['Plan items'] ? nwParsePlans_(tabs['Plan items']) : null;
  var outputs = pgOutputs_(tabs['Outputs']);
  var asOf = tabs['Settings'] ? nwParseAsOf_(tabs['Settings']) : null;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var floor = 'floor' in settings ? nwNumber_(settings['floor']) : null;
  var out = pgBuild_(parsed.goals, pgHouse_(settings), plans && plans.status === 'ok' ? plans.items : [], outputs, floor, today);
  out.ok = true; out.configured = true; out.status = 'ok';
  out.calculated = outputs.calculated;
  out.asOf = asOf && asOf.status === 'ok' ? asOf.iso : '';
  out.plansAvailable = !!(plans && plans.status === 'ok');
  out.plannerUrl = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId) + '/edit';
  return out;
}
