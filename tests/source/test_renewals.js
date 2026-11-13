// #245 Renewals + the Vehicles card. Pins:
//  - the ladder: day 30 flags and day 31 doesn't; 30–15 Low, 14–8 Medium, 7 or fewer High;
//    passed is High, "renewed? update the tab"; warranties stay Low (30 days either side of
//    the end), then go to History; a blank date never flags;
//  - Coming up: soonest and most urgent first, dates and miles together; miles that are
//    old (or never dated) are stale, with one Low flag a month;
//  - the flags: one per vehicle per item, keyed by the date, so moving the date resolves
//    it, and a second night makes no duplicate (the real upsertKeyedFlags_);
//  - the calendar reminder: the title, a week before (never before today), the alarm;
//  - the writes: Renewed… sets one expiry cell under the lock, Done… for service sets Last
//    and Next Service, new miles stamp Mileage Updated; refusals for bad input;
//  - the wiring: the nightly step, the notification row, the routes, the flag button,
//    and one card shared by both dashboards.
// Invented vehicles.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const REN = read('Renewals.js'), CODE = read('Code.js'), WEB = read('WebApp.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const fnSrc = (src, name) => { const a = src.indexOf('function ' + name + '('); if (a === -1) return ''; const m = /\)\s*\{/g; m.lastIndex = a; let d = 0, j = src.indexOf('{', m.exec(src).index); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); };
const HEADERS = (CODE.match(/^const VEHICLE_HEADERS\s*=\s*(\[[^\]]*\]);/m) || [])[1];
const TODAY = '2026-11-13';
const plus = n => { const d = new Date(Date.UTC(2026, 10, 13 + n)); return d.toISOString().slice(0, 10); };

