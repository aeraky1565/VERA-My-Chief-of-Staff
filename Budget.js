// ============================================================
// VERA — Budget.js
// Finances › Budget (issue #226): the budget tracker's Tracker tab, read live and BY LABEL,
// with the summary worked out by VERA from the lines (the BudgetEngine block below, shared
// word for word with both dashboards so What if runs in the browser).
// ============================================================
//
//   1. THE TRACKER IS ONLY READ. bgReadTracker_ calls getSheetByName and
//      getDataRange().getValues() and nothing else.
//   2. VERA's summary is shown beside the tracker's (budgetMatch_): a moved row or a broken
//      formula shows as a difference instead of quietly changing a number.
//   3. What if never touches the tracker. A scenario is saved to VERA's own sheet,
//      "Budget Scenarios", for the quarterly check-in.
//   4. A shared line's category comes from Config `budget_category:<line>` when set, else from
//      the rules in BG_CATS; a line neither covers shows under Other.
// ============================================================

var BG_SCENARIOS_TAB_ = 'Budget Scenarios';
var BG_SCENARIO_HEADERS_ = ['ID', 'Name', 'Changes JSON', 'Results JSON', 'Created', 'Quarter'];

// ---- BudgetEngine (Finances › Budget, issue #226) — SHARED VERBATIM by Budget.js, docs/app.js and docs/dashboard-lite.html ----
// Reads the budget tracker's Tracker tab BY LABEL (never by cell position) and works the summary out
// from the lines, the way the tracker does, so What if can run in the browser with no round trips:
//   shared total      = every shared line (the What If Scenarios rows are left out)
//   split             = the first person's share; the second gets the rest (60/40 today)
//   contribution      = shared total × that person's share
//   required          = the shared fixed lines, credits left out
//   shared savings    = the tracker's total, split by the same shares
//   → AMEX Checking   = contribution − the shared lines charged to that person's own cards
//   → AMEX Savings    = that person's shared savings
//   net income        = gross − deductions (for both people; the tracker types one of them)
//   net expenses      = fixed + nice to have + personal savings + contribution + shared savings
//   disposable        = net income − net expenses
//   emergency fund    = required × 3, 6 and 9 months, by share and half each
// Overrides (What if) are { key: amount }: '<person>.gross', '<person>.ded:<line>',
// '<person>.fixed:<line>', '<person>.nice:<line>', '<person>.psave', 'shared.fixed:<line>',
// 'shared.nice:<line>', 'split' (0–1) and 'shared.savings'.
// A line another tracker replaces (the phone plan) keeps the budget tracker's figure as trackerAmount;
// budgetCompute_(…, raw) uses those, and budgetMatch_(model, c, raw) then names that cause.
var BG_CATS=[
  ['Housing',/\brent\b|renter/i],
  ['Utilities',/utilit|internet|family plan|phone|electric|water|\bgas\b/i],
  ['Health',/health|medical|vision|dental/i],
  ['Household',/grocer|costco|cleaning|\btips?\b/i],
  ['Insurance & subscriptions',/insurance|subscription|membership/i]];
function bgText_(v){return String(v==null?'':v).replace(/\s+/g,' ').trim();}
function bgLow_(v){return bgText_(v).toLowerCase().replace(/:$/,'');}
function bgNum_(v){if(typeof v==='number')return isFinite(v)?v:null;var s=bgText_(v).replace(/[$,\s]/g,'');if(!s)return null;
  var neg=/^\(.*\)$/.test(s);s=s.replace(/[()]/g,'');var pct=/%$/.test(s);var n=parseFloat(s.replace(/%$/,''));if(isNaN(n))return null;if(pct)n=n/100;return neg?-n:n;}
function bgPct_(v){var n=bgNum_(v);if(n==null)return null;if(typeof v==='number'&&n>1)n=n/100;return n;}
function bgRound_(n){return Math.round((Number(n)||0)*100)/100;}
function bgDueDay_(label){var m=bgText_(label).match(/\((\d{1,2})(?:st|nd|rd|th)\)/i);return m?Number(m[1]):null;}
function bgName_(label){return bgText_(label).replace(/\s*\((\d{1,2})(?:st|nd|rd|th)\)\s*/i,' ').trim();}
// Pure: the category of a shared line: the Config map first (budget_category:<line>), then the rules, else Other.
function bgCategory_(name,catMap){var k=bgLow_(name);if(catMap&&catMap[k])return catMap[k];
  for(var i=0;i<BG_CATS.length;i++)if(BG_CATS[i][1].test(name))return BG_CATS[i][0];return 'Other';}
