// Card Hub, the server and the maths. Pins:
//  - the value maths (CardValue.js) is copied verbatim into both dashboards;
//  - a point is worth your ¢, else the program's typical, else VERA's typical, else 1¢;
//    a cell like "1.7 – 2.0+" reads 1.7; a card earns into the program whose Linked Card
//    lists it;
//  - the cheat sheet: fixed groups in order, best by cents back per $1, ties to the lower
//    fee, Costco Visa-only, abroad only no-FX cards, closed cards out, broad Travel and
//    everyday rates as fallbacks, other categories under More, a person filter;
//  - the reader: new card/program/goal fields, a program on two rows is one, goals read
//    their program (plus transfers), Points History and Perk Uses; FX % keeps No FX in step;
//  - perk uses are logged once per cycle and removed when the tick is taken back;
//  - nightly: points expiring (90 days), status renewing (60), the annual fee (30) against
//    what the perks paid back; the fee month column first; the grocery pick by value.
// Invented cards, programs and perks.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CV = read('CardValue.js'), CH = read('CardHub.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html'), GR = read('Groceries.js'), FS = read('FinSummary.js'), FT = read('FlagsTasks.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const fnSrc = (src, name) => { const a = src.indexOf('function ' + name + '('); if (a === -1) return ''; let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); };
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); return i === -1 || j === -1 ? '' : s.slice(i, j + b.length); };

const shared = between(CV, '// ---- CardValue (shared) ----', '// ---- /CardValue ----');
console.log('\none copy of the maths');
check('the value maths is in both dashboards, exactly as in CardValue.js', shared.length > 2000 && APP.indexOf(shared) !== -1 && LITE.indexOf(shared) !== -1);
const blockA = between(APP, '// ---- CardHub (', '// ---- /CardHub ----'), blockL = between(LITE, '// ---- CardHub (', '// ---- /CardHub ----');
check('…and the whole Card Hub block is the same in both', blockA.length > 5000 && blockA === blockL);

const C = (() => { const c = { console }; vm.createContext(c); vm.runInContext(shared, c); return c; })();

console.log('\nwhat a point is worth');
check('your ¢ first; "1.7 – 2.0+" reads 1.7', C.cvCpp_({ program: 'Amex MR', centsPerPoint: '1.7 – 2.0+' }) === 1.7);
check('…else the Typical CPP column', C.cvCpp_({ program: 'Amex MR', centsPerPoint: '', typicalCpp: '2.1' }) === 2.1);
check('…else VERA’s typical for the program', C.cvCpp_({ program: 'United MileagePlus' }) === 1.2 && C.cvCpp_({ program: 'Marriott Bonvoy' }) === 0.8 && C.cvCpp_({ program: 'Chase UR' }) === 1.7);
check('…else 1¢; no program at all is 1¢', C.cvCpp_({ program: 'Corner Café Points' }) === 1 && C.cvCpp_(null) === 1);
const programs = [{ id: 'LP-1', program: 'Amex MR', linkedCard: 'CC-1', centsPerPoint: '1.6' }, { id: 'LP-2', program: 'Chase UR', linkedCard: 'CC-2, CC-3', centsPerPoint: '' }];
check('a card earns into the program whose Linked Card lists it (comma list)', (C.cvProgramFor_({ id: 'CC-3' }, programs) || {}).program === 'Chase UR' && C.cvProgramFor_({ id: 'CC-9' }, programs) === null);
check('cash back counts as it is; points at the program’s value', C.cvRewardValue_({ rate: '3', rateType: '% cashback' }, { id: 'CC-4' }, programs) === 3
      && C.cvRewardValue_({ rate: '4', rateType: 'x points' }, { id: 'CC-1' }, programs) === 6.4 && C.cvRewardValue_({ rate: '1.5', rateType: 'x points' }, { id: 'CC-2' }, programs) === 2.55);
check('categories map into the fixed list; others are left for More', C.cvCategoryOf_('Groceries') === 'groceries' && C.cvCategoryOf_('Gas stations and EV charging') === 'gas' && C.cvCategoryOf_('General Spend') === 'general'
      && C.cvCategoryOf_('Chase Travel Portal') === 'portal' && C.cvCategoryOf_('Hotels (Pay at Hotel)') === 'hotelPay' && C.cvCategoryOf_('BMW Services') === '');