function ctx(extra) {
  const c = Object.assign({ String, Array, Object, JSON, Math, Number, isNaN, parseInt, parseFloat, Date, RegExp, Logger: { log: () => {} } }, extra || {});
  vm.createContext(c);
  vm.runInContext('var VEHICLE_HEADERS = ' + HEADERS + ';\n' + REN, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const veh = o => Object.assign({ ID: 'veh_1', Nickname: 'Family SUV', Year: 2021, Make: 'Example', Model: 'Trailblazer' }, o || {});

console.log('\nThe ladder');
{
  const c = ctx();
  const one = (col, days) => { c.v = veh({ [col]: days === null ? '' : plus(days) }); return run(c, 'renewalItems_(v, ' + J(TODAY) + ')').coming[0] || {}; };
  check('day 31: listed, not flagged', one('Registration Expiry', 31).status === 'ok' && !one('Registration Expiry', 31).flagKey && one('Registration Expiry', 31).chip === 'OK');
  check('day 30: Low', one('Registration Expiry', 30).urgency === 'Low' && one('Registration Expiry', 30).chip === '30 days');
  check('day 15 Low, 14 Medium, 8 Medium, 7 High, today High', one('Insurance Expiry', 15).urgency === 'Low' && one('Insurance Expiry', 14).urgency === 'Medium' && one('Insurance Expiry', 8).urgency === 'Medium' && one('Insurance Expiry', 7).urgency === 'High' && one('Insurance Expiry', 0).chip === 'Today');
  const p = one('Insurance Expiry', -52);
  check('passed: High, "renewed? Update the tab"', p.urgency === 'High' && p.chip === 'Passed' && p.flag === 'Family SUV: insurance passed on Sep 22: renewed? Update the tab' && /flag goes by itself/.test(p.reason), J(p));
  const s = one('Next Service', -13);
  check('service late: days late, "done? Log it"', s.chip === '13 days late' && /service was due Oct 31: done\? Log it on the card/.test(s.flag), J(s));
  check('every dated column counts: emission and safety inspections too', one('Emission Inspection Expiry', 10).urgency === 'Medium' && one('Safety Inspection Expiry', 3).urgency === 'High');
  check('a warranty stays Low, even just ended', one('Warranty Expiry (Powertrain)', 5).urgency === 'Low' && one('Warranty Expiry (B2B)', -10).urgency === 'Low' && one('Warranty Expiry (B2B)', -10).chip === 'Ended');
  c.v = veh({ 'Warranty Expiry (B2B)': '2024-03-01' });
  const old = run(c, 'renewalItems_(v, ' + J(TODAY) + ')');
  check('…and long ended, it leaves Coming up for History, unflagged', old.coming.length === 0 && old.history.length === 1 && old.history[0].when === 'Ended Mar 1, 2024', J(old));
  c.v = veh({});
  check('a blank date: nothing', run(c, 'renewalItems_(v, ' + J(TODAY) + ')').coming.length === 0);
  c.v = veh({ 'Registration Expiry': new Date(2026, 10, 26) });
  check('a date from the sheet (a Date) reads the same', run(c, 'renewalItems_(v, ' + J(TODAY) + ')').coming[0].date === '2026-11-26');
}

console.log('\nComing up, and the miles');
{
  const c = ctx();
  c.v = veh({ 'Registration Expiry': plus(200), 'Insurance Expiry': plus(-52), 'Next Service': plus(-13), 'Warranty Expiry (Powertrain)': plus(61),
              'Current Mileage': 38412, 'Last Oil Change Mileage': 33980, 'Oil Interval (mi)': 5000, 'Tires Last Replaced Mileage': 21300, 'Mileage Updated': plus(-41) });
  const r = run(c, 'renewalItems_(v, ' + J(TODAY) + ')');
  check('most urgent and soonest first; miles in the same list', J(r.coming.map(i => i.key)) === J(['insurance', 'service', 'oil', 'warranty_pt', 'registration', 'tires']), J(r.coming.map(i => i.key + ':' + i.status)));
  check('oil: about 568 mi left is Low ("~568 mi")', r.coming[2].status === 'low' && r.coming[2].chip === '~568 mi' && /every 5,000 mi/.test(r.coming[2].when));
  check('miles 41 days old: stale', r.milesAge === 41 && r.milesStale === true);
  c.v2 = veh({ 'Current Mileage': 100, 'Mileage Updated': plus(-3) });
  check('updated 3 days ago: fresh', run(c, 'renewalItems_(v2, ' + J(TODAY) + ')').milesStale === false);
  c.v3 = veh({ 'Current Mileage': 100 });
  check('miles with no date: stale', run(c, 'renewalItems_(v3, ' + J(TODAY) + ')').milesStale === true);
  c.v4 = veh({});
  check('no miles at all: nothing to nag about', run(c, 'renewalItems_(v4, ' + J(TODAY) + ')').milesStale === false);
  c.v5 = veh({ 'Current Mileage': 40000, 'Last Oil Change Mileage': 34500, 'Oil Interval (mi)': 5000 });
  check('oil overdue: High, "500 mi over"', run(c, 'renewalItems_(v5, ' + J(TODAY) + ')').coming[0].chip === '500 mi over');
}

console.log('\nThe flags');
{
  const c = ctx();
  c.vs = [veh({ 'Insurance Expiry': plus(-52), 'Registration Expiry': plus(13), 'Current Mileage': 1, 'Mileage Updated': plus(-41), 'Last Oil Change Mileage': 0 }),
          veh({ ID: 'veh_2', Nickname: '', Year: 2019, Make: 'Sample', Model: 'Sedan', 'Next Service': plus(40) })];
  const w = run(c, 'renewalWantedFlags_(vs, ' + J(TODAY) + ')');
  check('one per due item, keyed by vehicle, item and date', J(Object.keys(w.renewals).sort()) === J(['vehicle_renewal_veh_1_insurance_2026-09-22', 'vehicle_renewal_veh_1_registration_2026-11-26']), J(Object.keys(w.renewals)));
  check('…carrying the due date (for Away mode)', w.renewals['vehicle_renewal_veh_1_registration_2026-11-26'].due === '2026-11-26' && w.renewals['vehicle_renewal_veh_1_registration_2026-11-26'].urgency === 'Medium');
  check('oil and tires never flag; stale miles flag once a month', J(Object.keys(w.miles)) === J(['vehicle_miles_veh_1_2026-11']) && w.miles['vehicle_miles_veh_1_2026-11'].urgency === 'Low' && /41 days ago/.test(w.miles['vehicle_miles_veh_1_2026-11'].reason));
  check('a vehicle with no name uses year, make and model', run(c, 'renewalVehicleName_(vs[1])') === '2019 Sample Sedan');
  // the real upsert, two nights and a moved date
  const flagHdr = CODE.match(/^const FLAG_HEADERS\s*=.*;$/m)[0].replace(/^const /, 'var ');
  const due = CODE.slice(CODE.indexOf('function flagDueCell_('), CODE.indexOf('function writeFlags('));
  const rows = [['ID', 'Date', 'Source', 'Flag', 'Reason', 'Urgency', 'Acknowledged', 'Snoozed Until', 'Resolved', 'Key', 'Escalated', 'Due']];
  const sheet = { getLastRow: () => rows.length, getRange: (r, col, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(col - 1, col - 1 + (nc || 1))), getValue: () => rows[r - 1][col - 1], setValue: x => { rows[r - 1][col - 1] = x; } }), appendRow: x => rows.push(x.slice()) };
  const u = ctx({ Utilities: { formatDate: () => TODAY }, Session: { getScriptTimeZone: () => 'UTC' }, colorCodeFlags: () => {} });
  run(u, flagHdr + '\n' + due + '\n' + fnSrc(CODE, 'upsertKeyedFlags_'));
  u.sheet = sheet; u.w = w.renewals;
  run(u, 'upsertKeyedFlags_(sheet, "vehicle_renewal_", "Vehicles", w, ' + J(TODAY) + ')');
  run(u, 'upsertKeyedFlags_(sheet, "vehicle_renewal_", "Vehicles", w, ' + J(TODAY) + ')');
  check('two nights: no duplicate', rows.length === 3, rows.length);
  check('…the deadline in the Due column', rows.slice(1).every(r => /^\d{4}-\d{2}-\d{2}$/.test(r[11])));
  c.vs[0]['Insurance Expiry'] = '2027-09-22';
  u.w = run(c, 'renewalWantedFlags_(vs, ' + J(TODAY) + ')').renewals;
  run(u, 'upsertKeyedFlags_(sheet, "vehicle_renewal_", "Vehicles", w, ' + J(TODAY) + ')');
  const ins = rows.find(r => /insurance_2026-09-22$/.test(r[9]));
  check('renewed (the date moved): its flag resolves', ins && ins[8] === 'Yes' && rows.length === 3, J(rows.map(r => [r[9], r[8]])));
}

