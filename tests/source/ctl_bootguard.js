// Controls for test_bootguard_ui.js: undo each piece of the fix in a copy of
// the dashboards and confirm the test FAILS. A control that still passes means
// the test doesn't guard that piece.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const TEST = path.join(__dirname, 'test_bootguard_ui.js');

const APP = fs.readFileSync(path.join(REPO, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(REPO, 'docs/dashboard-lite.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(REPO, 'docs/index.html'), 'utf8');
const sub = (s, a, b) => { if (!s.includes(a)) throw new Error('anchor missing: ' + a.slice(0, 60)); return s.split(a).join(b); };

const controls = [
  ['full: no app-level boundary', {BG_SOURCE_ONLY:'1'}, f => { f.app = sub(f.app, "React.createElement(VeraBoundary,{where:'app'},/*#__PURE__*/React.createElement(App,null))", '/*#__PURE__*/React.createElement(App,null)'); }],
  ['full: no tab boundary', {BG_PAGES:'full',BG_WIDTHS:'390',BG_GUARD:'0'}, f => { f.app = sub(f.app, "React.createElement(VeraBoundary,{key:activeTab,where:'section'},", "React.createElement(React.Fragment,{key:activeTab},"); }],
  ['lite: no tab boundary', {BG_PAGES:'lite',BG_WIDTHS:'390',BG_GUARD:'0'}, f => { f.lite = sub(sub(f.lite, '<VeraBoundary key={activeTab} where="section">', '<>'), '        </VeraBoundary>\n      </div>', '        </>\n      </div>'); }],
  ['lite: no app-level boundary', {BG_SOURCE_ONLY:'1'}, f => { f.lite = sub(f.lite, '<VeraBoundary where="app"><App /></VeraBoundary>', '<App />'); }],
  ['boundary block differs between the two', {BG_SOURCE_ONLY:'1'}, f => { f.lite = sub(f.lite, "'This section hit an error'", "'This section hit a problem'"); }],
  ['boundary shows no message', {BG_PAGES:'full',BG_WIDTHS:'390',BG_GUARD:'0'}, f => { const a = "h('span',{className:'vb-msg',style:{fontSize:14,lineHeight:1.5,overflowWrap:'anywhere'}},st.err&&st.err.message?st.err.message:String(st.err)),"; f.app = sub(f.app, a, ''); f.lite = sub(f.lite, a, ''); }],
  ['no Try again button', {BG_PAGES:'lite',BG_WIDTHS:'390',BG_GUARD:'0'}, f => { const a = "app?null:h('button',{type:'button',className:'vb-retry'"; f.app = sub(f.app, a, "null&&h('button',{type:'button',className:'vb-retry'"); f.lite = sub(f.lite, a, "null&&h('button',{type:'button',className:'vb-retry'"); }],
  ['lite: no head guard', {BG_SOURCE_ONLY:'1'}, f => { f.lite = f.lite.replace(/  <script>\/\* VERA boot guard[\s\S]*?<\/script>\n/, ''); }],
  ['guard ignores script load failures', {BG_PAGES:'none',BG_WIDTHS:'390'}, f => { const a = "add(s?'Couldn’t load '+s:"; f.lite = sub(f.lite, a, "add(s?'':"); f.index = sub(f.index, a, "add(s?'':"); }],
  ['guard never shows the still-loading note', {BG_PAGES:'none',BG_WIDTHS:'390'}, f => { const a = "'VERA is still loading…'"; f.lite = sub(f.lite, a, "''"); f.index = sub(f.index, a, "''"); }],
  ['lite: Babel unpinned again', {BG_SOURCE_ONLY:'1'}, f => { f.lite = sub(f.lite, '@babel/standalone@8.0.5/babel.min.js', '@babel/standalone/babel.min.js'); }],
  ['lite: React unpinned again', {BG_SOURCE_ONLY:'1'}, f => { f.lite = sub(f.lite, 'react@18.3.1/umd/', 'react@18/umd/'); }],
];

let bit = 0, missed = 0;
for (const [name, envx, mutate] of controls) {
  const only = process.env.CTL_ONLY; if (only && !name.includes(only)) continue;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-bootguard-'));
  fs.mkdirSync(path.join(dir, 'docs'));
  for (const n of ['react.min.js', 'react-dom.min.js']) fs.copyFileSync(path.join(REPO, 'docs', n), path.join(dir, 'docs', n));
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(dir, 'package.json'));
  const f = { app: APP, lite: LITE, index: INDEX };
  mutate(f);
  // index.html carries app.js as its last script, so keep the two in step.
  if (f.app !== APP) f.index = f.index.split(APP.replace(/\n+$/, '')).join(f.app.replace(/\n+$/, ''));
  fs.writeFileSync(path.join(dir, 'docs/app.js'), f.app);
  fs.writeFileSync(path.join(dir, 'docs/dashboard-lite.html'), f.lite);
  fs.writeFileSync(path.join(dir, 'docs/index.html'), f.index);
  const r = spawnSync(process.execPath, [TEST], { env: Object.assign({}, process.env, envx, { VERA_ROOT: dir, NODE_PATH: path.join(REPO, 'node_modules') }), encoding: 'utf8', timeout: 170000, cwd: REPO });
  const failed = r.status !== 0 && /FAIL/.test(r.stdout || '');
  if (failed) { bit++; console.log('  bit   ' + name); } else { missed++; console.log('  MISSED ' + name + '  (status ' + r.status + ')' + (r.stderr ? ' ' + r.stderr.slice(0, 200) : '')); }
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(missed ? `\n${missed} control(s) did not bite` : `\nALL CONTROLS BIT (${bit})`);
process.exit(missed ? 1 : 0);
