// Travel › Travelers › Profiles (TravelerProfiles.js, issue #227 Profiles A): the last-4 rule,
// cleaning, the one-time copy of the old Traveler Profiles tab, the passports the visa checks
// read, visas held covering a country, the reminders, the child gate, the routes over an
// in-memory sheet, and the wiring. Invented people, numbers and dates.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'TravelerProfiles.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const HEAD = eval((CODE.match(/const TRAVELER_ITEM_HEADERS\s*=\s*(\[[^\]]*\])/) || [])[1]);
const OLD_HEAD = ['ID', 'Name', 'Passport Country', 'Passport Expiry', 'Special Docs', 'Notes'];

function mkSheet(rows) {
  return { rows, getLastRow: () => rows.length,
    getRange: (r, c, n, w) => ({ getValues: () => rows.slice(r - 1, r - 1 + n).map(x => { const out = []; for (let i = 0; i < w; i++) out.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return out; }),
      setValues: v => v.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; }); }) }),
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    appendRow: r => rows.push(r.slice()), deleteRow: r => rows.splice(r - 1, 1) };
}

function ctx(o) {
  o = o || {};
  const items = mkSheet([HEAD].concat(o.rows || []));
  const old = o.old ? mkSheet([OLD_HEAD].concat(o.old)) : null;
  const perks = o.perks ? mkSheet([['ID', 'Card Name', 'Perk', 'Amount', 'Frequency', 'Category', 'Last Used']].concat(o.perks)) : null;
  const props = Object.assign({}, o.props || {});
  const flags = [], sent = [];
  const c = { String, Number, Object, Array, Date, JSON, Math, RegExp, isNaN, isFinite, Error, parseInt,
    TABS: { TRAVELER_ITEMS: 'Traveler Items', TRAVELER_PROFILES: 'Traveler Profiles', CARD_PERKS: 'Card Perks' }, TRAVELER_ITEM_HEADERS: HEAD,
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: d => d instanceof Date && o.realDates ? d.toISOString().slice(0, 10) : (o.today || '2027-03-01') },
    Logger: { log: () => {} },
    getSpreadsheet: () => ({ getSheetByName: n => n === 'Traveler Profiles' ? old : n === 'Card Perks' ? perks : null }),
    ensureSheet: () => items,
    getConfigValues: () => o.cfg || {}, fpReadSettings_: () => o.fp || { phase: 'plan' },
    plPlanned_: () => o.trips || [],
    perkCycleYears_: f => { const m = /every\s+(\d+)\s+years?/i.exec(f || ''); return m ? +m[1] : 0; },
    cardPerkEligibleFrom_: (last, y) => { if (!last) return null; const x = last.split('-').map(Number); return new Date(Date.UTC(x[0] + y, x[1] - 1, x[2])); },
    webGetPrescriptions_: () => ({ prescriptions: o.rx || [] }),
    writeFlags: f => flags.push(...f), wasRecentlySent_: k => (o.sentBefore || []).indexOf(k) !== -1,
    sendNudge_: (k, subj, text, notif) => sent.push({ k, subj, text, notif }) };
  vm.createContext(c); vm.runInContext(SRC, c);
  c.__items = items.rows; c.__props = props; c.__flags = flags; c.__sent = sent; c.__old = old;
  return c;
}

console.log('\nonly the last 4');
{
  const c = ctx();
  check('a passport number keeps its last 4 characters', c.tpLast4_('X1234 5678 9') === '6789' && c.tpLast4_('ab12cd') === '12CD' && c.tpLast4_('') === '');
  check('a long number typed in a note becomes ••••1234', c.tpScrub_('KTN 9876 5432 1 renew') === 'KTN ••••4321 renew' && c.tpScrub_('row 12, gate 4') === 'row 12, gate 4');
  const r = c.tpClean_({ person: 'Sam', section: 'trusted', kind: 'global_entry', last4: '981234567', notes: 'number 981234567', expiry: '2029-01-02' });
  check('saving a full number keeps only the last 4, and says so', r.item.last4 === '4567' && r.item.notes === 'number ••••4567' && r.trimmed === true, J(r));
  check('a short number is kept as typed, no note', c.tpClean_({ person: 'Sam', section: 'membership', kind: 'airline', last4: '1234', label: 'United' }).trimmed === false);
}

