// ============================================================
// VERA — Coverage.js
// Health › Care › Coverage (issue #257): one place to look things up instead of the insurance apps.
//   Cards    who has medical, dental and vision, and each card's numbers — READ from the household
//            cheat sheet (HouseholdInfo › Insurance), never copied; the doctors from its Medical,
//            Dental and Vision sections.
//   Covered  covered and not-covered services, read from the plan documents in Resources into
//            VERA's own Coverage tab; a row you correct (Edited = Yes) is never overwritten.
//   FSA/HSA  "is this eligible?", answered from the FSA guide and the eligible-expenses document,
//            with the source named; also in chat (ACTION:fsa_check).
//   Perks    employer perks (Hinge, Maven, …) with an optional yearly allowance and a log of uses.
// ============================================================

var CV_TAB_ = 'Coverage';
var CV_HEADERS_ = ['ID', 'Plan', 'Status', 'Service', 'Detail', 'Source', 'Page', 'Year', 'Edited', 'Updated'];
var CV_Q_TAB_ = 'Coverage Questions';
var CV_Q_HEADERS_ = ['Asked', 'Question', 'Verdict', 'Why', 'Source', 'By'];
var PK_TAB_ = 'Perks';
var PK_HEADERS_ = ['ID', 'Name', 'For', 'What', 'Link', 'Allowances', 'Resets', 'Notes'];
var PK_LOG_TAB_ = 'Perk Log';
var PK_LOG_HEADERS_ = ['ID', 'Perk ID', 'Kind', 'Date', 'Note'];
var CV_KINDS_ = { health: 'Medical', medical: 'Medical', dental: 'Dental', vision: 'Vision' };
var CV_PLANS_ = ['Medical', 'Dental', 'Vision'];
// The plan documents: an HR & Benefits resource, or one whose name or tags say what it is.
var CV_PLAN_DOC_RX_ = /medical|dental|vision|summary of benefits|\bsbc\b|health plan|coverage/i;
var CV_FSA_DOC_RX_ = /\bfsa\b|\bhsa\b|hcsa|spending account|eligible expense/i;
var CV_SENSITIVE_RX_ = /member|\bid\b|group|policy|account|subscriber|ssn|plan code|\bbin\b|\bpcn\b/i;