console.log('\nthe cheat sheet');
const cards = [
  { id: 'CC-1', cardName: 'Gold', owner: 'Ahmed', authUser: 'Victoria', active: 'Yes', annualFee: 325, network: 'Amex', fxFeePct: '0' },
  { id: 'CC-2', cardName: 'Sapphire', owner: 'Ahmed', active: 'Yes', annualFee: 550, network: 'Visa', noFxFee: true },
  { id: 'CC-3', cardName: 'Freedom', owner: 'Ahmed', active: 'Yes', annualFee: 0, network: 'Visa', fxFeePct: '3' },
  { id: 'CC-4', cardName: 'Cash Card', owner: 'Victoria', active: 'Yes', annualFee: 0, network: 'Mastercard' },
  { id: 'CC-5', cardName: 'Old Card', owner: 'Victoria', active: 'Yes', annualFee: 0, network: 'Visa', closed: '2026-01' },
  { id: 'CC-6', cardName: 'Twin', owner: 'Victoria', active: 'Yes', annualFee: 95, network: 'Visa' },
];
const rewards = [
  { cardName: 'Gold', category: 'Groceries', rate: '4', rateType: 'x points' }, { cardName: 'Gold', category: 'Dining', rate: '4', rateType: 'x points' },
  { cardName: 'Cash Card', category: 'Groceries', rate: '3', rateType: '% cashback' }, { cardName: 'Cash Card', category: 'Costco', rate: '5', rateType: '% cashback' },
  { cardName: 'Freedom', category: 'Costco', rate: '2', rateType: '% cashback' }, { cardName: 'Freedom', category: 'General Spend', rate: '1.5', rateType: 'x points' },
  { cardName: 'Sapphire', category: 'Travel', rate: '3', rateType: 'x points' }, { cardName: 'Sapphire', category: 'International Travel', rate: '3', rateType: 'x points' },
  { cardName: 'Old Card', category: 'Groceries', rate: '9', rateType: '% cashback' },
  { cardName: 'Twin', category: 'Dining', rate: '6.4', rateType: '% cashback' }, { cardName: 'Twin', category: 'BMW Services', rate: '5', rateType: '% cashback' },
];
const rows = C.cvCheat_(cards, rewards, programs, {}), by = k => rows.find(r => r.key === k);
check('the groups in order: Everyday, Travel, Online & bills, then More', J([...new Set(rows.map(r => r.group))]) === J(['Everyday', 'Travel', 'Online & bills', 'More']));
check('…and the fixed order inside them', J(rows.filter(r => r.group === 'Everyday').map(r => r.label)) === J(['Groceries', 'Gas / EV', 'Costco', 'Dining', 'Everything else']));
check('groceries by value: 4x at 1.6¢ (6.4¢) beats 3% cash; a closed card is out', by('groceries').picks[0].card.cardName === 'Gold' && by('groceries').picks[1].card.cardName === 'Cash Card' && !by('groceries').picks.some(p => p.card.cardName === 'Old Card'));
check('a tie goes to the lower annual fee', by('dining').picks[0].card.cardName === 'Twin' && by('dining').picks[1].card.cardName === 'Gold', J(by('dining').picks.map(p => p.card.cardName + ' ' + p.value)));
check('Costco offers Visa only (the 5% Mastercard isn’t offered)', by('costco').picks[0].card.cardName === 'Freedom' && !by('costco').picks.some(p => p.card.network === 'Mastercard'));
check('a broad Travel rate covers flights and rental cars', by('flights').picks[0].card.cardName === 'Sapphire' && by('flights').picks[0].how === 'broad' && by('rental').picks[0].card.cardName === 'Sapphire');
check('…an everyday rate is the fallback for a category with no rate', by('streaming').picks[0].how === 'general');
check('abroad: only cards with no foreign fee (0% or No FX), their own international rate first', by('abroad').picks.every(p => ['Gold', 'Sapphire'].indexOf(p.card.cardName) !== -1) && by('abroad').picks[0].card.cardName === 'Sapphire');
check('a category nobody maps shows under More', rows.some(r => r.group === 'More' && r.label === 'BMW Services'));
const vic = C.cvCheat_(cards, rewards, programs, { who: 'Victoria' });
check('Victoria’s view: her cards and the ones she’s an authorised user on', vic.find(r => r.key === 'groceries').picks.map(p => p.card.cardName).join() === 'Gold,Cash Card');
const away = C.cvCheat_(cards, rewards, programs, { abroad: true });
check('“I’m abroad” leaves only no-FX cards everywhere', away.every(r => r.picks.every(p => C.cvNoFx_(p.card))));
check('the rate as written, and its value', C.cvRateText_(by('groceries').picks[0]) === '4x ≈ 6.4¢' && C.cvRateText_(by('groceries').picks[1]) === '3%' && /\(travel rate\)$/.test(C.cvRateText_(by('flights').picks[0])));

