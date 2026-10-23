// Shared fixtures for the Career tab tests (test_career.js, test_career_agent.js):
// a fake spreadsheet with just what Career.js and ensureSheet use, invented v1
// tabs, and a vm sandbox that loads the real Career.js. Not a test itself (the
// runner only runs test_*.js), so it has no checks of its own.
const vm = require('vm');

module.exports = function(read) {
  const CAR = read('Career.js'), CODE = read('Code.js');
  function extractFn(src, name) {
    const at = src.indexOf('function ' + name + '(');
    if (at === -1) throw new Error('not found: ' + name);
    let depth = 0;
    for (let i = src.indexOf('{', at); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) return src.slice(at, i + 1); }
    }
    throw new Error('unterminated: ' + name);
  }

  // ---- A fake spreadsheet: just what Career.js and ensureSheet use ---------------
  class FakeSheet {
    constructor(name, rows) { this.name = name; this.rows = rows || []; this.hidden = false; }
    getName() { return this.name; }
    getLastRow() { return this.rows.length; }
    getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
    getDataRange() { return this.getRange(1, 1, this.rows.length, this.getLastColumn()); }
    getRange(r, c, nr, nc) {
      const sh = this; nr = nr || 1; nc = nc || 1;
      const api = {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
        setValues: (vals) => { vals.forEach((v, i) => { const ri = r - 1 + i; while (sh.rows.length <= ri) sh.rows.push([]); v.forEach((x, j) => { sh.rows[ri][c - 1 + j] = x; }); }); return api; },
        setValue: (v) => { while (sh.rows.length < r) sh.rows.push([]); sh.rows[r - 1][c - 1] = v; return api; },
        setFontWeight: () => api, setBackground: () => api, setFontColor: () => api,
      };
      return api;
    }
    appendRow(row) { this.rows.push(row.slice()); }
    deleteRow(r) { this.rows.splice(r - 1, 1); }
    setFrozenRows() {}
    hideSheet() { this.hidden = true; }
    isSheetHidden() { return this.hidden; }
  }
  class FakeSS {
    constructor(tabs) { this.sheets = {}; this.deleted = []; Object.keys(tabs || {}).forEach(k => { this.sheets[k] = new FakeSheet(k, tabs[k]); }); }
    getSheetByName(n) { return this.sheets[n] || null; }
    insertSheet(n) { this.sheets[n] = new FakeSheet(n, []); return this.sheets[n]; }
    deleteSheet(sh) { this.deleted.push(sh.name); delete this.sheets[sh.name]; }
  }

  const TABS_SRC = CODE.slice(CODE.indexOf('const TABS = {'), CODE.indexOf('};', CODE.indexOf('const TABS = {')) + 2).replace('const TABS', 'var TABS');

  // v1 tabs, invented content.
  function v1Tabs() {
    return {
      'Career Position': [['Title','Company','Department','Start Date','Work Style','Job Level','Base Salary','Bonus Pct','Equity','Benefits','Focus Areas','Notes'],
                          ['Senior Manager, Planning','Exampleco','Ops','2025','Hybrid','M6',150000,12,'RSU','Health','Forecasting','']],
      'Career Goals':    [['ID','Title','Horizon','Category','Status','Target Date','Notes'],
                          ['CG-1','Lead a planning function','3yr','Leadership','Active','',''],
                          ['CG-2','Old goal','1yr','','Achieved','','']],
      'Career Progression': [['ID','Title','Company','Start Year','End Year','Type','Highlights','Notes'],
                          ['CPR-1','Engineer','Firstco','2010','2015','New Role','',''],
                          ['CPR-2','Planning Manager','Secondco','2015','2022','New Role','',''],
                          ['CPR-3','Senior Manager, Planning','Exampleco','2025','','Promotion','','']],
      'Career Development': [['ID','Item','Type','Status','Target Date','Notes'], ['CD-1','Public speaking','Skill','Planned','','']],
      'Career Wins':     [['ID','Date','Win','Impact','Category','Notes'], ['CW-1', new Date(2024, 4, 3), 'Shipped the forecast model','Cut close by 2 days','Project','']],
      'Career Network':  [['ID','Name','Role','Company','Relationship','Last Contact','Notes'], ['CN-1','Pat Example','VP','Exampleco','Mentor','2026-01-02','']],
      'Config':          [['Key','Value']],
    };
  }

  function sandbox(over) {
    const props = {};
    const logs = [];
    const S = Object.assign({
      Date, Math, JSON, logs,
      Logger: { log: m => logs.push(String(m)) },
      Session: { getScriptTimeZone: () => 'America/New_York' },
      Utilities: { formatDate: (d, tz, f) => {
        const p = n => String(n).padStart(2, '0');
        if (f === 'yyyy-MM') return d.getFullYear() + '-' + p(d.getMonth() + 1);
        if (f === 'yyyy-MM-dd') return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        throw new Error('unknown format ' + f);
      } },
      PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
      getConfigValues: () => ({}),
      callClaudeJson_: () => null,
      props,
    }, over || {});
    S.ss = S.ss || new FakeSS(v1Tabs());
    S.getSpreadsheet = () => S.ss;
    vm.createContext(S);
    vm.runInContext(TABS_SRC + '\n' + extractFn(CODE, 'ensureSheet') + '\n' + CAR, S);
    return S;
  }

  return { extractFn, FakeSheet, FakeSS, v1Tabs, sandbox, run: (S, code) => vm.runInContext(code, S) };
};
