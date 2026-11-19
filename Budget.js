// ============================================================
// VERA — Budget.js
// Finances › Budget (issue #226): the budget tracker's Household Split tab, read live and BY LABEL,
// with every figure worked out by VERA from the sheet's inputs (the BudgetEngine block below, shared
// word for word with both dashboards so What if runs in the browser).
// ============================================================
//
//   1. VERA reads the Household Split tab (the old Tracker tab is retired; nothing reads it).
//   2. VERA writes only an input cell, and only through budget_write / budget_add_bill: a cell that
//      holds a formula is refused ("worked out by the sheet"), every write is checked first and then
//      made all together under the script lock, and each is logged to the System Log.
//   3. VERA's figures are shown beside the sheet's (budgetMatch_): a moved row or a broken formula
//      shows as a difference instead of quietly changing a number.
//   4. What if never touches the sheet until "Write these to the sheet". A scenario is saved to VERA's
//      own sheet, "Budget Scenarios", for the quarterly check-in.
//   5. A line's category is Config `budget_category:<line>` when set, else the sheet's Category, else
//      the rules in BG_CATS; a line none of them covers shows under Other.
// ============================================================

var BG_SCENARIOS_TAB_ = 'Budget Scenarios';
var BG_SCENARIO_HEADERS_ = ['ID', 'Name', 'Changes JSON', 'Results JSON', 'Created', 'Quarter'];
var BG_TAB_ = 'Household Split';

// ---- BudgetEngine (Finances › Budget, issue #226) — SHARED VERBATIM by Budget.js, docs/app.js and docs/dashboard-lite.html ----
// Reads the budget tracker's Household Split tab BY LABEL (never by cell position) and works the figures
// out from its inputs, the way the sheet does, so What if can run in the browser with no round trips:
//   1. Paychecks   one paycheck per person: gross, pre- and after-tax deductions, taxes, net deposit, and
//                  how many in a regular month. A deduction marked "Shared cost? Yes" (medical, vision)
//                  is a shared cost taken from that person's pay, so it joins the shared lines.
//   2. Bills       only what is paid from take-home: Monthly, Type (Fixed / Variable / Nice to have),
//                  For (Shared or a person), Paid by (Joint or a person), Actual or set-aside, Category.
//   3. Split       the first person's share of shared costs (60/40 today), shared and personal savings.
//   shared total      = the shared bills + the shared costs taken from pay
//   share             = shared total × that person's share
//   → Joint Checking  = share − the shared costs on their own card or paycheck
//   take-home         = net deposit × paychecks in a regular month
//   left over         = take-home − Joint − shared savings − shared bills on own card − personal bills − personal savings
//   settle-up         = what the first person covers of the second's share (their cards and pay, crossed)
//   set-asides        = the set-aside bills, by who pays them
//   required          = the shared fixed and variable costs; the emergency fund is that × 3, 6 and 9 months
// Amounts are a month throughout; a paycheck line keeps `per` (one paycheck) and `perMonth` for the sheet.
// Overrides (What if) are { key: amount a month }: '<person>.gross', '<person>.ded:<line>',
// '<person>.fixed:<line>', '<person>.nice:<line>', '<person>.psave', 'shared.fixed:<line>',
// 'shared.variable:<line>', 'shared.nice:<line>', 'shared.pay:<line>', 'split' (0–1) and 'shared.savings'.
// A line another tracker replaces (the phone plan) keeps the sheet's figure as trackerAmount;
// budgetCompute_(…, raw) uses those, and budgetMatch_(model, c, raw) then names that cause.
var BG_CATS=[
  ['Housing',/\brent\b|renter/i],
  ['Utilities',/utilit|internet|family plan|phone|electric|water|\bgas\b/i],
  ['Health',/health|medical|vision|dental/i],
  ['Household',/grocer|costco|cleaning|\btips?\b/i],
  ['Insurance & subscriptions',/insurance|subscription|membership/i]];
// Spending budgets rather than bills (groceries, Costco, cleaning): Bills leaves them out.
var BG_SPEND_RX=/grocer|costco|cleaning|\btips?\b/i;
var BG_TYPES={'fixed':'fixed','variable':'variable','nice to have':'nice','nice':'nice'};
function bgText_(v){return String(v==null?'':v).replace(/\s+/g,' ').trim();}
function bgLow_(v){return bgText_(v).toLowerCase().replace(/:$/,'');}
function bgNum_(v){if(typeof v==='number')return isFinite(v)?v:null;var s=bgText_(v).replace(/[$,\s]/g,'');if(!s||s==='-')return null;
  var neg=/^\(.*\)$/.test(s);s=s.replace(/[()]/g,'');var pct=/%$/.test(s);var n=parseFloat(s.replace(/%$/,''));if(isNaN(n))return null;if(pct)n=n/100;return neg?-n:n;}
function bgPct_(v){var n=bgNum_(v);if(n==null)return null;if(typeof v==='number'&&n>1)n=n/100;return n;}
function bgRound_(n){return Math.round((Number(n)||0)*100)/100;}
function bgDueDay_(label){var m=bgText_(label).match(/\((\d{1,2})(?:st|nd|rd|th)\)/i);return m?Number(m[1]):null;}
function bgName_(label){return bgText_(label).replace(/\s*\((\d{1,2})(?:st|nd|rd|th)\)\s*/i,' ').trim();}
// Pure: a line's category: the Config map first (budget_category:<line>), then the sheet's Category, then the rules, else Other.
function bgCategory_(name,catMap,sheetCat){var k=bgLow_(name);if(catMap&&catMap[k])return catMap[k];if(bgText_(sheetCat))return bgText_(sheetCat);
  for(var i=0;i<BG_CATS.length;i++)if(BG_CATS[i][1].test(name))return BG_CATS[i][0];return 'Other';}
