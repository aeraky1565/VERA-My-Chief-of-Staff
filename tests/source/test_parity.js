// The two dashboards each hold their own copy of HomestewardView, and I have
// now twice changed one and shipped the other unchanged. This is the cheap
// check that catches it — no browser, no mounting, just: do the shipped files
// agree about the things that must match?
const fs = require('fs'), path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const FILES = ['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'];
const src = {};
FILES.forEach(f => { src[f] = fs.readFileSync(path.resolve(ROOT, f), 'utf8'); });

// Each rule: a name, and a predicate over one file's source.
const RULES = [
  ['sub-tab is named "Warranties & Service"', s => /Warranties & Service/.test(s)],
  ['the old "🏠 Steward" label is gone',       s => !/🏠 Steward/.test(s)],
  ['the warranty banner exists',               s => /warranty-banner/.test(s)],
  ['badge has a red tier at 14 days',          s => /days\s*<=\s*14\)\s*return\s*\{\s*label:\s*`🔴 Expires/.test(s)
                                                 || /days<=14\)return\{label:`🔴 Expires/.test(s)],
  ['badge has an amber tier at 60 days',       s => /days\s*<=\s*60\)\s*return\s*\{\s*label:\s*`🟡 Expires/.test(s)
                                                 || /days<=60\)return\{label:`🟡 Expires/.test(s)],
  ['the old 30-day amber threshold is gone',   s => !/days\s*<=\s*30\)\s*return\s*\{\s*label:\s*`🟡 Expires/.test(s)
                                                 && !/days<=30\)return\{label:`🟡 Expires/.test(s)],
  ['calls add_home_item',                      s => /add_home_item/.test(s)],
  ['calls delete_home_item',                   s => /delete_home_item/.test(s)],
  // Only class names written literally in source — the per-field ones are built
  // as "hi-" + key at runtime, so grepping for those proves nothing either way.
  // test_homeitem_ui.js is what proves the fields exist, by filling them.
  ['the add form is present',                  s => /add-item-btn/.test(s) && /add-item-modal/.test(s)
                                                 && /hi-intervalMonths/.test(s) && /hi-save/.test(s)],
  ['the per-row delete is present',            s => /hi-delete/.test(s)],
  ['the empty state no longer points at the sheet',
                                               s => !/Add rows to the Home Items tab/.test(s)],

  // Tentative holds (issue #187 phase 1) — both dashboards collapse option
  // groups and draw the hold affordances, or one of them silently shows a
  // packed afternoon that does not exist.
  ['collapses option groups',                  s => /collapseOptionGroups/.test(s)],
  ['groups options into one row',              s => /groupItineraryOptions/.test(s)],
  ['reads the tentative flag',                 s => /isTentativeItem/.test(s)],
  ['draws the hold chip',                      s => /itin-hold-chip/.test(s)],
  ['offers the options disclosure',            s => /itin-hold-options/.test(s)],
  ['hatches a hold at 45°',                    s => /repeating-linear-gradient\(45deg, rgba\(122,131,150/.test(s)],

  // Trip decisions (issue #187 phase 2) — the disclosure is actionable now.
  // If one dashboard keeps the read-only phase 1 version, that user can see an
  // open decision and have no way to close it.
  ['reads the decision status',                s => /decisionStatusOf/.test(s)],
  ['reads the derived decide-by',              s => /decideByOf/.test(s)],
  ['knows a decided group',                    s => /isDecidedItem/.test(s)],
  ['knows an overdue decision',                s => /isOverdueDecision/.test(s)],
  ['offers Confirm per option',                s => /itin-confirm-btn/.test(s)],
  ['offers Undo on a decided group',           s => /itin-undo-btn/.test(s)],
  ['calls decide_trip_option',                 s => /decide_trip_option/.test(s)],
  ['calls reopen_trip_decision',               s => /reopen_trip_decision/.test(s)],
  ['the phase 1 read-only copy is gone',       s => !/confirm one from the calendar/i.test(s)],

  // The recommendation (issue #187 phase 3). If one dashboard renders the
  // suggestion and the other does not, the same open decision looks like two
  // different decisions depending on which page you opened.
  ['reads the recommended option',             s => /recommendedIdOf/.test(s)],
  ['reads the reason for it',                  s => /recommendBecauseOf/.test(s)],
  ['marks the suggested option',               s => /itin-suggested-chip/.test(s)],
  ['shows why it is suggested',                s => /itin-suggested-why/.test(s)],

  // The meal planner. One dashboard showing one week while the other shows two is
  // not a cosmetic split: you cannot move a dinner into a week that is not drawn.
  ['the planner asks for two weeks',           s => /weeks\s*:\s*2/.test(s)],
  ['it draws a week section',                  s => /mp-week/.test(s)],
  ['past days collapse behind a toggle',       s => /mp-past-toggle/.test(s)],
  ['a dinner can be picked up',                s => /mp-handle/.test(s)],
  ['…and dropped on another day',              s => /mp-target/.test(s)],
  ['it calls move_meal',                       s => /move_meal/.test(s)],
  // Suggest opens the shared MealHand sheet, which asks for the week it was opened on.
  ['Suggest Week names the week it fills',     s => /props\.call\('suggest_week',\{weekStart:props\.weekStart\}\)/.test(s)
                                                 && /setSheet\(\{\s*kind\s*:\s*'suggest',\s*weekStart\s*:\s*weekStart\s*\}\)/.test(s)],
  // The silent-failure path that hid the save bug for weeks: `if (r.ok) load()` with
  // no else, so a rejected write looked exactly like a successful one.
  ['a failed write is shown, not swallowed',   s => /mp-error/.test(s)],
  // Both weeks are LABELLED, not just fetched. Asking for two and drawing one is the
  // failure this pair of rules exists to separate.
  ['this week is labelled',                    s => /'This week'/.test(s)],
  ['next week is labelled',                    s => /'Next week'/.test(s)],

  // THE TAB ITSELF, not just the component inside it.
  //
  // Everything above checks that the planner is BUILT in both pages. None of it
  // checked that it is REACHABLE, and that is the gap that let the sub-tab go missing
  // from dashboard-lite with every rule still green: a perfect component behind a
  // button that was not drawn.
  ['the Meal Plan sub-tab is registered',      s => /id:\s*'meal_plan'/.test(s)],
  // No featureKey. It had one, and a Config row set to 'false' removed the tab from a
  // page with nothing anywhere saying why — a switch whose only feedback was absence.
  ['…and nothing can flag it out of existence',
                                               s => !/featureKey\s*:\s*'meal_planner'/.test(s)],
  // The neighbours keep their flags, so the rule above proves the gate came off the
  // right entry rather than the filter losing the ability to hide anything at all.
  ['…while Takeouts and Pantry keep theirs',   s => /featureKey\s*:\s*'takeouts'/.test(s)
                                                 && /featureKey\s*:\s*'pantry'/.test(s)],
];

RULES.forEach(([name, fn]) => {
  const results = FILES.map(f => [f, fn(src[f])]);
  const bad = results.filter(([, ok]) => !ok).map(([f]) => f);
  check(name, bad.length === 0, bad.length ? 'missing in ' + bad.join(', ') : undefined);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