console.log('\nThe calendar reminder');
{
  const c = ctx();
  c.v = veh({ Nickname: 'Commuter, sedan', 'License Plate': '4K7-550', State: 'VA', 'Registration Expiry': plus(13) });
  c.it = run(c, 'renewalItems_(v, ' + J(TODAY) + ')').coming[0];
  const r = run(c, 'renewalIcs_(v, it, ' + J(TODAY) + ', "2026-11-13T10:00:00Z")');
  check('the title and the file name', r.title === 'Renew registration · Commuter, sedan' && r.filename === 'renew-registration-commuter-sedan.ics' && /SUMMARY:Renew registration · Commuter\\, sedan/.test(r.ics), r.filename);
  check('all day, a week before the deadline', /DTSTART;VALUE=DATE:20261119\r\nDTEND;VALUE=DATE:20261120/.test(r.ics) && r.day === '2026-11-19');
  check('an alert at 9 AM that day', /BEGIN:VALARM\r\nACTION:DISPLAY\r\n[^\r]*\r\nTRIGGER:PT9H\r\nEND:VALARM/.test(r.ics));
  check('the note: when, and the plate (long lines folded the iCalendar way)', /DESCRIPTION:Expires Thu\\, Nov 26\. Plate 4K7-550 \(VA\)\. From VERA's Vehicles tab\./.test(r.ics.replace(/\r\n /g, '')) && r.ics.split('\r\n').every(l => l.length <= 75));
  c.it2 = Object.assign({}, c.it, { date: plus(3) });
  check('three days left: the reminder is today, not in the past', run(c, 'renewalIcs_(v, it2, ' + J(TODAY) + ')').day === TODAY);
  c.it3 = { key: 'service', label: 'Service', kind: 'service', date: plus(20) };
  check('service reads "Book service"', /^Book service · /.test(run(c, 'renewalIcs_(v, it3, ' + J(TODAY) + ')').title));
}

console.log('\nThe writes (VERA\'s own sheet)');
{
  const H = eval(HEADERS);
  const mk = () => { const grid = [H.slice(0, 32), ['veh_1'].concat(Array(31).fill(''))]; let maxCols = 32, inserted = 0, locked = 0;
    const sheet = { getLastRow: () => grid.length, getMaxColumns: () => maxCols, insertColumnsAfter: (a, n) => { maxCols += n; inserted += n; grid.forEach(r => { while (r.length < maxCols) r.push(''); }); },
      getRange: (r, col, nr, nc) => ({ getValues: () => grid.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(col - 1, col - 1 + (nc || 1))), getValue: () => grid[r - 1][col - 1], setValue: x => { if (col > maxCols) throw new Error('out of range'); grid[r - 1][col - 1] = x; } }) };
    return { grid, sheet, get inserted() { return inserted; }, lockCount: () => locked, lock: fn => { locked++; return fn(); } }; };
  const S = mk();
  const c = ctx({ Utilities: { formatDate: () => TODAY }, Session: { getScriptTimeZone: () => 'UTC' }, getSpreadsheet: () => ({ getSheetByName: () => S.sheet }), TABS: { VEHICLES: 'Vehicles' },
    veraLocked_: S.lock, webGetVehicles_: () => ({ vehicles: [{ ID: 'veh_1' }] }) });
  run(c, fnSrc(WEB, '_vehicleSetFields_'));
  const ren = run(c, 'webVehicleRenew_({ id: "veh_1", item: "insurance", date: "2027-09-22" })');
  check('Renewed…: the new date in Insurance Expiry, under the lock', ren.ok && S.grid[1][H.indexOf('Insurance Expiry')] === '2027-09-22' && S.lockCount() === 1, J(ren));
  check('…an inspection too', run(c, 'webVehicleRenew_({ id: "veh_1", item: "emission", date: "2027-08-04" })').ok && S.grid[1][H.indexOf('Emission Inspection Expiry')] === '2027-08-04');
  check('refused: service (that’s Done…), an unknown item, a bad date, no id, an unknown vehicle',
        !run(c, 'webVehicleRenew_({ id: "veh_1", item: "service", date: "2027-01-01" })').ok && !run(c, 'webVehicleRenew_({ id: "veh_1", item: "paint", date: "2027-01-01" })').ok
        && !run(c, 'webVehicleRenew_({ id: "veh_1", item: "insurance", date: "next year" })').ok && !run(c, 'webVehicleRenew_({ item: "insurance", date: "2027-01-01" })').ok
        && run(c, 'webVehicleRenew_({ id: "veh_9", item: "insurance", date: "2027-01-01" })').error === 'No vehicle with that id');
  try { run(c, '_vehicleSetFields_(getSpreadsheet().getSheetByName(), "veh_1", { "Current Mileage": 40100 })'); } catch (e) { check('setting miles on an older tab doesn\u2019t fail', false, e.message); }
  check('new miles stamp Mileage Updated, adding that column (labelled) when the tab is older', S.grid[1][H.indexOf('Mileage Updated')] === TODAY && S.inserted === 1 && S.grid[0][H.indexOf('Mileage Updated')] === 'Mileage Updated', J(S.grid[0].slice(-2)));
  const svc = fnSrc(WEB, 'webVehicleService_');
  check('Done… for service: Last Service, and Next Service one interval on (6 months unless set)', /var fields = \{ 'Last Service': on, 'Next Service': renewalAddMonths_\(on, months\) \};/.test(svc) && /parseInt\(v\['Service Interval \(mo\)'\], 10\)\) \|\| 6/.test(svc) && /The service date can\\'t be in the future/.test(svc));
  check('the month step keeps to the month’s end', run(c, 'renewalAddMonths_("2026-08-31", 6)') === '2027-02-28' && run(c, 'renewalAddMonths_("2026-11-13", 6)') === '2027-05-13');
  check('the Vehicles tab gains Mileage Updated and Body Type at the end only', H[H.length - 2] === 'Mileage Updated' && H.indexOf('Notes') === H.length - 3);
  check('reading an older, narrower tab doesn’t fail', /var width = Math\.min\(hdrs\.length, sheet\.getMaxColumns \? sheet\.getMaxColumns\(\) : hdrs\.length\);/.test(fnSrc(WEB, 'webGetVehicles_')));
  check('each vehicle carries its Coming up list', /var r = renewalItems_\(v, todayIso\);\s*v\.comingUp = r\.coming;/.test(fnSrc(WEB, 'webGetVehicles_')));
}

