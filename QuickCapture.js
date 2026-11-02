/**
 * QuickCapture.js — Life › Quick capture (issue #222, stage 5).
 *
 * One box at the top of Life. VERA turns what you type into ONE line of Chat's action
 * grammar (ACTION:type|args — the same lines Chat writes), restricted to five kinds:
 *   log_practice|{goal}|{minutes}|{note}       practice on a Growth goal
 *   log_interest|{person}|{interest}|{category} a place or thing you love
 *   add_idea|{idea}|{category}|{tags}           an idea
 *   log_giving|{kind}|{organisation}|{amount or hours}|{date}|{notes}
 *   add_note|{title}|{text}                     anything else, as a note
 * and files it with the same functions Chat's actions use, so typing it here and saying
 * it in Chat behave the same. It says what it filed and how to undo it.
 */

var QC_KINDS_ = ['log_practice', 'log_interest', 'add_idea', 'log_giving', 'add_note'];

/** Pure: the one action line in a reply, as { type, args }, or null. Same match as Chat's executeActions_. */
function qcParse_(reply) {
  var lines = String(reply || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].replace(/^[\s`]+/, '').replace(/[`]+$/, '');
    var m = t.match(/^ACTION:(\w+)\|(.+)$/);
    if (m && QC_KINDS_.indexOf(m[1]) !== -1) return { type: m[1], args: m[2].split('|').map(function(a) { return a.trim(); }) };
  }
  return null;
}

/** Pure: the prompt — Now goals named, today's date, the five lines and nothing else. */
function qcPrompt_(text, goals, today) {
  return 'You file one thing Ahmed typed into VERA\'s Life tab. Today is ' + today + '.\n' +
    'His Growth goals in Now: ' + (goals.length ? goals.join('; ') : '(none)') + '.\n' +
    'Reply with EXACTLY ONE line, one of:\n' +
    'ACTION:log_practice|{goal name from the list}|{minutes or blank}|{short note}   — he practised a Now goal\n' +
    'ACTION:log_interest|{Ahmed or Victoria}|{the place or thing}|{Food/Travel/Fitness/Culture/Hobbies/Learning/Other}   — somewhere or something they like or want to try\n' +
    'ACTION:add_idea|{the idea}|{category}|{tags}   — an idea for later\n' +
    'ACTION:log_giving|{donation or volunteering}|{organisation}|{amount in dollars, or hours}|{date YYYY-MM-DD or blank}|{notes}\n' +
    'ACTION:add_note|{short title}|{the text}   — anything else\n' +
    'Use log_practice only for a goal in the list. Never invent details he did not type.\n\n' +
    'He typed: ' + String(text).slice(0, 600);
}

/** Pure: when VERA can't be asked — practice for a goal he names by its words, else a note. */
function qcFallback_(text, goals) {
  var t = lfNorm_(text), hit = null;
  (goals || []).forEach(function(g) { if (!hit && lgGoalWords_(g).some(function(w) { return (' ' + t + ' ').indexOf(' ' + w) !== -1; }) && /\b(did|done|practi[sc]ed|went|min)\b/.test(t)) hit = g; });
  if (hit) { var m = t.match(/(\d+)\s*min/); return { type: 'log_practice', args: [hit, m ? m[1] : '', ''] }; }
  return { type: 'add_note', args: [String(text).slice(0, 40), String(text)] };
}

/** Files one action and says how to undo it: { ok, kind, said, undo: { action, … } }. */
function qcFile_(act) {
  var a = act.args;
  if (act.type === 'log_practice') {
    var p = lgChatLogPractice_(a);
    if (!p.ok) return p;
    return { ok: true, kind: 'practice', said: 'Logged ' + p.goal + (p.minutes ? ', ' + p.minutes + ' min' : '') + ' for today.',
      undo: p.added ? { action: 'life_practice_undo', goalId: lgFindGoal_(lgGoals_(), a[0]).id, day: p.day } : null };
  }
  if (act.type === 'log_interest') {
    var it = createInterest_(a[0] || 'Ahmed', a[1] || '', a[2] || 'Other', 'Manual', 'Quick capture');
    return { ok: true, kind: 'interest', said: 'Saved “' + it.interest + '” to Explore.', undo: { action: 'interests_delete', id: it.id, via: 'get' } };
  }
  if (act.type === 'add_idea') {
    var idea = webAddIdea_({ parameter: { idea: a[0] || '', category: a[1] || 'General', tags: a[2] || '' } });
    return { ok: true, kind: 'idea', said: 'Added the idea “' + lfStr_(a[0], 60) + '”.', undo: { action: 'delete_idea', id: idea.id, via: 'get' } };
  }
  if (act.type === 'log_giving') {
    var g = lfChatLogGiving_(a);
    if (!g.ok) return g;
    return { ok: true, kind: 'giving', said: 'Logged ' + (g.entry.kind === 'donation' ? 'a donation to ' : 'volunteering at ') + g.entry.organisation + '.', undo: { action: 'life_giving_delete', id: g.entry.id } };
  }
  var n = webAddNote_({ parameter: { title: lfStr_(a[0], 80) || 'Quick note', content: a[1] || a[0] || '', category: 'Quick capture' } });
  if (!n.ok) return n;
  return { ok: true, kind: 'note', said: 'Saved a note.', undo: { action: 'delete_note', id: n.id, via: 'get' } };
}

/** POST life_quick_capture { text } */
function webLifeQuickCapture_(body) {
  var text = lfStr_(body && body.text, 600);
  if (!text) return { ok: false, error: 'Type something to file' };
  var goals = []; try { goals = lgGoals_().filter(function(g) { return g.focus === 'now'; }).map(function(g) { return g.title; }); } catch (e) {}
  var act = null;
  try { var r = callClaudeJsonDetailed_(qcPrompt_(text, goals, lfToday_()), { maxTokens: 200 }); act = qcParse_(r && r.raw); } catch (e) {}
  if (!act) act = qcFallback_(text, goals);
  if (act.type === 'log_practice' && !lgFindGoal_(lgGoals_(), act.args[0])) act = { type: 'add_note', args: [text.slice(0, 40), text] };
  return qcFile_(act);   // each filing function takes the lock it needs
}