function cvText_(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

/**
 * Pure: the household cheat sheet's sections → the coverage cards, who has what, and the doctors.
 * people: the household's names. A card: Insurance › "<Kind> – <Person>".
 * → { cards:[{kind, person, provider, fields:[{label, value, private, rowNum}]}], grid:{Medical:{<person>:true…}}, doctors:[{kind, person, label, value}] }
 */
function cvFromHousehold_(sections, people) {
  var cards = [], doctors = [], grid = {};
  CV_PLANS_.forEach(function(k) { grid[k] = {}; (people || []).forEach(function(p) { grid[k][p] = false; }); });
  (sections || []).forEach(function(sec) {
    var s = cvText_(sec.section);
    (sec.subsections || []).forEach(function(sub) {
      var name = cvText_(sub.subsection);
      if (/^insurance$/i.test(s)) {
        var m = name.match(/^(health|medical|dental|vision)\s*[–\-:]\s*(.+)$/i);
        if (!m) return;
        var kind = CV_KINDS_[m[1].toLowerCase()], person = cvText_(m[2]);
        var fields = (sub.rows || []).map(function(r) {
          return { label: cvText_(r.label), value: cvText_(r.value), rowNum: r.rowNum,
            private: r.private === true || (r.private !== false && CV_SENSITIVE_RX_.test(r.label)) };
        });
        var prov = fields.filter(function(f) { return /^(provider|carrier|insurer)$/i.test(f.label); })[0];
        cards.push({ kind: kind, person: person, provider: prov ? prov.value : '', fields: fields.filter(function(f) { return f !== prov; }) });
        grid[kind] = grid[kind] || {};
        grid[kind][person] = true;
      } else if (CV_KINDS_[s.toLowerCase()] && name) {
        (sub.rows || []).forEach(function(r) { doctors.push({ kind: CV_KINDS_[s.toLowerCase()], person: name, label: cvText_(r.label), value: cvText_(r.value) }); });
      }
    });
  });
  return { cards: cards, grid: grid, doctors: doctors };
}

/** Pure: the household's people, from the cheat sheet's insurance cards and doctors (in order seen). */
function cvPeople_(sections) {
  var out = [];
  (sections || []).forEach(function(sec) { var s = cvText_(sec.section);
    (sec.subsections || []).forEach(function(sub) { var n = cvText_(sub.subsection), m;
      var who = /^insurance$/i.test(s) ? ((m = n.match(/^(?:health|medical|dental|vision)\s*[–\-:]\s*(.+)$/i)) ? cvText_(m[1]) : '') : (CV_KINDS_[s.toLowerCase()] ? n : '');
      if (who && out.indexOf(who) === -1) out.push(who); }); });
  return out;
}

/** Pure: Resources rows → the plan documents and the FSA documents. rows: [{id, name, category, tags}]. */
function cvPickDocs_(rows) {
  var plan = [], fsa = [];
  (rows || []).forEach(function(r) {
    var text = [r.name, r.tags, r.description].join(' ');
    if (CV_FSA_DOC_RX_.test(text) && /benefit|hr/i.test(r.category + ' ' + text)) fsa.push(r);
    else if (CV_PLAN_DOC_RX_.test(text) && /benefit|hr|health|insurance/i.test(r.category + ' ' + text)) plan.push(r);
  });
  return { plan: plan, fsa: fsa };
}

/**
 * Pure: the Coverage tab's rows after a fresh read of the plan documents. Rows you corrected
 * (Edited = Yes) stay as they are and a read never adds a second row for the same plan + service;
 * other rows for a plan the documents covered are replaced. now: ISO time.
 */
function cvMergeRows_(existing, fresh, now) {
  var keep = [], seen = {};
  var key = function(plan, service) { return cvText_(plan).toLowerCase() + '|' + cvText_(service).toLowerCase(); };
  var plansRead = {};
  (fresh || []).forEach(function(f) { plansRead[cvText_(f.plan)] = 1; });
  (existing || []).forEach(function(r) {
    var edited = /^(yes|true)$/i.test(cvText_(r[8]));
    if (edited || !plansRead[cvText_(r[1])]) { keep.push(r.slice(0, CV_HEADERS_.length)); seen[key(r[1], r[3])] = 1; }
  });
  var n = 0;
  (fresh || []).forEach(function(f) {
    var plan = CV_PLANS_.filter(function(p) { return p.toLowerCase() === cvText_(f.plan).toLowerCase(); })[0];
    if (!plan || !cvText_(f.service) || seen[key(plan, f.service)]) return;
    seen[key(plan, f.service)] = 1;
    keep.push(['CV-' + now.replace(/\D/g, '').slice(0, 14) + '-' + (++n), plan, /not/i.test(cvText_(f.status)) ? 'Not covered' : 'Covered', cvText_(f.service).slice(0, 120),
      cvText_(f.detail).slice(0, 300), cvText_(f.source).slice(0, 120), cvText_(f.page).slice(0, 20), cvText_(f.year).slice(0, 4), '', now]);
  });
  return keep;
}

/** Pure: a perk's allowances "therapy:6; coaching:6" → [{kind, of}]. */
function pkAllowances_(s) {
  return cvText_(s).split(/[;,]/).map(function(x) { var m = cvText_(x).match(/^(.+?)\s*:\s*(\d+)$/); return m ? { kind: m[1].toLowerCase(), of: Number(m[2]) } : null; }).filter(Boolean);
}

/** Pure: what's left of each allowance this year. logs: [{perkId, kind, date}]; year: 'yyyy'. */
function pkLeft_(perk, logs, year) {
  return pkAllowances_(perk.allowances).map(function(a) {
    var used = (logs || []).filter(function(l) { return l.perkId === perk.id && cvText_(l.kind).toLowerCase() === a.kind && String(l.date).slice(0, 4) === String(year); }).length;
    return { kind: a.kind, of: a.of, used: used, left: Math.max(0, a.of - used) };
  });
}

/** The perks seeded the first time: Hinge (the owner's) and Maven. */
var PK_SEED_ = [
  ['PK-HINGE', 'Hinge', '{owner}', 'Therapy and coaching sessions, free through Verizon.', '', 'therapy:6; coaching:6', 'yearly', ''],
  ['PK-MAVEN', 'Maven', 'Both', 'Family planning: fertility and pregnancy support, care advocates and video visits with specialists.', '', '', '', '']];

// ---- reading and writing ----------------------------------------------------------------------

function cvSheet_(name, headers) { return tiSchema_(ensureSheet(getSpreadsheet(), name, headers), headers); }

function pkRead_() {
  var sh = cvSheet_(PK_TAB_, PK_HEADERS_), rows = tiRows_(sh, PK_HEADERS_.length).filter(function(r) { return cvText_(r[0]); });
  if (!rows.length && !veraOnceGet_('PK_SEEDED')) {
    // The owner's perk is theirs by name (Config owner_name), never a name in the code.
    var owner = typeof peopleOwnerName_ === 'function' ? peopleOwnerName_() : 'Owner';
    rows = PK_SEED_.map(function(r) { return r.map(function(x) { return x === '{owner}' ? owner : x; }); });
    rows.forEach(function(r) { sh.appendRow(r); });
    veraOnceSet_('PK_SEEDED');
  }
  return rows.map(function(r) { return { id: cvText_(r[0]), name: cvText_(r[1]), forWho: cvText_(r[2]) || 'Both', what: cvText_(r[3]), link: cvText_(r[4]),
    allowances: cvText_(r[5]), resets: cvText_(r[6]) || 'yearly', notes: cvText_(r[7]) }; });
}

function pkLogRead_() {
  var tz = Session.getScriptTimeZone();
  return tiRows_(cvSheet_(PK_LOG_TAB_, PK_LOG_HEADERS_), PK_LOG_HEADERS_.length).filter(function(r) { return cvText_(r[0]); }).map(function(r) {
    var d = r[3] && typeof r[3].getFullYear === 'function' ? Utilities.formatDate(r[3], tz, 'yyyy-MM-dd') : cvText_(r[3]).slice(0, 10);
    return { id: cvText_(r[0]), perkId: cvText_(r[1]), kind: cvText_(r[2]).toLowerCase(), date: d, note: cvText_(r[4]) };
  });
}

function cvResourceRows_() {
  var sh = getSpreadsheet().getSheetByName(TABS.RESOURCES);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(cvText_), at = function(n) { return h.indexOf(n); };
  return v.slice(1).filter(function(r) { return cvText_(r[0]); }).map(function(r) {
    return { id: cvText_(r[0]), name: cvText_(r[at('Name')]), category: cvText_(r[at('Category')]), description: cvText_(r[at('Description')]), tags: cvText_(r[at('Tags')]) };
  });
}

/** GET coverage → { ok, cards, grid, doctors, people, covered, docs, questions, perks, year }. */
function webGetCoverage_() {
  var hh = getHouseholdInfoData_();
  var cards = cvFromHousehold_(hh.sections || [], cvPeople_(hh.sections || [])), people = cvPeople_(hh.sections || []);
  var covered = tiRows_(cvSheet_(CV_TAB_, CV_HEADERS_), CV_HEADERS_.length).filter(function(r) { return cvText_(r[0]); }).map(function(r) {
    return { id: cvText_(r[0]), plan: cvText_(r[1]), status: cvText_(r[2]), service: cvText_(r[3]), detail: cvText_(r[4]), source: cvText_(r[5]), page: cvText_(r[6]), year: cvText_(r[7]), edited: /^(yes|true)$/i.test(cvText_(r[8])) };
  });
  var docs = cvPickDocs_(cvResourceRows_());
  var questions = tiRows_(cvSheet_(CV_Q_TAB_, CV_Q_HEADERS_), CV_Q_HEADERS_.length).filter(function(r) { return cvText_(r[1]); }).slice(-10).reverse()
    .map(function(r) { return { question: cvText_(r[1]), verdict: cvText_(r[2]), why: cvText_(r[3]), source: cvText_(r[4]) }; });
  var year = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy'), logs = pkLogRead_();
  var perks = pkRead_().map(function(p) { return Object.assign(p, { left: pkLeft_(p, logs, year), log: logs.filter(function(l) { return l.perkId === p.id; }).sort(function(a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 8) }); });
  return { ok: true, people: people, cards: cards.cards, grid: cards.grid, doctors: cards.doctors, covered: covered,
    docs: { plan: docs.plan.map(function(d) { return d.name; }), fsa: docs.fsa.map(function(d) { return d.name; }) }, questions: questions, perks: perks, year: year, cheatSheetUrl: hh.sheetUrl || '' };
}

/** The text of some Resources documents, each capped, joined with its name. */
function cvDocsText_(list, cap) {
  return list.map(function(d) {
    var r = webFetchResourceContent_({ parameter: { id: d.id } });
    return r.ok ? '=== ' + r.name + ' ===\n' + String(r.content).slice(0, cap || 12000) : '';
  }).filter(Boolean).join('\n\n');
}

/** POST coverage_read_docs → reads the plan documents into the Coverage tab. */
function webCoverageReadDocs_() {
  var docs = cvPickDocs_(cvResourceRows_()).plan;
  if (!docs.length) return { ok: false, error: 'No plan documents in Resources yet. Add the medical, dental and vision plan summaries (category HR & Benefits), then try again.' };
  var text = cvDocsText_(docs, 12000);
  if (!text) return { ok: false, error: 'VERA couldn’t open the plan documents. Check they’re Google Docs it can read.' };
  var r = callClaudeJsonDetailed_('From these health plan documents, list what is covered and what is not covered. Reply with JSON only: ' +
    '{"rows":[{"plan":"Medical|Dental|Vision","status":"covered|not covered","service":"short name","detail":"cost or limit, short","source":"document name","page":"page or section if shown","year":"yyyy if shown"}]}. ' +
    'Use only what the documents say; at most 40 rows per plan; no advice.\n\n' + text, { maxTokens: 4000 });
  if (!r.json || !r.json.rows) return { ok: false, error: 'Couldn’t read the plan documents (' + (r.error || 'no answer') + ').' };
  return tiLocked_(function() {
    var sh = cvSheet_(CV_TAB_, CV_HEADERS_), rows = tiRows_(sh, CV_HEADERS_.length).filter(function(x) { return cvText_(x[0]); });
    var merged = cvMergeRows_(rows, r.json.rows, new Date().toISOString());
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, CV_HEADERS_.length).clearContent();
    if (merged.length) sh.getRange(2, 1, merged.length, CV_HEADERS_.length).setValues(merged);
    return { ok: true, rows: merged.length, from: docs.map(function(d) { return d.name; }) };
  });
}

/**
 * Is it FSA / HSA eligible? Reads the FSA documents in Resources (cached 6 hours) and answers
 * { verdict: 'yes' | 'no' | 'maybe', why, source }. Logged to Coverage Questions.
 */
function cvFsaCheck_(item, by) {
  item = cvText_(item).slice(0, 160);
  if (!item) return { ok: false, error: 'What are you buying?' };
  var cache = CacheService.getScriptCache(), text = cache.get('cv_fsa_docs');
  if (!text) {
    var docs = cvPickDocs_(cvResourceRows_()).fsa;
    text = docs.length ? cvDocsText_(docs, 9000) : '';
    if (text) try { cache.put('cv_fsa_docs', text.slice(0, 90000), 21600); } catch (e) {}
  }
  var r = callClaudeJsonDetailed_('Is this FSA / HSA eligible under the rules below? Item: "' + item + '". ' +
    (text ? 'Answer from these documents first, and name the one you used:\n\n' + text : 'No plan documents are available; answer from the general IRS eligibility rules and say so.') +
    '\n\nReply with JSON only: {"verdict":"yes|no|maybe","why":"one or two plain sentences","source":"document name, or IRS rules"}', { maxTokens: 400 });
  if (!r.json || !r.json.verdict) return { ok: false, error: 'Couldn’t check that right now.' };
  var out = { ok: true, item: item, verdict: /^y/i.test(r.json.verdict) ? 'yes' : /^n/i.test(r.json.verdict) ? 'no' : 'maybe', why: cvText_(r.json.why).slice(0, 400), source: cvText_(r.json.source).slice(0, 120) };
  try { cvSheet_(CV_Q_TAB_, CV_Q_HEADERS_).appendRow([new Date(), item, out.verdict, out.why, out.source, by || '']); } catch (e) {}
  return out;
}

/** POST coverage_ask { q } */
function webCoverageAsk_(body) { return cvFsaCheck_(body && body.q, (typeof _veraWho_ !== 'undefined' && _veraWho_ && _veraWho_.name) || ''); }

/** POST perk_save { id?, name, forWho, what, link, allowances, resets, notes } */
function webPerkSave_(body) {
  body = body || {};
  var name = cvText_(body.name).slice(0, 60);
  if (!name) return { ok: false, error: 'Give the perk a name.' };
  if (cvText_(body.allowances) && !pkAllowances_(body.allowances).length) return { ok: false, error: 'Write allowances like “therapy: 6; coaching: 6”.' };
  if (/^[=+@]/.test(name)) return { ok: false, error: 'A name can’t start with =, + or @.' };
  var row = [cvText_(body.id) || tiMintId_('PK-'), name, cvText_(body.forWho).slice(0, 40) || 'Both', cvText_(body.what).slice(0, 400), cvText_(body.link).slice(0, 300),
    cvText_(body.allowances).slice(0, 120), cvText_(body.resets).slice(0, 20) || 'yearly', cvText_(body.notes).slice(0, 300)];
  return tiLocked_(function() {
    var sh = cvSheet_(PK_TAB_, PK_HEADERS_), at = tiRowOf_(sh, PK_HEADERS_.length, row[0]);
    if (at === -1) sh.appendRow(row); else sh.getRange(at, 1, 1, PK_HEADERS_.length).setValues([row]);
    return { ok: true, id: row[0] };
  });
}

/** POST perk_delete { id } — the perk and its log. */
function webPerkDelete_(body) {
  var id = cvText_(body && body.id);
  if (!id) return { ok: false, error: 'id required' };
  return tiLocked_(function() {
    var sh = cvSheet_(PK_TAB_, PK_HEADERS_), at = tiRowOf_(sh, PK_HEADERS_.length, id);
    if (at === -1) return { ok: false, error: 'That perk no longer exists.' };
    sh.deleteRow(at);
    var lg = cvSheet_(PK_LOG_TAB_, PK_LOG_HEADERS_), rows = tiRows_(lg, PK_LOG_HEADERS_.length);
    for (var i = rows.length - 1; i >= 0; i--) if (cvText_(rows[i][1]) === id) lg.deleteRow(i + 2);
    return { ok: true };
  });
}

/** POST perk_log { perkId, kind, date, note } — one use; refused past the year's allowance. */
function webPerkLog_(body) {
  body = body || {};
  var perkId = cvText_(body.perkId), kind = cvText_(body.kind).toLowerCase(), date = cvText_(body.date).slice(0, 10) || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Pick a date.' };
  var perk = pkRead_().filter(function(p) { return p.id === perkId; })[0];
  if (!perk) return { ok: false, error: 'That perk no longer exists.' };
  var allow = pkAllowances_(perk.allowances);
  if (allow.length && !allow.some(function(a) { return a.kind === kind; })) return { ok: false, error: perk.name + ' has no “' + kind + '” allowance.' };
  return tiLocked_(function() {
    var left = pkLeft_(perk, pkLogRead_(), date.slice(0, 4)).filter(function(a) { return a.kind === kind; })[0];
    if (left && left.left <= 0) return { ok: false, error: 'All ' + left.of + ' ' + kind + ' sessions for ' + date.slice(0, 4) + ' are used.' };
    var lg = cvSheet_(PK_LOG_TAB_, PK_LOG_HEADERS_);
    var id = tiMintId_('PL-');
    lg.appendRow([id, perkId, kind, date, cvText_(body.note).slice(0, 200)]);
    return { ok: true, id: id, left: left ? left.left - 1 : null };
  });
}

/** POST perk_log_delete { id } */
function webPerkLogDelete_(body) {
  var id = cvText_(body && body.id);
  if (!id) return { ok: false, error: 'id required' };
  return tiLocked_(function() {
    var lg = cvSheet_(PK_LOG_TAB_, PK_LOG_HEADERS_), at = tiRowOf_(lg, PK_LOG_HEADERS_.length, id);
    if (at === -1) return { ok: false, error: 'Already removed.' };
    lg.deleteRow(at);
    return { ok: true };
  });
}