// Pure: the Household Split tab (rows of cells) → the model. { ok:false, error } when the layout can't be read.
// Every input keeps its cell ({row, col}, 1-based) so VERA can write it back; `section` names where it sits.
function budgetModel_(grid){
  grid=grid||[];var at=function(r,c){return (grid[r]||[])[c];};
  var find=function(rx,from){for(var r=from||0;r<grid.length;r++)if(rx.test(bgLow_(at(r,0))))return r;return -1;};
  var hp=find(/^1\.\s*paychecks/),hb=find(/^2\.\s*bills/),hs=find(/^3\.\s*split/);
  if(hp===-1)return {ok:false,error:'The budget tracker’s Household Split tab has no “1. Paychecks” section.'};
  if(hb===-1)return {ok:false,error:'The budget tracker’s Household Split tab has no “2. Bills” section.'};
  if(hs===-1)return {ok:false,error:'The budget tracker’s Household Split tab has no “3. Split” section.'};
  var people=[],sharedCol=-1;(grid[hp]||[]).forEach(function(cell,c){var t=bgText_(cell);if(!c||!t)return;if(/shared/i.test(t)){sharedCol=c;return;}people.push({key:t.toLowerCase(),name:t,col:c});});
  if(people.length!==2)return {ok:false,error:'The Paychecks section should name two people; it names '+people.length+'.'};
  var missing=[],seen={},byKey={};people.forEach(function(p){byKey[p.key]=p;});
  var keyFor=function(prefix,name){var k=prefix+':'+name,n=2;while(seen[k])k=prefix+':'+name+' #'+(n++);seen[k]=1;return k;};
  var cell=function(r,c){return {row:r+1,col:c+1};};
  var model={ok:true,layout:'household split',people:[],shared:{fixed:[],variable:[],nice:[],pay:[]},bills:[],split:null,sharedSavings:null,
    tracker:{share:{},checking:{},savings:{},ownCards:{},fromPay:{},personal:{},left:{},takeHome:{},setAside:{}},cells:{},missing:missing};
  // 1. Paychecks
  var P=people.map(function(p){return {key:p.key,name:p.name,cadence:'',grossPer:null,perYear:null,perMonth:null,deductions:[],taxesPer:null,netPer:null,
    netTyped:null,avgMonth:null,extraTyped:null,fixed:[],nice:[],psave:null,typed:{},cells:{}};});
  var state='';
  for(var r=hp+1;r<hb;r++){var lab=bgText_(at(r,0)),l=bgLow_(lab);if(!l)continue;
    if(/^pre-tax deductions?$/.test(l)){state='pre';continue;}
    if(/^after-tax deductions?$/.test(l)){state='post';continue;}
    var f=function(i){return at(r,people[i].col);};
    if(/^pay cadence/.test(l)){P.forEach(function(x,i){x.cadence=bgText_(f(i));x.cells.cadence=cell(r,people[i].col);});continue;}
    if(/^gross pay/.test(l)){P.forEach(function(x,i){x.grossPer=bgNum_(f(i));x.cells.gross=cell(r,people[i].col);});state='';continue;}
    if(/^taxes/.test(l)){P.forEach(function(x,i){x.taxesPer=bgNum_(f(i))||0;x.cells.taxes=cell(r,people[i].col);});state='';continue;}
    if(/^net deposit/.test(l)){P.forEach(function(x,i){x.netPer=bgNum_(f(i));x.cells.net=cell(r,people[i].col);});continue;}
    if(/^paychecks a year/.test(l)){P.forEach(function(x,i){x.perYear=bgNum_(f(i));x.cells.perYear=cell(r,people[i].col);});continue;}
    if(/^paychecks in a (regular )?month/.test(l)){P.forEach(function(x,i){x.perMonth=bgNum_(f(i));x.cells.perMonth=cell(r,people[i].col);});continue;}
    if(/^take-home/.test(l)){P.forEach(function(x,i){x.netTyped=bgNum_(f(i));});continue;}
    if(/^average month/.test(l)){P.forEach(function(x,i){x.avgMonth=bgNum_(f(i));});continue;}
    if(/^extra paychecks/.test(l)){P.forEach(function(x,i){x.extraTyped=bgNum_(f(i));});continue;}
    if(state==='pre'||state==='post'){var shared=sharedCol>-1&&/^y/i.test(bgText_(at(r,sharedCol)));
      P.forEach(function(x,i){var v=bgNum_(f(i));if(v==null||!v)return;
        x.deductions.push({key:keyFor(x.key+'.ded',lab),name:lab,per:v,when:state,shared:shared,cell:cell(r,people[i].col),sharedCell:sharedCol>-1?cell(r,sharedCol):null});});}}
  P.forEach(function(x){if(x.grossPer==null)missing.push(x.name+' · Gross pay per paycheck');if(x.perMonth==null){missing.push(x.name+' · Paychecks in a regular month');x.perMonth=1;}
    var n=x.perMonth;x.gross=bgRound_((x.grossPer||0)*n);
    // a shared deduction becomes a shared line taken from this person's pay; the rest (and the taxes) stay deductions
    var own=[];x.deductions.forEach(function(d){d.perMonth=n;d.amount=bgRound_(d.per*n);
      if(d.shared){var k=keyFor('shared.pay',d.name);model.shared.pay.push({key:k,name:d.name,amount:d.amount,per:d.per,perMonth:n,type:'fixed',account:x.name,fromPay:x.key,
        keptAs:'Actual',category:'Health',cell:d.cell,section:'paychecks'});}else own.push(d);});
    if(x.taxesPer!=null)own.push({key:keyFor(x.key+'.ded','Taxes'),name:'Taxes',per:x.taxesPer,perMonth:n,amount:bgRound_(x.taxesPer*n),when:'tax',taxes:true,cell:x.cells.taxes});
    x.deductions=own;});
  // 2. Bills
  var head=grid[hb]||[],col={};head.forEach(function(h,c){var t=bgLow_(h);if(!c)return;
    if(/^monthly/.test(t))col.amount=c;else if(/^type/.test(t))col.type=c;else if(/^for$/.test(t))col.forWho=c;else if(/^paid by/.test(t))col.paidBy=c;
    else if(/actual|set-aside|set aside/.test(t))col.keptAs=c;else if(/^categor/.test(t))col.category=c;});
  ['amount','type','forWho','paidBy'].forEach(function(k){if(col[k]==null)missing.push('Bills · '+({amount:'Monthly',type:'Type',forWho:'For',paidBy:'Paid by'})[k]+' column');});
  var totalRow=-1,blanks=[];
  for(var r2=hb+1;r2<hs;r2++){var lab2=bgText_(at(r2,0)),l2=bgLow_(lab2);
    if(/^total bills/.test(l2)){totalRow=r2;model.tracker.totalBills=bgNum_(at(r2,col.amount==null?1:col.amount));break;}
    if(!l2){blanks.push(r2+1);continue;}
    var nm=bgName_(lab2),amt=bgNum_(at(r2,col.amount))||0,type=BG_TYPES[bgLow_(at(r2,col.type))]||'',forWho=bgText_(at(r2,col.forWho)),paidBy=bgText_(at(r2,col.paidBy))||'Joint',
      kept=/set/i.test(bgText_(at(r2,col.keptAs)))?'Set-aside':'Actual',cat=bgText_(at(r2,col.category));
    var b={name:nm,label:lab2,amount:amt,type:type||'fixed',forWho:forWho,paidBy:paidBy,keptAs:kept,category:cat,dueDay:bgDueDay_(lab2),row:r2+1,
      cells:{amount:cell(r2,col.amount),type:cell(r2,col.type),forWho:cell(r2,col.forWho),paidBy:cell(r2,col.paidBy),keptAs:col.keptAs==null?null:cell(r2,col.keptAs),category:col.category==null?null:cell(r2,col.category),name:cell(r2,0)}};
    if(!type||!forWho||!bgText_(at(r2,col.paidBy)))b.incomplete=true;
    var fw=bgLow_(forWho),pb=bgLow_(paidBy);
    if(fw==='shared'){b.key=keyFor('shared.'+b.type,nm);b.account=pb==='joint'?'Joint':(byKey[pb]?byKey[pb].name:paidBy);b.section='bills';model.shared[b.type].push(b);}
    else if(byKey[fw]){var who=P[people.indexOf(byKey[fw])];b.key=keyFor(who.key+'.'+(b.type==='nice'?'nice':'fixed'),nm);b.section='bills';b.person=who.key;who[b.type==='nice'?'nice':'fixed'].push(b);}
    else{b.key=keyFor('other',nm);b.incomplete=true;}
    model.bills.push(b);}
  model.cells.bills={first:hb+2,total:totalRow===-1?null:totalRow+1,blanks:blanks,columns:{name:1,amount:col.amount==null?null:col.amount+1,type:col.type==null?null:col.type+1,
    forWho:col.forWho==null?null:col.forWho+1,paidBy:col.paidBy==null?null:col.paidBy+1,keptAs:col.keptAs==null?null:col.keptAs+1,category:col.category==null?null:col.category+1}};
  if(totalRow===-1)missing.push('Bills · Total bills');
  // 3. Split (and the sheet's own figures in 3–6, for the check)
  var scol={},sh=grid[hs]||[];sh.forEach(function(hh,c){var t=bgLow_(hh);if(!c)return;if(t==='total')scol.total=c;else if(byKey[t])scol[t]=c;});
  var sec='split',T=model.tracker;
  for(var r3=hs+1;r3<grid.length;r3++){var l3=bgLow_(at(r3,0));if(!l3)continue;
    var pv=function(p){return bgNum_(at(r3,scol[p.key]==null?people.indexOf(p)+1:scol[p.key]));},tot=bgNum_(at(r3,scol.total==null?3:scol.total));
    var each=function(o){people.forEach(function(p){o[p.key]=pv(p);});};
    if(/^4\.\s*summary/.test(l3)){sec='summary';continue;}if(/^5\.\s*emergency/.test(l3)){sec='emergency';continue;}if(/^6\.\s*bonus/.test(l3)){sec='bonus';continue;}
    if(sec==='split'){
      if(/^share of shared/.test(l3)){var s0=bgPct_(at(r3,scol[people[0].key]==null?1:scol[people[0].key]));if(s0!=null)model.split=s0;model.cells.split=cell(r3,scol[people[0].key]==null?1:scol[people[0].key]);continue;}
      if(/your share$/.test(l3)||/^shared expenses, your share/.test(l3)){each(T.share);T.totalShared=tot;continue;}
      if(/taken from your pay/.test(l3)){each(T.fromPay);continue;}
      if(/your own card/.test(l3)){each(T.ownCards);continue;}
      if(/^transfer to joint/.test(l3)){each(T.checking);T.joint=tot;continue;}
      if(/^transfer to shared savings/.test(l3)){each(T.savings);T.sharedSavings=tot;model.sharedSavings=tot!=null?tot:people.reduce(function(s,p){return s+(pv(p)||0);},0);
        model.cells.sharedSavings=people.map(function(p,i){return cell(r3,scol[p.key]==null?i+1:scol[p.key]);});continue;}
      if(/^personal bills/.test(l3)){each(T.personal);continue;}
      if(/^personal savings/.test(l3)){people.forEach(function(p,i){P[i].psave=pv(p);P[i].cells.psave=cell(r3,scol[p.key]==null?i+1:scol[p.key]);});continue;}
      if(/^left over/.test(l3)){each(T.left);T.totalLeft=tot;continue;}
      if(/^settle-up/.test(l3)){T.settleUp=bgNum_(at(r3,1));continue;}
      if(/^joint checking: bills/.test(l3)){T.jointCheck=bgNum_(at(r3,1));continue;}
      if(/^bills missing/.test(l3)){T.missingFields=bgNum_(at(r3,1));continue;}}
    if(sec==='summary'){
      if(/^fixed$/.test(l3)){T.fixed=tot;continue;}if(/^variable$/.test(l3)){T.variable=tot;continue;}if(/^nice to have$/.test(l3)){T.nice=tot;continue;}
      if(/^take-home income/.test(l3)){each(T.takeHome);continue;}
      if(/^set-asides/.test(l3)){each(T.setAside);T.totalSetAside=tot;continue;}}
    if(sec==='emergency'&&/^required/.test(l3)){T.required=tot;continue;}
    if(sec==='bonus'){var bv=function(i){return at(r3,scol[people[i].key]==null?i+1:scol[people[i].key]);};
      var B=model.bonus||(model.bonus={usually:{},bonus:{},extra:{},sharePct:{},toShared:{},kept:{}});
      var put=function(k,num){people.forEach(function(p,i){B[k][p.key]=num?bgNum_(bv(i)):bgText_(bv(i));});};
      if(/^usually/.test(l3))put('usually');else if(/bonus deposit/.test(l3)){put('bonus',1);B.bonusCells=people.map(function(p,i){return cell(r3,scol[p.key]==null?i+1:scol[p.key]);});}
      else if(/^extra paychecks/.test(l3))put('extra',1);else if(/^share to shared/.test(l3)){people.forEach(function(p,i){B.sharePct[p.key]=bgPct_(bv(i));});}
      else if(/^to shared goals/.test(l3))put('toShared',1);else if(/^kept personally/.test(l3))put('kept',1);}}
  P.forEach(function(x){if(x.psave==null){missing.push(x.name+' · Personal savings');x.psave=0;}model.people.push(x);});
  if(model.split==null){missing.push('Split · Share of shared costs');model.split=0.6;}
  if(model.sharedSavings==null){missing.push('Split · Transfer to shared savings');model.sharedSavings=0;}
  return model;}
