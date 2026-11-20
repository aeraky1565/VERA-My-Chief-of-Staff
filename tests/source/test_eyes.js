// Health › Care › Eyes (Eyes.js): reading a prescription (powers, axis, the unsure ones), the expiry
// defaults, a new prescription becoming the current one with the old as history, the photo saved to
// Drive, the read route (Claude stubbed, image or PDF), contacts supply from orders and the reorder
// date, the nightly flags opening and closing, the usual items and orders, the eye exam from
// Appointments, chat's eye_rx, and the routes. Every name and figure is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const EY = read('Eyes.js'), DS = read('DriveSave.js'), WEB = read('WebApp.js'), CHAT = read('Chat.js'), CODE = read('Code.js'), TI = read('TripIdeas.js'), NR = read('NightlyRunner.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1); }
  throw new Error('unbalanced: ' + name);
}

const STORE = { Flags: [['Key']] }, FILES = [], FOLDERS = [], CLAUDE = [], FLAGS = [];
let CLAUDE_REPLY = '{}', CLAUDE_CODE = 200, OWNER = 'Owner', CONFIG_PEOPLE = '';
function fakeSheet(name) {
  const grid = STORE[name];
  return { getName: () => name, getLastRow: () => grid.length, getMaxRows: () => grid.length + 50,
    getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }),
    getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => ((grid[r - 1 + i] || [])[c - 1 + j]) ?? '')),
      setValues: v => { v.forEach((row, i) => row.forEach((x, j) => { while (grid.length < r + i) grid.push([]); grid[r - 1 + i][c - 1 + j] = x; })); },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setNumberFormat() { return this; } }),
    appendRow: row => { grid.push(row.slice()); }, deleteRow: r => { grid.splice(r - 1, 1); }, setFrozenRows() {} };
}
const ss = { getSheetByName: n => STORE[n] ? fakeSheet(n) : null, insertSheet: n => { STORE[n] = []; return fakeSheet(n); } };
const S = {
  getSpreadsheet: () => ss, TABS: { FLAGS: 'Flags' }, CLAUDE_API_URL: 'https://example.test/claude', CLAUDE_MODEL: 'm', getApiKey: () => 'k',
  fetchTracked_: (src, url, o) => { CLAUDE.push(JSON.parse(o.payload)); return { getResponseCode: () => CLAUDE_CODE, getContentText: () => J({ content: [{ text: CLAUDE_REPLY }] }) }; },
  Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: { getUuid: () => String(Math.random()).slice(2, 10) + '-' + String(Math.random()).slice(2, 10), formatDate: (d, tz, f) => '2026-11-20',
    base64Decode: s => Buffer.from(s, 'base64'), base64Encode: b => Buffer.from(b).toString('base64'), newBlob: (bytes, mime, name) => ({ bytes, mime, name, getName: () => name }) },
  // The Drive service with "files VERA creates" (DriveSave.js): folders found by name, else made.
  Drive: { Files: {
    list: o => ({ files: FOLDERS.filter(f => o.q.indexOf("name = '" + f.name + "'") !== -1).map(f => ({ id: f.id })) }),
    create: (meta, blob) => { if (!blob) { const f = { id: 'FOLDER' + (FOLDERS.length + 1), name: meta.name }; FOLDERS.push(f); return { id: f.id }; }
      FILES.push({ folder: (FOLDERS.find(f => f.id === meta.parents[0]) || {}).name, name: meta.name, mime: blob.mime }); return { id: 'FILE' + FILES.length }; } } },
  DriveApp: { getFileById: id => ({ getMimeType: () => 'image/jpeg', getBlob: () => ({ getBytes: () => [1, 2, 3] }), getUrl: () => 'https://drive.test/' + id }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, Logger: { log() {} },
  peopleOwnerName_: () => OWNER, getConfigValues: () => ({ eyes_people: CONFIG_PEOPLE }),
  getHouseholdInfoData_: () => ({ sections: [{ section: 'Insurance', subsections: [{ subsection: 'Vision – Pat' }, { subsection: 'Vision – Sam' }] }] }),
  cvPeople_: secs => secs[0].subsections.map(s => s.subsection.split(' – ')[1]),
  getHealthAppointments_: () => [{ person: 'Sam', type: 'Eye Exam', provider: 'Dr. Iris', lastVisit: '2025-12-01', nextDue: '2026-12-01', daysUntil: 11, scheduledNext: null },
    { person: 'Pat', type: 'Dental', provider: 'Dr. Chu', lastVisit: '2026-05-01', nextDue: '2026-11-01', daysUntil: -19 }],
  upsertKeyedFlags_: (sheet, prefix, source, wanted, day) => { FLAGS.push({ prefix, source, wanted: JSON.parse(J(wanted)), day }); },
};
vm.createContext(S);
vm.runInContext(extractFn(CODE, 'ensureSheet'), S);
['tiSchema_', 'tiRows_', 'tiRowOf_', 'tiMintId_', 'tiLocked_'].forEach(n => vm.runInContext(extractFn(TI, n), S));
vm.runInContext(EY, S); vm.runInContext(DS, S);
const run = (expr, vars) => { Object.assign(S, vars || {}); return vm.runInContext(expr, S); };

console.log('\nreading the numbers');
check('powers are written as the optician writes them', J(['-2.25', '+0.50', 'pl', '−1.75', '2'].map(x => run('eyPower_(X)', { X: x }))) === '["-2.25","+0.50","0.00","-1.75","+2.00"]');
let c = run('eyRxClean_("glasses", R, [])', { R: { odSph: '-2.25', odCyl: '-0.50', odAxis: '180', osSph: '−2.00', osCyl: '-0.75', osAxis: '170', pd: '63' } });
check('a clean glasses prescription has nothing to check', J(c.unsure) === '[]' && c.values.osSph === '-2.00' && c.values.odAxis === '180' && c.values.pd === '63', J(c));
c = run('eyRxClean_("glasses", R, ["osAxis"])', { R: { odSph: '-2.30', odCyl: '-0.50', odAxis: '', osSph: '-2', osAxis: '190', osCyl: '-0.75', odAdd: '-1', pd: '30' } });
check('off-step powers, an axis over 180, a negative ADD, a strange PD and what the reader marked are all to check', ['odSph', 'osAxis', 'odAdd', 'pd', 'odAxis'].every(f => c.unsure.includes(f)) && c.values.odSph === '-2.30', J(c.unsure));
c = run('eyRxClean_("contacts", R, [])', { R: { odSph: '-4.50', osSph: '-4.75', bc: '8.5', dia: '14.1' } });
check('an axis over 180 is marked on its own', run('eyRxClean_("glasses", {odSph:"-1.00", odCyl:"-0.50", odAxis:"190"}, []).unsure.join()') === 'odAxis');
check('contacts: BC and DIA in range; no PD field', J(c.unsure) === '[]' && c.values.bc === '8.5' && !('pd' in c.values), J(c));
check('a BC or DIA out of range is to check', run('eyRxClean_("contacts", {odSph:"-1.00", bc:"12", dia:"20"}, []).unsure.join()') === 'bc,dia');
check('expiry: typed wins; else glasses 2 years and contacts 1 year from the exam', run('eyExpiry_("glasses","2026-03-10","")') === '2028-03-10' && run('eyExpiry_("contacts","2026-03-10","")') === '2027-03-10' && run('eyExpiry_("glasses","2026-03-10","2027-01-01")') === '2027-01-01' && run('eyExpiry_("glasses","","")') === '');
check('what changed from the last one', J(run('eyDiff_("glasses", A, B)', { A: { odSph: '-2.25', osSph: '-2.00' }, B: { odSph: '-2.50', osSph: '-2.00' } })) === '[{"field":"odSph","from":"-2.25","to":"-2.50"}]');
check('copy text for an online order', run('eyCopyText_(R)', { R: { kind: 'glasses', odSph: '-2.25', odCyl: '-0.50', odAxis: '180', osSph: '-2.00', pd: '63', expires: '2027-03-12' } }) === 'OD -2.25 -0.50 x180 · OS -2.00 · PD 63 · expires 2027-03-12');

console.log('\nwho');
check('before anything is saved, the people are the household’s, from the cheat sheet', J(run('webGetEyes_().people')) === '["Pat","Sam"]', J(run('webGetEyes_().people')));
console.log('\nreading a photo');
CLAUDE_REPLY = 'Here it is: ' + J({ odSph: '-2.50', odCyl: '-0.50', odAxis: '180', osSph: '-2.25', osCyl: '-0.75', osAxis: '170', pd: '63', exam: '2026-03-10', doctor: 'Dr. Lee, Bright Eye', unsure: ['osAxis'] });
let r = run('webEyeRead_(B)', { B: { kind: 'glasses', imageBase64: 'aGVsbG8=', mime: 'image/jpeg' } });
check('VERA reads the photo: numbers, the exam, the doctor, and what it wasn’t sure of', r.ok && r.values.odSph === '-2.50' && J(r.unsure) === '["osAxis"]' && r.exam === '2026-03-10' && /Dr\. Lee/.test(r.doctor), J(r));
check('…it sends the photo as an image, and nothing is saved', CLAUDE[CLAUDE.length - 1].messages[0].content[0].type === 'image' && (STORE['Eye Rx'] || []).length <= 1);
run('webEyeRead_(B)', { B: { kind: 'contacts', imageBase64: 'aGVsbG8=', mime: 'application/pdf' } });
check('a PDF goes as a document, and contacts ask for BC and DIA', CLAUDE[CLAUDE.length - 1].messages[0].content[0].type === 'document' && /"bc","dia"/.test(CLAUDE[CLAUDE.length - 1].messages[0].content[1].text));
check('not a photo, too big, or no file is refused', /isn’t a photo/.test(run('webEyeRead_(B).error', { B: { imageBase64: 'aGk=', mime: 'text/plain' } })) && /over 10 MB/.test(run('webEyeRead_(B).error', { B: { imageBase64: 'a'.repeat(14000001), mime: 'image/png' } })) && /No photo/.test(run('webEyeRead_({}).error')));
CLAUDE_CODE = 529; check('the reader being down says so, and you can type instead', /type the numbers/.test(run('webEyeRead_(B).error', { B: { imageBase64: 'aGk=', mime: 'image/png' } }))); CLAUDE_CODE = 200;
CLAUDE_REPLY = 'sorry'; check('nothing readable says so', /couldn’t make out a prescription/.test(run('webEyeRead_(B).error', { B: { imageBase64: 'aGk=', mime: 'image/png' } })));

console.log('\nsaving');
r = run('webEyeSave_(B)', { B: { person: 'Pat', kind: 'glasses', values: { odSph: '-2.25', osSph: '-2.00', pd: '63' }, exam: '2025-03-12', doctor: 'Dr. Lee', imageBase64: 'aGVsbG8=', mime: 'image/jpeg' } });
check('saving keeps the photo in VERA’s own sheet (a hidden Eye Photos tab) and the row in Eye Rx, with the expiry worked out', r.ok && /^EP-/.test(STORE['Eye Rx'][1][19]) && STORE['Eye Photos'].length === 2 && STORE['Eye Photos'][1][1] === 'image/jpeg' && FILES.length === 0 && r.expires === '2027-03-12' && STORE['Eye Rx'].length === 2, J(r));
const big = 'A'.repeat(45000) + 'B'.repeat(45000) + 'C'.repeat(10001); run('webEyeSave_(B)', { B: { person: 'Sam', kind: 'glasses', values: { odSph: '-1.00' }, exam: '2026-01-01', imageBase64: big, mime: 'image/png' } });
const bigId = STORE['Eye Rx'][STORE['Eye Rx'].length - 1][19];
check('a bigger photo is split into 45,000-character parts and comes back whole', STORE['Eye Photos'].filter(r => r[0] === bigId).length === 3 && run('eyPhotoRead_(I)', { I: bigId }).b64 === big);
check('a PDF over 2 MB is refused (take a photo instead)', /over 2 MB/.test(run('webEyeSave_(B).error', { B: { person: 'Sam', kind: 'glasses', values: { odSph: '-1.00' }, imageBase64: 'A'.repeat(2800001), mime: 'application/pdf' } })));
check('Eyes keeps photos in the sheet: no Drive folder or Drive file is made', !/DriveApp\.(createFolder|getFoldersByName)|veraDriveSave_\(/.test(EY) && FOLDERS.length === 0);
check('marked numbers aren’t saved until you’ve checked them', /Check the marked/.test(run('webEyeSave_(B).error', { B: { person: 'Pat', kind: 'glasses', values: { odSph: '-2.30' } } })) && run('webEyeSave_(B).ok', { B: { person: 'Sam', kind: 'contacts', values: { odSph: '-4.50', osSph: '-4.75', bc: '8.5', dia: '14.1' }, exam: '2026-01-05', lens: 'Dailies', confirmed: true } }) === true);
check('no numbers, no person, a formula-like name are refused', /at least the sphere/.test(run('webEyeSave_(B).error', { B: { person: 'Pat', kind: 'glasses', values: {} } })) && /Whose/.test(run('webEyeSave_({}).error')) && /can’t start with =/.test(run('webEyeSave_(B).error', { B: { person: '=X', values: { odSph: '-1' } } })));
run('webEyeSave_(B)', { B: { person: 'Pat', kind: 'glasses', values: { odSph: '-2.50', osSph: '-2.25', pd: '63' }, exam: '2026-03-10', doctor: 'Dr. Lee' } });
let d = run('webGetEyes_()');
const patG = d.current.filter(x => x.person === 'Pat' && x.kind === 'glasses');
check('the newest exam is the current one; the older one is history, with its photo', patG.length === 1 && patG[0].odSph === '-2.50' && d.history.length === 1 && d.history[0].odSph === '-2.25' && /^EP-/.test(d.history[0].photo), J(d.history));
check('each current one carries the copy text', /^OD -2.50 · OS -2.25 · PD 63/.test(patG[0].copy), patG[0].copy);
check('the people come from the household cheat sheet; the “Owner” placeholder is never one', J(d.people) === '["Pat","Sam"]', J(d.people));
OWNER = 'Pat'; CONFIG_PEOPLE = 'Kim';
check('…the owner’s real name and Config eyes_people join without repeats', J(run('webGetEyes_().people')) === '["Pat","Sam","Kim"]', J(run('webGetEyes_().people')));
OWNER = 'Owner'; CONFIG_PEOPLE = '';
check('the eye exam comes from Appointments (not the dentist)', J(d.exams.map(x => x.person + ':' + x.type)) === '["Sam:Eye Exam"]');
check('the photo opens as a data URL, rebuilt from the sheet', run('webEyePhoto_(E).dataUrl', { E: { parameter: { id: d.history[0].id } } }) === 'data:image/jpeg;base64,aGVsbG8=');

console.log('\nwhat you buy, orders and the supply');
check('a usual item: needs whose and what; days per pack is a number; a link is https', run('webEyeUsualSave_(B).ok', { B: { person: 'Sam', what: 'Contacts', brand: 'Dailies Total1', pack: '90', daysPerPack: '90', store: 'Costco', link: 'https://shop.test/x' } }) === true
  && /Days per pack/.test(run('webEyeUsualSave_(B).error', { B: { person: 'Sam', what: 'Contacts', daysPerPack: 'lots' } })) && /https/.test(run('webEyeUsualSave_(B).error', { B: { person: 'Sam', what: 'Contacts', link: 'shop.test' } })));
check('an order: date and boxes per eye checked', run('webEyeOrderLog_(B).ok', { B: { person: 'Sam', date: '2026-09-01', what: 'Contacts', boxes: '1', store: 'Costco', cost: '70' } }) === true
  && /Pick the order date/.test(run('webEyeOrderLog_(B).error', { B: { person: 'Sam', date: 'soon' } })) && /Boxes per eye/.test(run('webEyeOrderLog_(B).error', { B: { person: 'Sam', boxes: 'x' } })));
d = run('webGetEyes_()');
check('the supply: 1 box × 90 days from Sep 1 lasts to Nov 30; 10 days left; reorder by Nov 16', J(d.supply.Sam) === J({ lastOrder: '2026-09-01', boxes: 1, lastsTo: '2026-11-30', daysLeft: 10, reorderBy: '2026-11-16', store: 'Costco', link: 'https://shop.test/x' }), J(d.supply.Sam));
check('no order or no days per pack → no supply', d.supply.Pat === null);
check('the newest order counts, not an older one', run('eySupply_("Sam", O, U, "2026-11-20").lastOrder', { O: [{ person: 'Sam', what: 'Contacts', date: '2026-06-01', boxes: '1' }, { person: 'Sam', what: 'Contacts', date: '2026-10-01', boxes: '2' }], U: [{ person: 'Sam', what: 'Contacts', daysPerPack: '90' }] }) === '2026-10-01');

console.log('\nthe nightly flags');
run('checkEyes_()');
let w = FLAGS[FLAGS.length - 1];
check('contacts running out in 10 days raise a flag; it’s keyed per person', w.prefix === 'EYES|' && w.source === 'Eyes' && /Sam’s contacts run out in 10 days/.test((w.wanted['EYES|supply|Sam'] || {}).flag) && (w.wanted['EYES|supply|Sam'] || {}).urgency === 'Medium', J(w.wanted));
check('a prescription far from expiry raises nothing', !Object.keys(w.wanted).some(k => /exp/.test(k)));
const soon = run('eyFlags_(R, {}, "2026-11-20")', { R: [{ id: 'X', person: 'Pat', kind: 'contacts', expires: '2026-12-20', doctor: 'Dr. Lee' }, { id: 'Y', person: 'Sam', kind: 'glasses', expires: '2026-11-10' }] });
check('45 days before expiry: a flag; past it: High', /Pat’s contacts prescription expires in 30 days/.test(soon['EYES|exp|X'].flag) && soon['EYES|exp|Y'].urgency === 'High' && /expired 10 days ago/.test(soon['EYES|exp|Y'].flag), J(soon));
check('all fine → nothing wanted, so the old flags close', J(run('eyFlags_([], {Sam:{daysLeft:60}}, "2026-11-20")')) === '{}');
check('checkEyes_ runs nightly, next to the refills', /S\('checkRefills_', 1, function\(\) \{ checkRefills_\(\); \}\),\s*S\('checkEyes_', 1, function\(\) \{ checkEyes_\(\); \}\),/.test(NR));

console.log('\nremoving, chat, routes');
const oid = run('webGetEyes_().orders[0].id');
check('an order, a usual item and a prescription can be removed', run('webEyeOrderDelete_(B).ok', { B: { id: oid } }) === true && /already gone/.test(run('webEyeOrderDelete_(B).error', { B: { id: oid } })) && run('webEyeDelete_(B).ok', { B: { id: d.history[0].id } }) === true);
check('chat: the current prescriptions as text', /Pat · glasses \(exam 2026-03-10\): OD -2\.50 · OS -2\.25 · PD 63/.test(run('eyChatText_("Pat")')) && /No eye prescriptions saved for Kim/.test(run('eyChatText_("Kim")')));
check('chat has eye_rx and feeds the answer back', /ACTION:eye_rx\|\{person or blank\}/.test(CHAT) && /else if \(type === 'eye_rx'\) \{\s*executed\.push\('EYE_RX:' \+ eyChatText_/.test(CHAT) && /x\.indexOf\('EYE_RX:'\) === 0/.test(CHAT));
check('routes: GET eyes and eye_photo; POST read, save, delete, usual, orders (both of you may)', /case 'eyes':\s+return jsonOut_\(webGetEyes_\(\)\);/.test(WEB) && /case 'eye_photo':\s+return jsonOut_\(webEyePhoto_\(e\)\);/.test(WEB)
  && ['eye_read', 'eye_save', 'eye_delete', 'eye_usual_save', 'eye_usual_delete', 'eye_order_log', 'eye_order_delete'].every(a => new RegExp("case '" + a + "':\\s+return jsonOut_\\(webEye\\w+_\\(body\\)\\);").test(WEB)));
check('no real names in Eyes.js', !/Ahmed|Victoria/.test(EY));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