// Pure: the Tracker tab (rows of cells) → the model. { ok:false, error } when the layout can't be read.
function budgetModel_(grid){
  grid=grid||[];var head=-1,sc=-1;
  for(var r=0;r<grid.length&&head===-1;r++){var row=grid[r]||[];for(var c=0;c<row.length;c++)if(bgLow_(row[c])==='shared expenses'){head=r;sc=c;break;}}
  if(head===-1)return {ok:false,error:'The tracker has no “Shared Expenses” heading.'};
  var people=[];(grid[head]||[]).forEach(function(cell,c){var t=bgText_(cell);if(t&&c!==sc&&!/^\d{4}$/.test(t)&&!/^what if$/i.test(t))people.push({key:t.toLowerCase(),name:t,col:c});});
  if(people.length!==2)return {ok:false,error:'The tracker should name two people beside “Shared Expenses”; it names '+people.length+'.'};
  var missing=[],seen={};
  var keyFor=function(prefix,name){var k=prefix+':'+name,n=2;while(seen[k])k=prefix+':'+name+' #'+(n++);seen[k]=1;return k;};
  var at=function(r,c){return (grid[r]||[])[c];};
  // each person's column: income, deductions, expenses, then the contributions
  var model={ok:true,people:[],shared:{fixed:[],nice:[],whatif:[]},split:null,sharedSavings:null,
    tracker:{contribution:{},checking:{},savings:{},ownCards:{}},missing:missing};
  people.forEach(function(p){
    var P={key:p.key,name:p.name,gross:null,deductions:[],netTyped:null,fixed:[],nice:[],psave:null,typed:{}},state='';
    for(var r=head+1;r<grid.length;r++){var l=bgLow_(at(r,p.col)),v=at(r,p.col+1),name=bgText_(at(r,p.col));if(!l)continue;
      if(l==='monthly income'){state='income';continue;}
      if(l==='gross income'&&state==='income'){P.gross=bgNum_(v)||0;state='ded';continue;}
      if(l==='net income'){P.netTyped=bgNum_(v);state='';continue;}
      if(l==='monthly expenses'){state='exp';continue;}
      if(l==='fixed expenses'&&state){state='fixed';continue;}
      if(l==='nice to have expenses'){state='nice';continue;}
      if(l==='personal savings contribution'){P.psave=bgNum_(v)||0;state='sum';continue;}
      if(l==='shared expense contribution'){P.typed.contribution=bgNum_(v);continue;}
      if(l==='shared savings contribution'){P.typed.sharedSavings=bgNum_(v);continue;}
      if(l==='net expenses'){P.typed.netExpenses=bgNum_(v);continue;}
      if(l==='disposable income'){P.typed.disposable=bgNum_(v);break;}
      if(state==='ded')P.deductions.push({key:keyFor(p.key+'.ded',name),name:name,amount:bgNum_(v)||0});
      else if(state==='fixed'||state==='nice')P[state].push({key:keyFor(p.key+'.'+state,name),name:name,amount:bgNum_(v)||0});}
    if(P.gross==null)missing.push(p.name+' · Gross Income');
    if(P.psave==null){missing.push(p.name+' · Personal Savings Contribution');P.psave=0;}
    model.people.push(P);});
  // the shared column: fixed, nice to have, what-if rows, then the summary
  var state='',byName={};people.forEach(function(p){byName[p.key]=p;});
  for(var r2=head+1;r2<grid.length;r2++){var lab=bgText_(at(r2,sc)),l2=bgLow_(lab),amt=at(r2,sc+1),third=at(r2,sc+2);if(!l2)continue;
    if(l2==='monthly expenses'||l2==='account')continue;
    if(l2==='fixed expenses'){state='fixed';continue;}
    if(l2==='nice to have expenses'){state='nice';continue;}
    if(l2==='what if scenarios'){state='whatif';continue;}
    var m;
    if(l2==='total shared expenses'){model.tracker.totalShared=bgNum_(amt);state='sum';continue;}
    if((m=l2.match(/^(.+?)'s contribution$/))&&byName[m[1]]){model.tracker.contribution[m[1]]=bgNum_(amt);var pc=bgPct_(third);if(m[1]===people[0].key&&pc!=null)model.split=pc;state='sum';continue;}
    if(l2==='total required expenses'){model.tracker.required=bgNum_(amt);continue;}
    if(l2==='total shared savings'){model.tracker.sharedSavings=bgNum_(amt);model.sharedSavings=bgNum_(amt)||0;continue;}
    if((m=l2.match(/^(.+?)'s transfer to .*checking/))&&byName[m[1]]){model.tracker.checking[m[1]]=bgNum_(amt);model.tracker.ownCards[m[1]]=bgNum_(third);continue;}
    if((m=l2.match(/^(.+?)'s transfer to .*savings/))&&byName[m[1]]){model.tracker.savings[m[1]]=bgNum_(amt);continue;}
    if(l2==='total shared net income'){model.tracker.totalNet=bgNum_(amt);continue;}
    if(l2==='total shared disposable income'){model.tracker.totalDisposable=bgNum_(amt);continue;}
    if(state==='fixed'||state==='nice'||state==='whatif'){var nm=bgName_(lab);
      model.shared[state].push({key:keyFor('shared.'+state,nm),name:nm,amount:bgNum_(amt)||0,account:bgText_(third)||'Joint',dueDay:bgDueDay_(lab)});}}
  if(!model.shared.fixed.length)missing.push('Shared · Fixed Expenses');
  if(model.split==null){missing.push(people[0].name+'’s Contribution %');model.split=0.6;}
  if(model.sharedSavings==null){missing.push('Total Shared Savings');model.sharedSavings=0;}
  return model;}
// Pure: the model with What if overrides → every figure the Budget tab shows.
function budgetCompute_(model,ov,catMap,raw){ov=ov||{};var own=function(x){return raw&&x.trackerAmount!=null?x.trackerAmount:x.amount;};
  var val=function(k,base){return Object.prototype.hasOwnProperty.call(ov,k)&&ov[k]!==''&&ov[k]!=null&&isFinite(Number(ov[k]))?Number(ov[k]):(Number(base)||0);};
  var split=Math.min(1,Math.max(0,val('split',model.split)));
  var shares={};shares[model.people[0].key]=split;shares[model.people[1].key]=1-split;
  var lines=model.shared.fixed.map(function(x){return {key:x.key,name:x.name,kind:'fixed',account:x.account,dueDay:x.dueDay,amount:val(x.key,own(x)),trackerAmount:x.trackerAmount};})
    .concat(model.shared.nice.map(function(x){return {key:x.key,name:x.name,kind:'nice',account:x.account,dueDay:x.dueDay,amount:val(x.key,own(x)),trackerAmount:x.trackerAmount};}));
  var sum=function(a){return a.reduce(function(s,x){return s+x.amount;},0);};
  var total=sum(lines),required=sum(lines.filter(function(x){return x.kind==='fixed'&&x.amount>0;}));
  var savings=val('shared.savings',model.sharedSavings);
  var cats={},order=BG_CATS.map(function(c){return c[0];}).concat(['Other']),other=[];
  lines.forEach(function(x){var c=bgCategory_(x.name,catMap);x.category=c;if(c==='Other')other.push(x.name);if(order.indexOf(c)===-1)order.push(c);
    var C=cats[c]||(cats[c]={name:c,total:0,accounts:{},keys:[]});C.total+=x.amount;C.accounts[x.account]=(C.accounts[x.account]||0)+x.amount;C.keys.push(x.key);});
  var categories=order.filter(function(c){return cats[c];}).map(function(c){var C=cats[c];var acc={};Object.keys(C.accounts).forEach(function(a){acc[a]=bgRound_(C.accounts[a]);});
    return {name:c,total:bgRound_(C.total),accounts:acc,keys:C.keys};});
  var people=model.people.map(function(p){var share=shares[p.key];
    var pick=function(list){return list.map(function(x){return {key:x.key,name:x.name,amount:val(x.key,x.amount)};});};
    var ded=pick(p.deductions),fixed=pick(p.fixed),nice=pick(p.nice);
    var gross=val(p.key+'.gross',p.gross),psave=val(p.key+'.psave',p.psave);
    var net=gross-sum(ded),contribution=total*share,ssave=savings*share;
    var own=sum(lines.filter(function(x){return x.account.toLowerCase()===p.key;}));
    var fx=sum(fixed),nc=sum(nice),netExp=fx+nc+psave+contribution+ssave;
    return {key:p.key,name:p.name,share:share,gross:bgRound_(gross),deductions:ded,net:bgRound_(net),fixed:fixed,nice:nice,
      fixedTotal:bgRound_(fx),niceTotal:bgRound_(nc),psave:bgRound_(psave),contribution:bgRound_(contribution),sharedSavings:bgRound_(ssave),
      contributions:bgRound_(psave+contribution+ssave),ownCards:bgRound_(own),checking:bgRound_(contribution-own),savings:bgRound_(ssave),
      netExpenses:bgRound_(netExp),disposable:bgRound_(net-netExp)};});
  var emergency=[3,6,9].map(function(n){var t=required*n;return {months:n,total:bgRound_(t),half:bgRound_(t/2),
    byShare:people.map(function(p){return {key:p.key,amount:bgRound_(t*p.share)};})};});
  return {split:split,shared:{lines:lines,total:bgRound_(total),fixed:bgRound_(sum(lines.filter(function(x){return x.kind==='fixed';}))),
      nice:bgRound_(sum(lines.filter(function(x){return x.kind==='nice';}))),required:bgRound_(required),savings:bgRound_(savings),categories:categories,other:other},
    people:people,emergency:emergency,totalNet:bgRound_(people[0].net+people[1].net),totalDisposable:bgRound_(people[0].disposable+people[1].disposable)};}
// Pure: VERA's figures beside the tracker's. ok within 5¢ (the tracker rounds as it goes). A disposable or
// total that is off by exactly the net-income difference says so, rather than reading as a second problem.
function budgetMatch_(model,c,raw){var rows=[],T=model.tracker;
  var add=function(id,label,vera,trk,because){if(trk==null||trk==='')return;var d=bgRound_(vera-trk);rows.push({id:id,label:label,vera:bgRound_(vera),tracker:bgRound_(trk),diff:d,ok:Math.abs(d)<=0.05,because:because||''});};
  var netDiff={};c.people.forEach(function(p,i){var P=model.people[i];netDiff[p.key]=P.netTyped==null?0:bgRound_(p.net-P.netTyped);});
  var follows=function(d,nd){return Math.abs(d)>0.05&&Math.abs(d-nd)<=0.05?'follows net income':'';};
  add('totalShared','Total shared',c.shared.total,T.totalShared);
  add('required','Required each month',c.shared.required,T.required);
  add('savings','Shared savings',c.shared.savings,T.sharedSavings);
  c.people.forEach(function(p,i){var P=model.people[i];
    add(p.key+'.contribution',p.name+'’s contribution',p.contribution,T.contribution[p.key]);
    add(p.key+'.checking',p.name+' → AMEX Checking',p.checking,T.checking[p.key]);
    add(p.key+'.savings',p.name+' → AMEX Savings',p.savings,T.savings[p.key]);
    add(p.key+'.net',p.name+'’s net income',p.net,P.netTyped,P.netTyped!=null&&Math.abs(netDiff[p.key])>0.05?'gross − deductions; the tracker types it':'');
    add(p.key+'.netExpenses',p.name+'’s net expenses',p.netExpenses,P.typed.netExpenses);
    var dd=P.typed.disposable==null?0:bgRound_(p.disposable-P.typed.disposable);
    add(p.key+'.disposable',p.name+'’s disposable income',p.disposable,P.typed.disposable,follows(dd,netDiff[p.key]));});
  var nd=bgRound_(netDiff[c.people[0].key]+netDiff[c.people[1].key]);
  add('totalNet','Total net income',c.totalNet,T.totalNet,follows(bgRound_(c.totalNet-(T.totalNet||0)),nd));
  add('totalDisposable','Total disposable income',c.totalDisposable,T.totalDisposable,follows(bgRound_(c.totalDisposable-(T.totalDisposable||0)),nd));
  if(raw){var plain={};budgetMatch_(model,raw).forEach(function(r){plain[r.id]=r;});
    rows.forEach(function(r){var p=plain[r.id];if(r.ok||!p||Math.abs(p.diff-r.diff)<=0.05)return;r.because=p.ok?'the phone plan, from the phone tracker':(p.because||'a difference')+', and the phone plan';});}
  return rows;}
// ---- /BudgetEngine ----

/** The Tracker tab's cells, or { error }. Read only. */
function bgReadTracker_() {
  var id = veraSettingId_('SAT_SHEET_ID');
  if (!id) return { error: 'The budget tracker isn’t connected (Script Property SAT_SHEET_ID).' };
  var ss;
  try { ss = SpreadsheetApp.openById(id); } catch (err) { return { error: 'Can’t open the budget tracker: ' + err.message }; }
  var sheet = ss.getSheetByName('Tracker');
  if (!sheet) {
    var named = ss.getSheets().filter(function(s) { return /tracker/i.test(s.getName()); })[0];
    if (!named) return { error: 'The budget tracker has no Tracker tab.' };
    sheet = named;
  }
  return { grid: sheet.getDataRange().getValues() };
}

/** Config `budget_category:<line>` = category → { '<line, lower case>': category }. */
function bgCategoryMap_() {
  var cfg = {};
  try { cfg = getConfigValues() || {}; } catch (e) {}
  var out = {};
  Object.keys(cfg).forEach(function(k) {
    var m = k.match(/^budget_category:(.+)$/i);
    if (m && String(cfg[k]).trim()) out[bgLow_(m[1])] = String(cfg[k]).trim();
  });
  return out;
}

function bgScenarioSheet_() { return tiSchema_(ensureSheet(getSpreadsheet(), BG_SCENARIOS_TAB_, BG_SCENARIO_HEADERS_), BG_SCENARIO_HEADERS_); }

function bgParseJson_(s, dflt) { try { var v = JSON.parse(String(s || '')); return v == null ? dflt : v; } catch (e) { return dflt; } }

/** Saved scenarios, newest first. */
function bgListScenarios_() {
  return tiRows_(bgScenarioSheet_(), BG_SCENARIO_HEADERS_.length).filter(function(r) { return String(r[0]).trim(); }).map(function(r) {
    return { id: String(r[0]).trim(), name: String(r[1] || ''), changes: bgParseJson_(r[2], {}), results: bgParseJson_(r[3], {}),
             created: r[4] instanceof Date ? r[4].toISOString() : String(r[4] || ''), quarter: String(r[5] || '') };
  }).reverse();
}

/** The quarter a date falls in: '2026-Q4'. */
function bgQuarter_(d) { d = d || new Date(); return d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1); }

/** The headline figures a scenario keeps, so the check-in can show them without the tracker. */
function bgResults_(c) {
  var out = { totalShared: c.shared.total, required: c.shared.required, sharedSavings: c.shared.savings, split: c.split, totalDisposable: c.totalDisposable };
  c.people.forEach(function(p) { out[p.key] = { net: p.net, checking: p.checking, savings: p.savings, disposable: p.disposable }; });
  return out;
}

/**
 * Pure: the model with the phone plan's month in place of the budget tracker's "Family Plan Payment"
 * and "Family Plan Credit" lines (each keeps the tracker's own figure as trackerAmount). A plan that
 * didn't read, or a tracker without those lines, leaves the model as it was.
 */
function bgWithPhone_(model, plan) {
  if (!model || !model.ok || !plan || !plan.ok) return model;
  var swapped = 0;
  model.shared.fixed.concat(model.shared.nice).forEach(function(x) {
    if (/family plan payment|phone plan payment/i.test(x.name)) { x.trackerAmount = x.amount; x.amount = plan.total; swapped++; }
    else if (/family plan credit|phone plan credit/i.test(x.name)) { x.trackerAmount = x.amount; x.amount = -plan.credit; swapped++; }
  });
  if (swapped) model.phone = { month: plan.month, total: plan.total, credit: plan.credit, ours: plan.ours, dueDay: plan.dueDay };
  return model;
}

/** The budget tracker's model, with the phone plan applied when its tracker is connected. */
function bgModel_(grid) {
  var model = budgetModel_(grid);
  if (!model.ok || typeof phnPlan_ !== 'function') return model;
  try { var plan = phnPlan_(model.people.map(function(p) { return p.name; })); if (plan && plan.ok) bgWithPhone_(model, plan); } catch (e) {}
  return model;
}

/**
 * A shared line no category covers is flagged once (writeFlags never writes a key twice), with how to
 * place it: a Config row budget_category:<line>.
 */
function bgFlagUncategorized_(names) {
  if (!names || !names.length || typeof writeFlags !== 'function') return;
  try {
    writeFlags(names.map(function(n) {
      return { source: 'Budget', flag: 'Budget line “' + n + '” has no category',
        reason: 'It shows under Other on Finances › Budget. Add a Config row budget_category:' + n + ' (for example Utilities) to place it.',
        urgency: 'Low', key: 'budget_uncategorized_' + bgLow_(n).replace(/[^a-z0-9]+/g, '_') };
    }));
  } catch (e) {}
}

/** GET budget_model → { ok, model, computed, match, categoryMap, scenarios, quarter }. */
function webGetBudgetModel_() {
  var t = bgReadTracker_();
  if (t.error) return { ok: true, configured: false, error: t.error };
  var model = bgModel_(t.grid);
  if (!model.ok) return { ok: true, configured: true, unavailable: true, error: model.error };
  var catMap = bgCategoryMap_();
  var computed = budgetCompute_(model, {}, catMap);
  bgFlagUncategorized_(computed.shared.other);
  var scenarios = [];
  try { scenarios = bgListScenarios_(); } catch (e) {}
  return { ok: true, configured: true, model: model, computed: computed, match: budgetMatch_(model, computed, model.phone ? budgetCompute_(model, {}, catMap, true) : null),
           categoryMap: catMap, scenarios: scenarios, quarter: bgQuarter_() };
}

/** Only the keys the model knows, with numbers: What if can't store anything else. */
function bgCleanChanges_(model, changes) {
  var known = { split: 1, 'shared.savings': 1 };
  model.people.forEach(function(p) {
    known[p.key + '.gross'] = 1; known[p.key + '.psave'] = 1;
    p.deductions.concat(p.fixed, p.nice).forEach(function(x) { known[x.key] = 1; });
  });
  model.shared.fixed.concat(model.shared.nice).forEach(function(x) { known[x.key] = 1; });
  var out = {};
  Object.keys(changes || {}).forEach(function(k) {
    var n = Number(changes[k]);
    if (known[k] && changes[k] !== '' && changes[k] != null && isFinite(n)) out[k] = k === 'split' ? Math.min(1, Math.max(0, n)) : Math.round(n * 100) / 100;
  });
  return out;
}

/** POST budget_scenario_save { name, changes } → { ok, scenario }. Results are worked out here, from the tracker as it is now. */
function webSaveBudgetScenario_(body) {
  var name = String(body && body.name || '').trim().slice(0, 80);
  if (!name) return { ok: false, error: 'Give the scenario a name.' };
  var t = bgReadTracker_();
  if (t.error) return { ok: false, error: t.error };
  var model = bgModel_(t.grid);
  if (!model.ok) return { ok: false, error: model.error };
  var changes = bgCleanChanges_(model, body && body.changes);
  if (!Object.keys(changes).length) return { ok: false, error: 'Nothing is changed in What if yet.' };
  var results = bgResults_(budgetCompute_(model, changes, bgCategoryMap_()));
  return tiLocked_(function() {
    var s = { id: tiMintId_('BGS-'), name: name, changes: changes, results: results, created: tiNow_(), quarter: bgQuarter_() };
    bgScenarioSheet_().appendRow([s.id, s.name, JSON.stringify(changes), JSON.stringify(results), s.created, s.quarter]);
    return { ok: true, scenario: s };
  });
}

/** POST budget_scenario_delete { id } */
function webDeleteBudgetScenario_(body) {
  var id = String(body && body.id || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  return tiLocked_(function() {
    var sheet = bgScenarioSheet_(), row = tiRowOf_(sheet, BG_SCENARIO_HEADERS_.length, id);
    if (row === -1) return { ok: false, error: 'That scenario no longer exists.' };
    sheet.deleteRow(row);
    return { ok: true };
  });
}
