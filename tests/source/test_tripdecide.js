// Confirming an undecided agenda option (issue #232). The full dashboard's itinerary panel called
// App's handleDecideTripOption, which only exists inside App: "ReferenceError: handleDecideTripOption
// is not defined". It now gets the handlers as props. Also: the confirm read the trip without its
// dates, so the calendar's holds never joined and the decision could not be found; the server now
// works out the range. Plus a general check: no handler that lives only inside App is called from
// a component outside it.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const IDX = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const CHAT = fs.readFileSync(path.join(ROOT, 'Chat.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const fnSrc = (src, name) => { const i = src.indexOf('function ' + name + '('); if (i === -1) return ''; let d = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1); } return ''; };

console.log('\nthe crash');
{
  check('the itinerary panel no longer calls App’s handlers directly', !/\{handleDecideTripOption\(tripKey,opt\);\}/.test(APP) && !/\{handleReopenTripDecision\(tripKey,rep\);\}/.test(APP));
  check('it takes them as props and uses them', /function TravelItineraryPanel\(\{[^}]*onDecideTripOption,onReopenTripDecision[^}]*\}\)/.test(APP)
    && /onDecideOption:function\(opt\)\{if\(onDecideTripOption\)onDecideTripOption\(tripKey,opt\);\}/.test(APP) && /onReopenDecision:function\(rep\)\{if\(onReopenTripDecision\)onReopenTripDecision\(tripKey,rep\);\}/.test(APP));
  check('the Travel tab passes them down, and App hands over its handlers', /function TravelTab\(\{[^}]*onDecideTripOption,onReopenTripDecision[^}]*\}\)/.test(APP)
    && /React\.createElement\(TravelItineraryPanel,\{[^}]*onDecideTripOption:onDecideTripOption,onReopenTripDecision:onReopenTripDecision/.test(APP)
    && /onDecideTripOption:handleDecideTripOption,onReopenTripDecision:handleReopenTripDecision/.test(APP));
  check('the page that is served carries the fix', IDX.indexOf('onDecideTripOption:handleDecideTripOption') !== -1);
}

console.log('\nno App-only handler is called from outside App');
{
  const a = APP.indexOf('\nfunction App('), b = APP.indexOf("ReactDOM.createRoot(document.getElementById('root')).render(", a);
  const app = APP.slice(a, b);
  const inner = [...new Set([...app.matchAll(/(?:async )?function (handle[A-Z]\w*)\(/g)].map(m => m[1]))];
  const top = new Set([...(APP.slice(0, a) + APP.slice(b)).matchAll(/^(?:async )?function (\w+)\(/gm)].map(m => m[1]));   // outside App only
  // Each top-level component outside App, as a chunk; a name it uses must be defined in that chunk.
  const outside = APP.slice(0, a);
  const starts = [...outside.matchAll(/^(?:async )?function \w+\(/gm)].map(m => m.index).concat([outside.length]);
  const bad = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const chunk = outside.slice(starts[i], starts[i + 1]), name = (chunk.match(/function (\w+)\(/) || [])[1];
    inner.forEach(n => {
      if (top.has(n) || !new RegExp('\\b' + n + '\\(').test(chunk)) return;
      if (new RegExp('function ' + n + '\\(|(?:const|let|var) ' + n + '\\b').test(chunk)) return;
      bad.push(n + ' in ' + name);
    });
  }
  check('found App’s handlers to check', inner.length > 50 && inner.indexOf('handleDecideTripOption') !== -1);
  check('none is called from a component that doesn’t define it', bad.length === 0, J(bad));
}

console.log('\nthe range the confirm reads');
try {
  const src = fnSrc(WEB, 'tdDecideRange_');
  const ctx = o => { const c = { String, Logger: { log: () => {} },
    tripIdForKey_: k => (o.trips || {})[k] ? 'TRIP-1' : '', readTripRegistry_: () => ({ byId: { 'TRIP-1': Object.values(o.trips || {})[0] } }) };
    vm.createContext(c); vm.runInContext(src, c); return c; };
  const c = ctx({ trips: { '2027-04-03|Lisbon': { startDate: '2027-04-03', endDate: '2027-04-10' } } });
  check('the caller’s dates when it sent both', J(c.tdDecideRange_('2027-04-03|Lisbon', '2027-04-06|10:00', { startDate: '2027-04-01', endDate: '2027-04-12' })) === J({ start: '2027-04-01', end: '2027-04-12' }));
  check('else the trip’s own dates, from the Trips tab', J(c.tdDecideRange_('2027-04-03|Lisbon', '2027-04-06|10:00', {})) === J({ start: '2027-04-03', end: '2027-04-10' }));
  check('else from the trip key’s date to the slot’s day', J(ctx({}).tdDecideRange_('2027-04-03|Lisbon', '2027-04-06|10:00', {})) === J({ start: '2027-04-03', end: '2027-04-06' }));
  check('one date sent is not enough: the Trips tab is used', J(c.tdDecideRange_('2027-04-03|Lisbon', '2027-04-06|10:00', { startDate: '2027-04-01' })) === J({ start: '2027-04-03', end: '2027-04-10' }));

  const decide = fnSrc(WEB, 'webDecideTripOption_');
  const reads = [], wrote = [];
  const d = { String, JSON, Error, Logger: { log: () => {} }, Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: () => '2027-03-01' },
    tdDecideRange_: c.tdDecideRange_,
    webGetItinerary_: e => { reads.push(e.parameter); const withCal = !!(e.parameter.startDate && e.parameter.endDate);
      return { items: [{ id: 'S1', date: '2027-04-06', metadata: JSON.stringify({ optionGroup: '2027-04-06|10:00' }) }].concat(withCal ? [{ id: 'cal_9', date: '2027-04-06', metadata: JSON.stringify({ optionGroup: '2027-04-06|10:00' }) }] : []) }; },
    weatherVerdictFor_: () => null, tdForecastDayFor_: () => null, tdForecastForItems_: () => null,
    tdWriteDecision_: (k, g, date, st, id) => { wrote.push([k, g, date, st, id]); return { ok: true }; } };
  vm.createContext(d); vm.runInContext(decide, d);
  const r = d.webDecideTripOption_({ parameter: { tripKey: '2027-04-03|Lisbon', groupKey: '2027-04-06|10:00', itemId: 'cal_9' } });
  check('a confirm with no dates still reads the trip with its range, so a calendar hold can be chosen', r.ok && reads[0].startDate === '2027-04-03' && reads[0].endDate === '2027-04-10' && J(wrote[0]) === J(['2027-04-03|Lisbon', '2027-04-06|10:00', '2027-04-06', 'Decided', 'cal_9']), J(reads));
} catch (e) { check('the confirm’s range works', false, e.message); }

console.log('\nthe callers send the dates');
{
  check('the full dashboard sends the trip’s dates', /action:'decide_trip_option',tripKey:tripKey,groupKey:g,itemId:option\.id,startDate:\(meta&&meta\.startDate\)\|\|'',endDate:\(meta&&meta\.endDate\)\|\|''\}/.test(APP));
  check('lite does too', /action:'decide_trip_option', tripKey, groupKey: g, itemId: option\.id, startDate: trip\.startDate \|\| '', endDate: trip\.endDate \|\| '' \}/.test(LITE));
  check('so does Chat’s “confirm the beach one”', /var dtRange = tdDecideRange_\(dtTrip, dtGroup, \{\}\);/.test(CHAT) && /startDate: dtRange\.start, endDate: dtRange\.end \} \}, \{ skipEventTz: true \}\)/.test(CHAT));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