console.log('\nThe icon');
{
  const c = ctx({ Utilities: { formatDate: () => TODAY }, Session: { getScriptTimeZone: () => 'UTC' } });
  const b = o => { c.v = o; return run(c, 'renewalBodyOf_(v)'); };
  check('Body Type wins when set', b({ 'Body Type': 'Van', Model: 'Example Sedan' }) === 'van');
  check('else a guess from the model: SUV, truck, van, coupe', b({ Model: 'RAV4' }) === 'suv' && b({ Model: 'Tacoma' }) === 'truck' && b({ Model: 'Sienna' }) === 'van' && b({ Model: 'Mustang' }) === 'coupe');
  check('…and a sedan when unsure, or for nonsense', b({ Model: 'Model 3' }) === 'sedan' && b({ 'Body Type': 'spaceship' }) === 'sedan');
  check('the server sends it with each vehicle', /v\.body = renewalBodyOf_\(v\);/.test(fnSrc(WEB, 'webGetVehicles_')));
  const H = eval(HEADERS);
  check('Body Type is the last column, after Mileage Updated', H[H.length - 1] === 'Body Type' && H[H.length - 2] === 'Mileage Updated');
  const set = []; c.veraLocked_ = fn => fn(); c.getSpreadsheet = () => ({ getSheetByName: () => 'sheet' }); c.TABS = { VEHICLES: 'Vehicles' };
  c._vehicleSetFields_ = (sh, id, f) => { set.push([id, f]); return id === 'veh_1'; };
  check('the icon choice is saved; a shape that isn’t offered is refused', run(c, 'webVehicleBody_({ id: "veh_1", body: "SUV" })').ok && JSON.stringify(set[0]) === JSON.stringify(['veh_1', { 'Body Type': 'suv' }])
        && !run(c, 'webVehicleBody_({ id: "veh_1", body: "rocket" })').ok && !run(c, 'webVehicleBody_({ id: "veh_9", body: "van" })').ok);
  check('…its route', /case 'vehicle_body':\s+return jsonOut_\(webVehicleBody_\(e\.parameter \|\| \{\}\)\);/.test(WEB));
}