console.log('\ncleaning');
{
  const c = ctx();
  const err = b => c.tpClean_(b).error || '';
  check('needs a section, a kind and a person', /section/.test(err({ person: 'Sam', kind: 'visa' })) && /kind/.test(err({ person: 'Sam', section: 'document', kind: 'boat' })) && /Whose/.test(err({ section: 'document', kind: 'passport', country: 'Canada' })));
  check('a passport or visa needs its country; an ESTA is for the United States', /country/.test(err({ person: 'Sam', section: 'document', kind: 'passport' })) && /country/.test(err({ person: 'Sam', section: 'document', kind: 'visa' }))
    && c.tpClean_({ person: 'Sam', section: 'document', kind: 'esta' }).item.country === 'United States');
  check('it can’t expire before it was issued', /expire before/.test(err({ person: 'Sam', section: 'health', kind: 'vaccine', issued: '2027-01-01', expiry: '2026-01-01' })));
}

console.log('\nthe old Traveler Profiles tab, copied once');
{
  const old = [['prof_1', 'Sam', 'Canada', '2031-05-01', 'NEXUS card', 'blue cover'], ['prof_2', 'Sam', 'Ireland', '', '', ''], ['prof_3', 'Lee', 'Canada', '2027-06-30', '', 'passport 123456789']];
  const c = ctx({ old });
  const n = c.tpMigrateOnce_();
  check('each passport becomes an item, notes kept together, long numbers cut', n === 3 && c.__items.length === 4 && c.__items[1][0] === 'TI-prof_1' && c.__items[1][11] === 'NEXUS card · blue cover' && c.__items[3][11] === 'passport ••••6789', J(c.__items[3]));
  check('runs once: the flag is set and a second call copies nothing', /copied 3/.test(c.__props.TP_MIGRATED) && c.tpMigrateOnce_() === 0 && c.__items.length === 4);
  const c2 = ctx({ old, rows: [['TI-prof_1', 'Sam', 'document', 'passport', '', 'Canada', '', '', '2031-05-01', '', '', '', '']] });
  check('never copies a passport twice', c2.tpMigrateOnce_() === 2 && c2.__items.filter(r => r[0] === 'TI-prof_1').length === 1);
  c.webTpDelete_({ id: 'TI-prof_2' });
  check('a copied passport you delete doesn’t come back', c.tpMigrateOnce_() === 0 && !c.__items.some(r => r[0] === 'TI-prof_2') && c.webGetProfiles_().profiles.length === 2);
  check('the old tab is left alone', c.__old.rows.length === 4 && c.__old.rows[1][1] === 'Sam');
  const p = c.webGetProfiles_().profiles;
  check('the visa checks read the same passports, in the old shape', p.length === 2 && J(Object.keys(p[0]).sort()) === J(['id', 'name', 'notes', 'passportCountry', 'passportExpiry', 'specialDocs']) && p[1].name === 'Lee' && p[1].passportExpiry === '2027-06-30');
}

console.log('\nvisas held cover a country');
{
  const c = ctx();
  const items = [{ person: 'Sam', section: 'document', kind: 'eta', country: 'United Kingdom', expiry: '2028-01-01' },
    { person: 'Sam', section: 'document', kind: 'visa', country: 'India', expiry: '2027-03-10' },
    { person: 'Lee', section: 'document', kind: 'passport', country: 'Canada' }];
  const held = c.tpHeld_(items);
  check('held documents by person, passports aren’t one', J(Object.keys(held)) === J(['Sam']) && held.Sam.length === 2);
  const t = () => [{ name: 'Sam', passports: [{ color: 'yellow', label: 'eTA' }, { color: 'green', label: 'Visa Free' }] }, { name: 'Lee', passports: [{ color: 'yellow', label: 'eTA' }] }];
  const uk = c.tpApplyHeld_(t(), held, 'United Kingdom', '2027-04-02');
  check('an ETA held for the country, valid past the trip: green, says what’s held', uk[0].passports[0].color === 'green' && uk[0].passports[0].label === 'Held: ETA to 2028-01-01' && uk[0].passports[0].held.kind === 'eta');
  check('only for the person who holds it', uk[1].passports[0].color === 'yellow');
  check('a visa that runs out before the trip ends covers nothing', c.tpApplyHeld_(t(), held, 'India', '2027-03-20')[0].passports[0].color === 'yellow');
  check('…nor one for another country', c.tpApplyHeld_(t(), held, 'France', '2027-03-20')[0].passports[0].color === 'yellow');
  check('“No admission” stays red, whatever is held', c.tpApplyHeld_([{ name: 'Sam', passports: [{ color: 'red', label: 'No Admission' }] }], held, 'United Kingdom', '2027-04-02')[0].passports[0].color === 'red');
  check('the trip documents check uses it, guarded so it never breaks the check', /if \(held\) tpApplyHeld_\(travelers, held, c\.country, endDate\);\n    tripPickPassports_\(travelers\);/.test(WEB) && /typeof tpHeld_ === 'function'/.test(WEB));
}