console.log('\nthe reader and the writers');
{
  const W = { console, String, Number, Object, Array, Date, JSON, Math, isNaN };
  vm.createContext(W);
  ['cardCell_', 'cardDay_', 'cardMonth_', 'cardGoalPoints_', 'cardFxFlag_'].forEach(n => vm.runInContext(fnSrc(WEB, n), W));
  const progs = [{ id: 'LP-U', program: 'United', totalPoints: 100000, transfersFrom: 'Chase UR 1:1, Amex MR 1:1' }, { id: 'LP-C', program: 'Chase UR', totalPoints: 50000 }, { id: 'LP-A', program: 'Amex MR', totalPoints: 20000 }];
  check('a goal reads its program’s balance', J(W.cardGoalPoints_({ targetProgram: 'United' }, progs)) === J({ fromProgram: true, points: 100000, transferable: 0 }));
  check('…plus bank points that transfer in, when ticked', J(W.cardGoalPoints_({ targetProgram: 'United', countTransfers: true }, progs)) === J({ fromProgram: true, points: 170000, transferable: 70000 }));
  check('…a program that isn’t listed keeps the typed points', J(W.cardGoalPoints_({ targetProgram: 'Hyatt', currentPoints: 12 }, progs)) === J({ fromProgram: false, points: 12, transferable: 0 }));
  check('a foreign fee % decides No FX: 0% is Yes, 3% is No; with no % the answer sent stands', W.cardFxFlag_('', '0') === 'Yes' && W.cardFxFlag_('Yes', '3') === 'No' && W.cardFxFlag_('Yes', '') === 'Yes' && W.cardFxFlag_('', '') === '');
  const g = fnSrc(WEB, 'webGetCards_');
  check('the reader returns the new card fields', /feeMonth:\s+cardCell_\(r\[14\]\),/.test(g) && /fxFeePct:\s+cardCell_\(r\[15\]\),/.test(g) && /network:\s+cardCell_\(r\[16\]\),/.test(g) && /closed:\s+cardMonth_\(r\[18\]\),/.test(g));
  check('…the program fields, one program per ID however many rows', /transfersFrom: cardCell_\(r\[12\]\),/.test(g) && /var k = p\.id \|\| p\.program;/.test(g) && /into\.linkedCard = \[into\.linkedCard, p\.linkedCard\]/.test(g));
  check('…goals from their program, the history and this year’s perk uses', /cardGoalPoints_\(g, programs\)/.test(g) && /history: history, perkUses: perkUses/.test(g) && /c\.perksUsedValue = perkUses/.test(g));
  check('the column numbers follow the header list', /feeMonth:15, fxFeePct:16, network:17, opened:18, closed:19/.test(fnSrc(WEB, 'webUpdateCard_'))
        && /owner:9, memberNo:10, status:11, statusRenews:12, transfersFrom:13, typicalCpp:14/.test(fnSrc(WEB, 'webUpdateLoyaltyProgram_')) && /countTransfers:7/.test(fnSrc(WEB, 'webUpdateRewardsGoal_')));
  check('a changed balance is dated in Points History (dashboard or chat)', /cardLogPoints_\(id, p\.totalPoints, p\.source \|\| 'dashboard'\)/.test(fnSrc(WEB, 'webUpdateLoyaltyProgram_')) && /totalPoints: ulPts, source: 'chat'/.test(read('Chat.js')));
  const H = (s, a) => { const m = new RegExp('const ' + a + '\\s*=\\s*\\[([^\\]]*)\\]').exec(CODE); return m ? m[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')) : []; };
  check('the new columns are appended, never moved', J(H(CODE, 'CREDIT_CARD_HEADERS').slice(13)) === J(['No FX Fee', 'Fee Month', 'FX Fee %', 'Network', 'Opened', 'Closed'])
        && J(H(CODE, 'LOYALTY_PROGRAM_HEADERS').slice(7)) === J(['Notes', 'Owner', 'Member #', 'Status', 'Status Renews', 'Transfers From', 'Typical CPP']) && H(CODE, 'REWARDS_GOAL_HEADERS')[6] === 'Count Transfers');
}

console.log('\nperk uses');
{
  const rows = [['Date', 'Perk ID', 'Card', 'Amount', 'Period']], perkRows = [['ID', 'Card Name', 'Perk', 'Amount'], ['CP-1', 'Gold', 'Uber', 15]];
  const sheet = r => ({ getLastRow: () => r.length, getRange: (a, b, n, w) => ({ getValues: () => r.slice(a - 1, a - 1 + n).map(x => x.slice(b - 1, b - 1 + w)) }), appendRow: x => r.push(x), deleteRow: i => r.splice(i - 1, 1) });
  const W = { String, Number, TABS: { PERK_USES: 'Perk Uses', CARD_PERKS: 'Card Perks' }, PERK_USE_HEADERS: rows[0],
    getSpreadsheet: () => ({ getSheetByName: n => n === 'Card Perks' ? sheet(perkRows) : sheet(rows) }), ensureSheet: () => sheet(rows),
    Utilities: { formatDate: () => '2027-03-10' }, Session: { getScriptTimeZone: () => 'UTC' } };
  vm.createContext(W); vm.runInContext(fnSrc(WEB, 'cardPerkUseLog_'), W);
  check('a tick adds the perk, its card, amount and cycle', W.cardPerkUseLog_('CP-1', '2027-03', true) === true && J(rows[1]) === J(['2027-03-10', 'CP-1', 'Gold', 15, '2027-03']));
  check('…never twice in one cycle', W.cardPerkUseLog_('CP-1', '2027-03', true) === false && rows.length === 2);
  check('…a new cycle is a new row', W.cardPerkUseLog_('CP-1', '2027-04', true) === true && rows.length === 3);
  check('taking the tick back removes that cycle’s row only', W.cardPerkUseLog_('CP-1', '2027-03', false) === true && rows.length === 2 && rows[1][4] === '2027-04');
  check('the dashboard tick and Chat both log it; un-ticking removes it', /cardPerkUseLog_\(perkId, periodKey, true\)/.test(fnSrc(WEB, 'finishCardPerkMarkedUsed_')) && /cardPerkUseLog_\(r\.id, r\.period, false\)/.test(fnSrc(WEB, 'webToggleCardPerk_')));
}

console.log('\nthe Perks list reads "used" as the server does');
{
  const fmt = (d, tz, p) => p === 'yyyy' ? String(d.getFullYear()) : p === 'M' ? String(d.getMonth() + 1) : p === 'yyyy-MM' ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const S = { String, Number, Math, Date, parseInt, Utilities: { formatDate: fmt } }; vm.createContext(S);
  vm.runInContext(['perkCycleYears_', 'perkAnchorDate_', 'cardPerkEligibleFrom_', 'cardPerkPeriodKey_', 'cardPerkIsUsed_'].map(n => fnSrc(CODE, n)).join('\n'), S);
  const fnA = between(APP, '/** Used this cycle?', "padStart(2,'0');}"), fnL = between(LITE, '/** Used this cycle?', "padStart(2,'0');}");
  check('one copy of the rule in both dashboards', fnA.length > 300 && fnA === fnL);
  const B = {}; vm.createContext(B); vm.runInContext(fnA, B);
  const nows = [new Date(2027, 0, 15), new Date(2027, 5, 30), new Date(2027, 6, 1), new Date(2028, 1, 28), new Date(2028, 2, 1), new Date(2031, 1, 28)];
  const cases = [['Monthly', '2027-01'], ['Monthly', '2027-06'], ['Monthly', '2026-12'], ['', '2027-01'], ['Quarterly', '2027-Q1'], ['Quarterly', '2027-Q3'], ['Semiannual', '2027-H1'], ['Semiannual', '2027-H2'],
    ['Annual', '2027'], ['Annual', '2028'], ['Standing', 'standing'], ['Monthly', ''], ['Every 4 Years', '2027-01-10'], ['Every 4 Years', '2024-02-29'], ['Every 4 Years', '2023-02-30'], ['Every 1 Year', '2027-03-01'], ['Every 4 Years', 'soon']];
  const bad = [];
  nows.forEach(now => cases.forEach(([f, lu]) => { const s = S.cardPerkIsUsed_(f, lu, now, 'UTC'), b = B.chPerkUsed_({ frequency: f, lastUsed: lu }, now); if (s !== b) bad.push(f + ' ' + lu + ' @' + now.toDateString() + ': server ' + s + ', list ' + b); }));
  check('agrees on every cycle, the Feb 29 claim and a date that isn’t one (' + nows.length * cases.length + ' cases)', bad.length === 0, bad.join(' | '));
}

console.log('\nnightly');
{
  const N = { console, String, Number, Object, Array, Date, Math, JSON };
  vm.createContext(N); vm.runInContext(shared, N); vm.runInContext(CH, N); vm.runInContext(fnSrc(FS, 'fsCardFeeMonth_'), N);
  vm.runInContext("var FS_MONTHS_ = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12}; function fsText_(v){ return String(v == null ? '' : v).trim(); }", N);
  const today = '2027-02-10';
  const w = N.chWantedFlags_([
    { id: 'LP-1', program: 'Marriott', totalPoints: 61200, expiry: '2027-04-01' },
    { id: 'LP-2', program: 'United', totalPoints: 1, expiry: '2027-12-01', status: 'Silver', statusRenews: '2027-03-31' },
    { id: 'LP-3', program: 'Empty', totalPoints: 0, expiry: '2027-02-20' }],
    [{ id: 'CC-1', cardName: 'Gold', annualFee: 325, feeMonth: 'March', perksUsedValue: 240, active: 'Yes' },
     { id: 'CC-2', cardName: 'Plat', annualFee: 895, notes: 'annual fee in March', perksUsedValue: 900, active: 'Yes' },
     { id: 'CC-3', cardName: 'Far', annualFee: 95, feeMonth: 'August' }], today);
  check('points expiring within 90 days', !!w['POINTS|EXP|LP-1|2027-04-01'] && /expire in 50 days/.test(w['POINTS|EXP|LP-1|2027-04-01'].flag) && w['POINTS|EXP|LP-1|2027-04-01'].due === '2027-04-01');
  check('…not far off, and not with no points', !Object.keys(w).some(k => /LP-2\|2027-12/.test(k) || /LP-3/.test(k)));
  check('status renewing within 60 days', !!w['POINTS|STATUS|LP-2|2027-03-31']);
  check('the fee 30 days out, against what the perks paid back', !!w['CARDFEE|CC-1|2027-03'] && /\$240 this year, \$85 short of the fee/.test(w['CARDFEE|CC-1|2027-03'].reason) && w['CARDFEE|CC-1|2027-03'].urgency === 'Medium');
  check('…a fee month from the notes still counts, and a card that paid its way is Low', !!w['CARDFEE|CC-2|2027-03'] && w['CARDFEE|CC-2|2027-03'].urgency === 'Low' && !w['CARDFEE|CC-3|2027-08']);
  check('the month reader', N.chMonthOf_('March') === 3 && N.chMonthOf_('3') === 3 && N.chMonthOf_('2027-11') === 11 && N.chMonthOf_('') === 0);
  check('the nightly run calls them, and the flags clear themselves', /nightlyStep_\(ctx, 'seedPerkUses_', seedPerkUses_\);\n\s*nightlyStep_\(ctx, 'checkCardHub_', checkCardHub_\);/.test(CODE)
        && /prefix: 'POINTS\|'/.test(FT) && /prefix: 'CARDFEE\|'/.test(FT));
  const F = { String, Number }; vm.createContext(F); vm.runInContext("var FS_MONTHS_ = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12}; function fsText_(v){ return String(v == null ? '' : v).trim(); }" + fnSrc(FS, 'fsCardFeeMonth_') + fnSrc(FS, 'fsCardFeeMonthOf_'), F);
  check('the Finance summary: Fee Month first, then the notes', F.fsCardFeeMonthOf_({ feeMonth: 'June', notes: 'fee in March' }) === 6 && F.fsCardFeeMonthOf_({ notes: 'fee in March' }) === 3 && /fsCardFeeMonthOf_\(c\)/.test(FS));
}

console.log('\nthe grocery pick agrees');
{
  const G = { console, String, Number, isFinite }; vm.createContext(G); vm.runInContext(shared + '\n' + fnSrc(GR, 'grCardsFor_') + '\n' + fnSrc(GR, 'grBestCard_'), G);
  const gc = [{ id: 'CC-1', name: 'Gold', owner: 'Ahmed' }, { id: 'CC-4', name: 'Cash', owner: 'Ahmed' }];
  const gr = [{ card: 'Gold', category: 'Groceries', rate: 4, rateType: 'x points' }, { card: 'Cash', category: 'Groceries', rate: 5, rateType: '% cashback' }];
  check('with programs, 4x at 1.6¢ (6.4¢) beats 5% cash', G.grBestCard_(gc, gr, 'Ahmed', [{ program: 'Amex MR', linkedCard: 'CC-1', centsPerPoint: '1.6' }]).card === 'Gold');
  check('…without, the old rate order stands', G.grBestCard_(gc, gr, 'Ahmed').card === 'Cash');
  check('the setup passes the programs', /grBestCard_\(cr\.cards, cr\.rewards, w, cr\.programs\)/.test(GR));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