// Pure: the model with What if overrides → every figure the Budget tab shows.
function budgetCompute_(model,ov,catMap,raw){ov=ov||{};var own=function(x){return raw&&x.trackerAmount!=null?x.trackerAmount:x.amount;};
  var val=function(k,base){return Object.prototype.hasOwnProperty.call(ov,k)&&ov[k]!==''&&ov[k]!=null&&isFinite(Number(ov[k]))?Number(ov[k]):(Number(base)||0);};
  var split=Math.min(1,Math.max(0,val('split',model.split)));
  var shares={};shares[model.people[0].key]=split;shares[model.people[1].key]=1-split;
  var keyOf={};model.people.forEach(function(p){keyOf[p.name.toLowerCase()]=p.key;});
  var mk=function(x,kind){return {key:x.key,name:x.name,kind:kind,type:kind,account:x.account,dueDay:x.dueDay||null,amount:val(x.key,own(x)),trackerAmount:x.trackerAmount,
    fromPay:x.fromPay||'',keptAs:x.keptAs||'Actual',sheetCategory:x.category||'',spend:BG_SPEND_RX.test(x.name),incomplete:!!x.incomplete};};
  var S=model.shared,lines=(S.fixed||[]).map(function(x){return mk(x,'fixed');}).concat((S.pay||[]).map(function(x){return mk(x,'fixed');}),
    (S.variable||[]).map(function(x){return mk(x,'variable');}),(S.nice||[]).map(function(x){return mk(x,'nice');}));
  var sum=function(a){return a.reduce(function(s,x){return s+x.amount;},0);},ofKind=function(k){return lines.filter(function(x){return x.kind===k;});};
  var total=sum(lines),required=sum(lines.filter(function(x){return x.kind!=='nice';}));
  var savings=val('shared.savings',model.sharedSavings);
  var cats={},order=[],other=[];
  lines.forEach(function(x){var c=bgCategory_(x.name,catMap,x.sheetCategory);x.category=c;if(c==='Other')other.push(x.name);if(order.indexOf(c)===-1)order.push(c);
    var C=cats[c]||(cats[c]={name:c,total:0,accounts:{},keys:[]});C.total+=x.amount;C.accounts[x.account]=(C.accounts[x.account]||0)+x.amount;C.keys.push(x.key);});
  var categories=order.map(function(c){var C=cats[c];var acc={};Object.keys(C.accounts).forEach(function(a){acc[a]=bgRound_(C.accounts[a]);});
    return {name:c,total:bgRound_(C.total),accounts:acc,keys:C.keys};}).sort(function(a,b){return b.total-a.total;});
  var people=model.people.map(function(p){var share=shares[p.key];
    var pick=function(list,kind){return list.map(function(x){return {key:x.key,name:x.name,amount:val(x.key,x.amount),type:x.type||kind,keptAs:x.keptAs||'Actual',
      category:bgCategory_(x.name,catMap,x.category),per:x.per,perMonth:x.perMonth,taxes:!!x.taxes,when:x.when||''};});};
    var ded=pick(p.deductions,'deduction'),fixed=pick(p.fixed,'fixed'),nice=pick(p.nice,'nice');
    var gross=val(p.key+'.gross',p.gross),psave=val(p.key+'.psave',p.psave);
    var net=gross-sum(ded),contribution=total*share,ssave=savings*share;
    var mine=lines.filter(function(x){return keyOf[String(x.account).toLowerCase()]===p.key;});
    var ownAll=sum(mine),fromPayLines=mine.filter(function(x){return x.fromPay;}),fromPay=sum(fromPayLines),ownCard=ownAll-fromPay;
    var fx=sum(fixed),nc=sum(nice),netExp=fx+nc+psave+contribution+ssave;
    var setAside=sum(fixed.concat(nice).filter(function(x){return x.keptAs==='Set-aside';}))+sum(mine.filter(function(x){return x.keptAs==='Set-aside';}));
    return {key:p.key,name:p.name,share:share,gross:bgRound_(gross),deductions:ded,net:bgRound_(net),fixed:fixed,nice:nice,
      fixedTotal:bgRound_(fx),niceTotal:bgRound_(nc),personalBills:bgRound_(fx+nc),psave:bgRound_(psave),contribution:bgRound_(contribution),sharedSavings:bgRound_(ssave),
      contributions:bgRound_(psave+contribution+ssave),ownCards:bgRound_(ownAll),ownCard:bgRound_(ownCard),checking:bgRound_(contribution-ownAll),savings:bgRound_(ssave),
      netExpenses:bgRound_(netExp),disposable:bgRound_(net-netExp),fromPay:bgRound_(fromPay),fromPayLines:fromPayLines.map(function(x){return {name:x.name,amount:bgRound_(x.amount)};}),
      takeHome:bgRound_(net-fromPay),setAside:bgRound_(setAside),perMonth:p.perMonth,cadence:p.cadence,grossPer:p.grossPer,netPer:p.netPer};});
  var A=people[0],V=people[1],takeAll=A.takeHome+V.takeHome;
  people.forEach(function(p){p.takeHomeShare=takeAll?p.takeHome/takeAll:0;});
  var emergency=[3,6,9].map(function(n){var t=required*n;return {months:n,total:bgRound_(t),half:bgRound_(t/2),
    byShare:people.map(function(p){return {key:p.key,amount:bgRound_(t*p.share)};})};});
  var joint=sum(lines.filter(function(x){return String(x.account).toLowerCase()==='joint';}));
  return {split:split,shared:{lines:lines,total:bgRound_(total),fixed:bgRound_(sum(ofKind('fixed'))),variable:bgRound_(sum(ofKind('variable'))),
      nice:bgRound_(sum(ofKind('nice'))),required:bgRound_(required),savings:bgRound_(savings),categories:categories,other:other,joint:bgRound_(joint)},
    people:people,emergency:emergency,totalNet:bgRound_(A.net+V.net),totalTakeHome:bgRound_(takeAll),totalDisposable:bgRound_(A.disposable+V.disposable),
    settleUp:bgRound_(V.ownCards*A.share-A.ownCards*V.share),jointCheck:bgRound_(joint-A.checking-V.checking),
    setAside:bgRound_(A.setAside+V.setAside),incomplete:(model.bills||[]).filter(function(b){return b.incomplete;}).length};}