console.log('\nWiring');
{
  check('the nightly run checks the vehicles', /nightlyStep_\(ctx, 'checkVehicleRenewals_', checkVehicleRenewals_\);/.test(CODE));
  check('its own notification row: send if due while away', /\{ key: 'vehicle_renewals',[^\n]*whileAway: 'due' \}/.test(CODE));
  check('…and switched off, it does nothing', /if \(typeof isNotifEnabled_ === 'function' && !isNotifEnabled_\('vehicle_renewals'\)\) return 'off';/.test(fnSrc(REN, 'checkVehicleRenewals_')));
  check('the routes', /case 'vehicle_renew':\s+return jsonOut_\(webVehicleRenew_\(e\.parameter \|\| \{\}\)\);/.test(WEB) && /case 'vehicle_renewal_ics':\s+return jsonOut_\(webVehicleRenewalIcs_\(e\.parameter \|\| \{\}\)\);/.test(WEB));
  const c = {}; vm.createContext(c); vm.runInContext(fnSrc(APP, 'flagRenewalOf_'), c);
  check('Flags: the reminder button only on renewal flags (ids with underscores read right)', J(c.flagRenewalOf_('vehicle_renewal_veh_17_warranty_pt_2027-01-13')) === J({ id: 'veh_17', item: 'warranty_pt', date: '2027-01-13' }) && c.flagRenewalOf_('bill_due_power') === null && c.flagRenewalOf_('vehicle_miles_veh_1_2026-11') === null);
  check('…next to the flag’s usual buttons', /flagRenewalOf_\(flag\.key\)&&h\("button",\{className:"btn btn-remind"/.test(APP) && /"✓ Acknowledge"\),/.test(APP));
  const block = s => { const a = s.indexOf('// ---- VehiclesView — SHARED VERBATIM'), b = s.indexOf('// ---- /VehiclesView ----'); return a === -1 || b === -1 ? '' : s.slice(a, b); };
  check('one card, the same in both dashboards', block(APP) && block(APP) === block(LITE));
  check('…both hand it the API and a reload', /React\.createElement\(VehiclesView,\{vehicles:vehicles,loading:vehiclesLoading,apiUrl:apiUrl,apiToken:apiToken,onChanged:function\(\)\{loadVehicles\(apiUrl,apiToken\);\}\}\)/.test(APP) && /<VehiclesView\s+vehicles=\{vehicles\}\s+loading=\{vehiclesLoading\}\s+apiUrl=\{apiUrl\}\s+apiToken=\{apiToken\}\s+onChanged=\{loadVehicles\}\s+\/>/.test(LITE));
  check('the card calls the real routes with their real fields', ["action:'vehicle_renew',id:id,item:o.key,date:vals.date", "action:'vehicle_service',id:id,date:vals.date", "action:'vehicle_oil_change',id:id,currentMileage:vals.miles", "action:'vehicle_tire_change',id:id,currentMileage:vals.miles", "action:'vehicle_mileage',id:id,mileage:vals.miles", "action:'add_vehicle'", "action:'delete_vehicle',id:id"].every(x => block(APP).includes(x)));
  check('lite’s old vehicle handlers (wrong route names) are gone', !/action: 'vehicle_add'|action: 'vehicle_delete'/.test(LITE));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
