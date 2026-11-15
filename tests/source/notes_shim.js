// Loads VERA's running-notes store (Settings.js: veraNoteGet_/Set_/Del_, veraNotes_,
// veraNoteKeys_ and the VERA State tab helpers under them) into a test's vm context.
//
// A test that fakes PropertiesService and has no VERA State tab gets the real fallback:
// the tab can't be reached, so notes read and write the fake Script Properties, exactly
// as they did before the move. A test that defines getSpreadsheet with a VERA State tab
// gets the tab. Only these functions are loaded, so a test's own stubs of other
// Settings.js functions (veraSetting_, getConfigValues …) are left alone.
const fs = require('fs'), path = require('path'), vm = require('vm');

const NAMES = ['veraStoreSheet_', 'veraStoreRows_', 'veraStoreGet_', 'veraStoreSet_', 'veraStoreDel_', 'veraLocked_',
  'veraIsNote_', 'veraNoteGet_', 'veraNoteSet_', 'veraNoteDel_', 'veraNotes_', 'veraNoteKeys_'];
const VARS = ['VERA_STORE_HEADERS_', 'VERA_STORE_MAX_', '_veraStoreCache_', '_veraStoreFree_', '_veraLockDepth_',
  'VERA_NOTE_NAMES_', 'VERA_NOTE_FAMILIES_', 'VERA_KEEP_PROPS_'];

function fnSrc(src, name) {
  const a = src.indexOf('function ' + name + '(');
  if (a === -1) throw new Error('notes_shim: ' + name + ' not found in Settings.js');
  let d = 0, j = src.indexOf('{', src.indexOf(')', a));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
  return src.slice(a, j + 1);
}
function varSrc(src, name) {
  const m = new RegExp('^var ' + name + '\\s*=[\\s\\S]*?;\\s*(//.*)?$', 'm').exec(src);
  if (!m) throw new Error('notes_shim: var ' + name + ' not found in Settings.js');
  return m[0];
}

/** Adds the store to ctx (an object already passed to vm.createContext). Returns ctx. */
function loadNotes(ctx) {
  // A control's copy (VERA_ROOT) may hold only the files it mutates: then the repo's.
  const repo = path.join(__dirname, '..', '..'), root = process.env.VERA_ROOT || repo;
  const at = fs.existsSync(path.join(root, 'Settings.js')) ? root : repo;
  const src = fs.readFileSync(path.join(at, 'Settings.js'), 'utf8');
  if (!ctx.TABS) ctx.TABS = {};
  if (!ctx.TABS.VERA_STATE) ctx.TABS.VERA_STATE = 'VERA State';
  if (!ctx.Logger) ctx.Logger = { log: () => {} };
  vm.runInContext(VARS.map(n => varSrc(src, n)).concat(NAMES.map(n => fnSrc(src, n))).join('\n'), ctx);
  return ctx;
}

/**
 * From now on, every vm.createContext in this test also gets the store: one line at the
 * top of a test whose harness builds several contexts.
 */
function installNotes(vmModule) {
  const create = vmModule.createContext;
  if (create.__notes) return;
  const wrapped = function(o) { const ctx = create.apply(vmModule, arguments); try { loadNotes(ctx); } catch (e) {} return ctx; };
  wrapped.__notes = true;
  vmModule.createContext = wrapped;
}

module.exports = { loadNotes, installNotes };