console.log('\nreminders');
{
  const c = ctx();
  const items = [
    { id: 'p1', person: 'Sam', section: 'document', kind: 'passport', country: 'Canada', expiry: '2027-10-15' },
    { id: 'p2', person: 'Lee', section: 'document', kind: 'passport', country: 'Canada', expiry: '2032-01-01' },
    { id: 'e1', person: 'Lee', section: 'document', kind: 'eta', country: 'United Kingdom', expiry: '2027-05-03' },
    { id: 'g1', person: 'Sam', section: 'trusted', kind: 'global_entry', expiry: '2027-07-01' },
    { id: 'g2', person: 'Lee', section: 'trusted', kind: 'precheck', expiry: '2029-07-01' }];
  const trips = [{ country: 'United Kingdom', label: 'London in May', startDate: '2027-05-01', endDate: '2027-05-09' }];
  const due = c.tpRemindersDue_(items, trips, '2027-03-01', [{ card: 'Travel Card', perk: 'Global Entry / TSA PreCheck', availableFrom: '' }], {});
  const keys = due.map(d => d.key);
  check('a passport that runs out within 9 months', keys.indexOf('tp_passport_p1_2027-10-15') !== -1 && keys.filter(k => /^tp_passport_p2/.test(k)).length === 0, J(keys));
  check('a passport short of 6 months after a trip abroad', keys.indexOf('tp_passport_trip_p1_2027-10-15_2027-05-01') !== -1 && /London in May/.test(due.find(d => d.key === 'tp_passport_trip_p1_2027-10-15_2027-05-01').flag));
  check('an ETA that runs out before a trip there', keys.indexOf('tp_held_e1_2027-05-03_2027-05-01') !== -1);
  const ge = due.find(d => d.key === 'tp_trusted_g1_2027-07-01');
  check('Global Entry 6 months out, with the card that pays for it', ge && /Travel Card/.test(ge.reason) && keys.filter(k => /g2/.test(k)).length === 0, J(ge));
  const ge2 = c.tpRemindersDue_(items.slice(3, 4), [], '2027-03-01', [{ card: 'Travel Card', perk: 'Global Entry', availableFrom: '2027-09-01' }], {})[0];
  check('…or when that credit is available again', /available again from 2027-09-01/.test(ge2.reason));
  check('the lead is Config tp_passport_lead_months', c.tpRemindersDue_(items.slice(0, 1), [], '2027-03-01', [], { tp_passport_lead_months: 3 }).length === 0);
  check('keys carry the expiry, so a renewal starts over', due.every(d => /20\d\d-\d\d-\d\d/.test(d.key)));
  check('nothing for what has already run out', c.tpRemindersDue_([{ id: 'x', person: 'Sam', section: 'document', kind: 'passport', expiry: '2027-01-01' }], [], '2027-03-01', [], {}).length === 0);
}

console.log('\nchildren');
{
  const c = ctx();
  check('the Children section waits for the birth', !c.tpHasChild_({ phase: 'plan' }, '2027-03-01') && !c.tpHasChild_({ phase: 'pregnant', dueDate: '2027-06-01' }, '2027-03-01')
    && c.tpHasChild_({ phase: 'leave' }, '2027-03-01') && c.tpHasChild_({ phase: 'back' }, '2027-03-01') && c.tpHasChild_({ phase: 'pregnant', dueDate: '2027-02-20' }, '2027-03-01'));
}