// Pure: VERA's figures beside the sheet's. ok within 5¢ (the sheet rounds as it goes).
function budgetMatch_(model,c,raw){var rows=[],T=model.tracker||{};
  var add=function(id,label,vera,trk,because){if(trk==null||trk==='')return;var d=bgRound_(vera-trk);rows.push({id:id,label:label,vera:bgRound_(vera),tracker:bgRound_(trk),diff:d,ok:Math.abs(d)<=0.05,because:because||''});};
  add('totalShared','Shared costs',c.shared.total,T.totalShared);
  add('required','Required each month',c.shared.required,T.required);
  add('savings','Shared savings',c.shared.savings,T.sharedSavings);
  add('joint','Into Joint Checking',c.people[0].checking+c.people[1].checking,T.joint);
  c.people.forEach(function(p){var P=model.people.filter(function(x){return x.key===p.key;})[0]||{};
    add(p.key+'.takeHome',p.name+'’s take-home',p.takeHome,(T.takeHome||{})[p.key]!=null?T.takeHome[p.key]:P.netTyped,
      P.netPer!=null&&Math.abs(p.takeHome-P.netPer*(P.perMonth||1))>0.05?'gross − deductions − taxes isn’t the net deposit':'');
    add(p.key+'.checking',p.name+' → Joint Checking',p.checking,(T.checking||{})[p.key]);
    add(p.key+'.personal',p.name+'’s personal bills',p.personalBills,(T.personal||{})[p.key]);
    add(p.key+'.setAside',p.name+'’s set-asides',p.setAside,(T.setAside||{})[p.key]);
    add(p.key+'.left',p.name+'’s left over',p.disposable,(T.left||{})[p.key]);});
  add('totalLeft','Left over, together',c.totalDisposable,T.totalLeft);
  add('settleUp','Settle-up',c.settleUp,T.settleUp);
  if(raw){var plain={};budgetMatch_(model,raw).forEach(function(r){plain[r.id]=r;});
    rows.forEach(function(r){var p=plain[r.id];if(r.ok||!p||Math.abs(p.diff-r.diff)<=0.05)return;r.because=p.ok?'the phone plan, from the phone tracker':(p.because||'a difference')+', and the phone plan';});}
  return rows;}