console.log('\nthe routes');
{
  const c = ctx({ old: [['prof_9', 'Sam', 'Canada', '2031-01-01', '', '']], fp: { phase: 'back' }, rx: [{ id: 'RX-1', person: 'Sam', medication: 'Inhaler', refillDate: '2027-03-20' }] });
  const g = c.webTpGet_();
  check('get: copies the old passports first, lists people, sections with what they’re used for', g.ok && g.items.length === 1 && J(g.people) === J(['Sam']) && g.sections.length === 7 && g.sections.some(s => s.id === 'contact') && g.sections.every(s => s.usedFor) && g.hasChild === true && g.prescriptions[0].medication === 'Inhaler');
  const s = c.webTpSave_({ person: 'Lee', section: 'membership', kind: 'airline', label: 'United', last4: '00112233', tier: 'Gold', value: 'Star Alliance' });
  check('save adds, cutting the number', s.ok && s.trimmed && s.note === 'Kept the last 4 only.' && c.__items[2][6] === '2233' && c.__items[2][9] === 'Gold');
  const u = c.webTpSave_({ id: s.id, person: 'Lee', section: 'membership', kind: 'airline', label: 'United', last4: '2233', tier: 'Platinum' });
  check('save with an id updates that row', u.ok && !u.trimmed && c.__items.length === 3 && c.__items[2][9] === 'Platinum');
  check('a bad save says why', c.webTpSave_({ person: 'Lee', section: 'document', kind: 'visa' }).error === 'Which country is it for?' && /gone/.test(c.webTpSave_({ id: 'nope', person: 'Lee', section: 'health', kind: 'diet' }).error));
  check('the old save_profile route saves a passport item', c.webSaveProfile_({ parameter: { name: 'Lee', passportCountry: 'Ireland', passportExpiry: '2030-02-02' } }).ok && c.webGetProfiles_().profiles.some(p => p.name === 'Lee' && p.passportCountry === 'Ireland'));
  check('delete removes it, and the old route does too', c.webTpDelete_({ id: s.id }).ok && c.__items.length === 3 && c.webDeleteProfile_({ parameter: { id: 'TI-prof_9' } }).ok && c.__items.length === 2);
}

console.log('\nnightly');
{
  const c = ctx({ rows: [['g1', 'Sam', 'trusted', 'global_entry', '', '', '1234', '', '2027-05-01', '', '', '', '']], props: { TP_MIGRATED: 'x' }, perks: [['CP-1', 'Travel Card', 'Global Entry / TSA PreCheck', 120, 'Every 4 Years', 'Travel', '']] });
  check('writes the flag and sends the nudge once, through travel_docs', /1 due, 1 sent/.test(c.tpNightly_()) && c.__flags[0].source === 'Travel' && c.__sent[0].notif === 'travel_docs' && /Travel Card/.test(c.__sent[0].text));
  const c2 = ctx({ rows: [['g1', 'Sam', 'trusted', 'global_entry', '', '', '', '', '2027-05-01', '', '', '', '']], props: { TP_MIGRATED: 'x' }, sentBefore: ['tp_trusted_g1_2027-05-01'] });
  check('a reminder already sent isn’t sent again', /0 sent/.test(c2.tpNightly_()) && c2.__sent.length === 0);
}

console.log('\nthe wiring');
{
  check('Traveler Items is declared, with its headers', /TRAVELER_ITEMS:\s+'Traveler Items'/.test(CODE) && HEAD && HEAD.length === 13 && HEAD[6] === 'Last 4');
  check('no header asks for a full number', !HEAD.some(h => /number|ktn/i.test(h)));
  check('the Travel Documents notification and the nightly step', /key: 'travel_docs'/.test(CODE) && /nightlyStep_\(ctx, 'tpNightly_', tpNightly_\)/.test(CODE));
  check('routes: tp_get, tp_save, tp_delete; the old profile routes still answer', /case 'tp_get':\s+return jsonOut_\(webTpGet_\(\)\)/.test(WEB) && /case 'tp_save':\s+return jsonOut_\(webTpSave_\(body\)\)/.test(WEB) && /case 'tp_delete':\s+return jsonOut_\(webTpDelete_\(body\)\)/.test(WEB) && /case 'get_profiles':/.test(WEB));
  check('WebApp.js no longer reads the old tab itself', !/function webGetProfiles_\(/.test(WEB) && !/function webSaveProfile_\(/.test(WEB));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