// ---- /BudgetEngine ----

/** The budget tracker's Household Split tab: { sheet } or { error }. */
function bgSplitSheet_() {
  var id = veraSettingId_('SAT_SHEET_ID');
  if (!id) return { error: 'The budget tracker isn’t connected (Script Property SAT_SHEET_ID).' };
  var ss;
  try { ss = SpreadsheetApp.openById(id); } catch (err) { return { error: 'Can’t open the budget tracker: ' + err.message }; }
  var sheet = ss.getSheetByName(BG_TAB_) || ss.getSheets().filter(function(s) { return /household\s*split/i.test(s.getName()); })[0];
  if (!sheet) return { error: 'The budget tracker has no Household Split tab.' };
  return { sheet: sheet };
}

/** The Household Split tab's cells, or { error }. */
function bgReadTracker_() {
  var s = bgSplitSheet_();
  if (s.error) return s;
  return { grid: s.sheet.getDataRange().getValues() };
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
    var ch = bgParseJson_(r[2], {}), st = ch && typeof ch._starts === 'object' ? ch._starts : {};
    if (ch) delete ch._starts;
    return { id: String(r[0]).trim(), name: String(r[1] || ''), changes: ch, starts: st, results: bgParseJson_(r[3], {}),
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
 * Pure: the model with the phone plan's month in place of the sheet's phone plan and its credit (each
 * keeps the sheet's own figure as trackerAmount). A plan that didn't read, or a sheet without those
 * lines, leaves the model as it was.
 */
var BG_PHONE_CREDIT_RX_ = /(family|phone) plan credit/i;
var BG_PHONE_RX_ = /family plan payment|phone plan payment|^phone family plan$|^family phone plan$|^phone plan$|^family plan$/i;
function bgWithPhone_(model, plan) {
  if (!model || !model.ok || !plan || !plan.ok) return model;
  var swapped = 0;
  ['fixed', 'variable', 'nice'].forEach(function(k) { (model.shared[k] || []).forEach(function(x) {
    if (BG_PHONE_CREDIT_RX_.test(x.name)) { x.trackerAmount = x.amount; x.amount = -plan.credit; swapped++; }
    else if (BG_PHONE_RX_.test(x.name)) { x.trackerAmount = x.amount; x.amount = plan.total; swapped++; }
  }); });
  if (swapped) model.phone = { month: plan.month, total: plan.total, credit: plan.credit, ours: plan.ours, dueDay: plan.dueDay };
  return model;
}

// The HSA (or health-care FSA) deduction on a paycheck. The sheet holds this year's figure; Config
// hsa_annual_<year> holds what you plan for a year. When they differ, Budget's Checks offer to put the
// plan in the sheet — VERA never swaps the figure silently.
var BG_HSA_RX_ = /\bhsa\b|health savings|\bfsa\b|flexible spending/i;

/** Pure: model.hsa = { person, key, line, per, perYear, sheetAnnual, year, plan, nextYear, next } when a person has the line. */
function bgWithHsa_(model, cfg, year) {
  if (!model || !model.ok) return model;
  cfg = cfg || {};
  var num = function(y) { var v = parseFloat(String(cfg['hsa_annual_' + y] == null ? '' : cfg['hsa_annual_' + y]).replace(/[$,\s]/g, '')); return isFinite(v) && v >= 0 ? v : null; };
  model.people.some(function(p) {
    var d = p.deductions.filter(function(x) { return BG_HSA_RX_.test(x.name); })[0];
    if (!d) return false;
    var perYear = p.perYear || (p.perMonth || 1) * 12;
    model.hsa = { person: p.key, name: p.name, key: d.key, line: d.name, per: d.per, perYear: perYear, sheetAnnual: bgRound_(d.per * perYear),
      year: String(year), plan: num(year), nextYear: String(Number(year) + 1), next: num(Number(year) + 1) };
    return true;
  });
  return model;
}

/** The sheet's model, with the phone plan applied when its tracker is connected, and the HSA plan read. */
function bgModel_(grid) {
  var model = budgetModel_(grid);
  if (!model.ok) return model;
  if (typeof phnPlan_ === 'function') {
    try { var plan = phnPlan_(model.people.map(function(p) { return p.name; })); if (plan && plan.ok) bgWithPhone_(model, plan); } catch (e) {}
  }
  try {
    bgWithHsa_(model, getConfigValues() || {}, Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy'));
  } catch (e2) { Logger.log('bgWithHsa_ (non-fatal): ' + e2.message); }
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
  // The HSA for this year and next (Config hsa_annual_<year>), for Budget's HSA editor.
  var hsaYears = [];
  try {
    var cfgH = getConfigValues() || {}, y0 = +Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy');
    [y0, y0 + 1].forEach(function(y) { var v = parseFloat(String(cfgH['hsa_annual_' + y] == null ? '' : cfgH['hsa_annual_' + y]).replace(/[$,\s]/g, '')); hsaYears.push({ year: String(y), annual: isFinite(v) ? v : null }); });
  } catch (eH) {}
  bgFlagUncategorized_(computed.shared.other);
  var scenarios = [];
  try { scenarios = bgListScenarios_(); } catch (e) {}
  return { ok: true, configured: true, model: model, computed: computed, hsaYears: hsaYears, match: budgetMatch_(model, computed, model.phone ? budgetCompute_(model, {}, catMap, true) : null),
           categoryMap: catMap, scenarios: scenarios, quarter: bgQuarter_() };
}

/** Only the keys the model knows, with numbers: What if can't store anything else. */
function bgCleanChanges_(model, changes) {
  var known = { split: 1, 'shared.savings': 1 };
  model.people.forEach(function(p) {
    known[p.key + '.gross'] = 1; known[p.key + '.psave'] = 1;
    p.deductions.concat(p.fixed, p.nice).forEach(function(x) { known[x.key] = 1; });
  });
  ['fixed', 'variable', 'nice', 'pay'].forEach(function(k) { (model.shared[k] || []).forEach(function(x) { known[x.key] = 1; }); });
  var out = {};
  Object.keys(changes || {}).forEach(function(k) {
    var n = Number(changes[k]);
    if (known[k] && changes[k] !== '' && changes[k] != null && isFinite(n)) out[k] = k === 'split' ? Math.min(1, Math.max(0, n)) : Math.round(n * 100) / 100;
  });
  return out;
}

/** POST budget_scenario_save { name, changes } → { ok, scenario }. Results are worked out here, from the sheet as it is now. */
function webSaveBudgetScenario_(body) {
  var name = String(body && body.name || '').trim().slice(0, 80);
  if (!name) return { ok: false, error: 'Give the scenario a name.' };
  var t = bgReadTracker_();
  if (t.error) return { ok: false, error: t.error };
  var model = bgModel_(t.grid);
  if (!model.ok) return { ok: false, error: model.error };
  var changes = bgCleanChanges_(model, body && body.changes);
  if (!Object.keys(changes).length) return { ok: false, error: 'Nothing is changed in What if yet.' };
  // When a change starts (yyyy-MM), for changes the scenario keeps; the results are once every change has started.
  var starts = {};
  Object.keys((body && body.starts) || {}).forEach(function(k) { var v = String(body.starts[k] || ''); if (changes.hasOwnProperty(k) && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) starts[k] = v; });
  var results = bgResults_(budgetCompute_(model, changes, bgCategoryMap_()));
  return tiLocked_(function() {
    var s = { id: tiMintId_('BGS-'), name: name, changes: changes, starts: starts, results: results, created: tiNow_(), quarter: bgQuarter_() };
    var keep = Object.keys(starts).length ? Object.assign({}, changes, { _starts: starts }) : changes;
    bgScenarioSheet_().appendRow([s.id, s.name, JSON.stringify(keep), JSON.stringify(results), s.created, s.quarter]);
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

// ---- Writing to Household Split -------------------------------------------------------------
// Only input cells, found BY LABEL in the sheet as it is at the moment of writing (never a row number
// the page remembered). A paycheck line is written per paycheck; a bill per month.

var BG_TYPE_LABEL_ = { fixed: 'Fixed', variable: 'Variable', nice: 'Nice to have' };
var BG_CADENCES_ = ['Weekly', 'Biweekly', 'Semimonthly', 'Monthly'];

/** Pure: one value checked against what a field may hold → { ok, value } or { ok:false, error }. */
function bgCheckValue_(field, value, model) {
  var names = model.people.map(function(p) { return p.name; });
  var pick = function(list, what) {
    var v = bgText_(value), hit = list.filter(function(x) { return x.toLowerCase() === v.toLowerCase(); })[0];
    return hit ? { ok: true, value: hit } : { ok: false, error: what + ' is one of: ' + list.join(', ') + '.' };
  };
  if (field === 'type') { var t = BG_TYPES[bgLow_(value)]; return t ? { ok: true, value: BG_TYPE_LABEL_[t] } : { ok: false, error: 'Type is Fixed, Variable or Nice to have.' }; }
  if (field === 'forWho') return pick(['Shared'].concat(names), 'For');
  if (field === 'paidBy') return pick(['Joint'].concat(names), 'Paid by');
  if (field === 'keptAs') { var k = /set/i.test(bgText_(value)) ? 'Set-aside' : /actual/i.test(bgText_(value)) ? 'Actual' : ''; return k ? { ok: true, value: k } : { ok: false, error: 'Kept as is Actual or Set-aside.' }; }
  if (field === 'cadence') return pick(BG_CADENCES_, 'Pay cadence');
  if (field === 'name' || field === 'category') {
    var s = bgText_(value).slice(0, 80);
    if (field === 'name' && !s) return { ok: false, error: 'Give the bill a name.' };
    if (/^[=+@]/.test(s)) return { ok: false, error: 'A name can’t start with =, + or @.' };
    return { ok: true, value: s };
  }
  var n = bgNum_(value);
  if (n == null) return { ok: false, error: 'Enter an amount.' };
  if (field === 'split') { if (n > 1) n = n / 100; if (n < 0 || n > 1) return { ok: false, error: 'The share is 0% to 100%.' }; return { ok: true, value: Math.round(n * 10000) / 10000 }; }
  if (field === 'perYear' || field === 'perMonth') { if (n < 1 || n > 53 || Math.round(n) !== n) return { ok: false, error: 'Paychecks are a whole number.' }; return { ok: true, value: n }; }
  if (Math.abs(n) > 1e7) return { ok: false, error: 'That amount is too large.' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/**
 * Pure: edits → the cells to write, from the model of the sheet as it is now.
 * edits: [{ key, field, value }] where key is
 *   '<person>.<cadence|gross|net|perYear|perMonth|psave|ssave>'  (the paycheck and split inputs),
 *   'split'                                                       (the first person's share),
 *   a deduction or a shared-from-pay key  (value per paycheck),
 *   a bill key, with field amount | name | type | forWho | paidBy | keptAs | category.
 * → { ok, writes: [{ row, col, value, what }] } or { ok:false, error }.
 */
function bgWritePlan_(model, edits) {
  if (!model || !model.ok) return { ok: false, error: (model && model.error) || 'The sheet couldn’t be read.' };
  if (!edits || !edits.length) return { ok: false, error: 'Nothing to write.' };
  if (edits.length > 40) return { ok: false, error: 'That’s too many changes at once.' };
  var byKey = {}, people = {};
  model.people.forEach(function(p, i) {
    people[p.key] = p;
    p.deductions.forEach(function(d) { byKey[d.key] = { cell: d.cell, what: p.name + ' · ' + d.name, field: 'amount', taxes: d.taxes }; });
  });
  (model.shared.pay || []).forEach(function(x) { byKey[x.key] = { cell: x.cell, what: x.account + ' · ' + x.name, field: 'amount' }; });
  (model.bills || []).forEach(function(b) { byKey[b.key] = { bill: b, what: b.name }; });
  var writes = [], seen = {};
  for (var i = 0; i < edits.length; i++) {
    var e = edits[i] || {}, key = bgText_(e.key), field = bgText_(e.field) || 'amount', cell = null, what = '';
    var m = key.match(/^([^.]+)\.(cadence|gross|net|perYear|perMonth|psave|ssave)$/);
    if (key === 'split') { field = 'split'; cell = model.cells.split; what = model.people[0].name + '’s share of shared costs'; }
    else if (m && people[m[1]]) {
      var p = people[m[1]], f = m[2];
      if (f === 'ssave') { var idx = model.people.indexOf(p); cell = model.cells.sharedSavings && model.cells.sharedSavings[idx]; field = 'amount'; what = p.name + ' · shared savings'; }
      else { cell = p.cells[f === 'gross' ? 'gross' : f]; field = f === 'gross' || f === 'net' || f === 'psave' ? 'amount' : f;
        what = p.name + ' · ' + ({ cadence: 'pay cadence', gross: 'gross pay per paycheck', net: 'net deposit per paycheck', perYear: 'paychecks a year', perMonth: 'paychecks in a regular month', psave: 'personal savings' })[f]; }
    } else if (byKey[key] && byKey[key].bill) {
      var b = byKey[key].bill;
      if (!b.cells[field]) return { ok: false, error: 'A bill has no ' + field + ' to change.' };
      cell = b.cells[field]; what = b.name + ' · ' + field;
    } else if (byKey[key]) {
      if (byKey[key].taxes) return { ok: false, error: 'Taxes are worked out from the deposit; change the net deposit instead.' };
      cell = byKey[key].cell; what = byKey[key].what + ' per paycheck';
    } else return { ok: false, error: 'The sheet no longer has “' + key.replace(/^[^:]*:/, '') + '”. Refresh and try again.' };
    if (!cell) return { ok: false, error: what + ' isn’t in the sheet.' };
    var chk = bgCheckValue_(field, e.value, model);
    if (!chk.ok) return { ok: false, error: what + ': ' + chk.error };
    var id = cell.row + ':' + cell.col;
    if (seen[id]) return { ok: false, error: what + ' is changed twice.' };
    seen[id] = 1;
    writes.push({ row: cell.row, col: cell.col, value: chk.value, what: what, field: field });
  }
  return { ok: true, writes: writes };
}

/**
 * Pure: a new bill → where it goes and what each column holds.
 * The first empty row inside the bills list, else a new row after the last bill (so the sheet's
 * Total bills sum takes it in). → { ok, row, insertAfter, values:[name, monthly, type, for, paid by, kept as, category] }.
 */
function bgAddBillPlan_(model, bill) {
  if (!model || !model.ok) return { ok: false, error: (model && model.error) || 'The sheet couldn’t be read.' };
  bill = bill || {};
  var C = model.cells.bills || {}, cols = C.columns || {};
  if (!C.total) return { ok: false, error: 'The bills list has no Total bills row, so VERA can’t tell where it ends.' };
  var out = {};
  var fields = [['name', bill.name], ['amount', bill.amount], ['type', bill.type || 'Fixed'], ['forWho', bill.forWho || 'Shared'], ['paidBy', bill.paidBy || 'Joint'], ['keptAs', bill.keptAs || 'Actual'], ['category', bill.category || '']];
  for (var i = 0; i < fields.length; i++) { var c = bgCheckValue_(fields[i][0], fields[i][1], model); if (!c.ok) return { ok: false, error: c.error }; out[fields[i][0]] = c.value; }
  var dup = (model.bills || []).filter(function(b) { return bgLow_(b.name) === bgLow_(bgName_(out.name)) && bgLow_(b.forWho) === bgLow_(out.forWho); })[0];
  if (dup) return { ok: false, error: '“' + dup.name + '” is already a bill for ' + dup.forWho + '. Change that one instead.' };
  var last = (model.bills || []).reduce(function(m, b) { return Math.max(m, b.row); }, C.first - 1);
  var blank = (C.blanks || []).filter(function(r) { return r > last; })[0] || (C.blanks || [])[0];
  var values = [];
  [['name', cols.name], ['amount', cols.amount], ['type', cols.type], ['forWho', cols.forWho], ['paidBy', cols.paidBy], ['keptAs', cols.keptAs], ['category', cols.category]]
    .forEach(function(f) { if (f[1]) values.push({ col: f[1], value: out[f[0]] }); });
  return blank ? { ok: true, row: blank, insertAfter: null, values: values, bill: out } : { ok: true, row: last + 1, insertAfter: last, values: values, bill: out };
}

/** Writes the planned cells, refusing any that hold a formula. All are checked before any is written. */
function bgApplyWrites_(sheet, writes) {
  for (var i = 0; i < writes.length; i++) {
    var f = sheet.getRange(writes[i].row, writes[i].col).getFormula();
    if (f) return { ok: false, error: writes[i].what + ' is worked out by the sheet, so VERA won’t type over it.' };
  }
  writes.forEach(function(w) { sheet.getRange(w.row, w.col).setValue(w.value); });
  return { ok: true };
}

/** POST budget_write { edits:[{ key, field, value }] } → { ok, written } — the changes, then the fresh model. */
function webBudgetWrite_(body) {
  var s = bgSplitSheet_();
  if (s.error) return { ok: false, error: s.error };
  return tiLocked_(function() {
    var model = budgetModel_(s.sheet.getDataRange().getValues());
    var plan = bgWritePlan_(model, body && body.edits);
    if (!plan.ok) return plan;
    var done = bgApplyWrites_(s.sheet, plan.writes);
    if (!done.ok) return done;
    try { veraLog_('budget_write', 'Budget', 'Success', 'Household Split: ' + plan.writes.map(function(w) { return w.what; }).join('; ')); } catch (e) {}
    return { ok: true, written: plan.writes.length, what: plan.writes.map(function(w) { return w.what; }) };
  });
}

/** POST budget_add_bill { name, amount, type, forWho, paidBy, keptAs, category } → { ok, row }. */
function webBudgetAddBill_(body) {
  var s = bgSplitSheet_();
  if (s.error) return { ok: false, error: s.error };
  return tiLocked_(function() {
    var model = budgetModel_(s.sheet.getDataRange().getValues());
    var plan = bgAddBillPlan_(model, body);
    if (!plan.ok) return plan;
    if (plan.insertAfter) s.sheet.insertRowAfter(plan.insertAfter);
    var done = bgApplyWrites_(s.sheet, plan.values.map(function(v) { return { row: plan.row, col: v.col, value: v.value, what: plan.bill.name }; }));
    if (!done.ok) return done;
    try { veraLog_('budget_add_bill', 'Budget', 'Success', 'Household Split: added ' + plan.bill.name + ' (' + plan.bill.forWho + ', ' + plan.bill.amount + ' a month) in row ' + plan.row); } catch (e) {}
    return { ok: true, row: plan.row, bill: plan.bill };
  });
}
