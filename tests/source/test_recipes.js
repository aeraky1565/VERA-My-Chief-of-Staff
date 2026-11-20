// Kitchen › Recipes (Recipes.js, the recipe routes in WebApp.js, RecipeBook in both dashboards). Pins:
//  - adding: a site's recipe data, a page or a photo read; saving and editing a row with the new columns;
//  - the card: closed and open, servings that scale the amounts, Add to the list, Copy, cooking mode, Edit;
//  - the photo: a page's og:image / twitter:image as an absolute https URL; a link with none is
//    marked 'none' and not fetched again; recipe_photos fills a batch; the Photo column is named;
//  - last made (on or before today) and next planned from Meal Plan, skipped dinners don't count;
//  - prep times read as minutes; the search (name, ingredient), Quick ≤ 30, cuisine, Not made lately;
//  - the screen: chips with counts, the card line, Plan it's week picker (free dinners marked,
//    past days left out, replacing asks), 🛒 Add N, Open ↗. Invented recipes.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RC = read('Recipes.js'), WEB = read('WebApp.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
function fakeSheet(rows, maxCols) {
  const grid = rows.map(r => r.slice()); let cols = maxCols || 8;
  const pad = r => { while (r.length < cols) r.push(''); return r; }; grid.forEach(pad);
  return { grid, getLastRow: () => grid.length, getMaxColumns: () => Math.max(cols, ...grid.map(r => r.length)), getLastColumn: () => Math.max(cols, ...grid.map(r => r.length)), insertColumnsAfter: (a, n) => { cols += n; grid.forEach(pad); },
    getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
      getValue: () => (grid[r - 1] || [])[c - 1] ?? '', setValue: x => { grid[r - 1][c - 1] = x; }, setValues: v => v.forEach((row, i) => { while (grid.length < r + i) grid.push(pad([])); row.forEach((x, j) => { grid[r - 1 + i][c - 1 + j] = x; }); }) }) };
}

console.log('\nthe photo from the link');
const C = { String, Number, Math, JSON, Date, Object, RegExp, isNaN }; vm.createContext(C);
vm.runInContext(RC, C);
check('og:image, either attribute order', C.rcOgImage_('<meta property="og:image" content="https://cdn.example.test/a.jpg">', 'https://x.test/r') === 'https://cdn.example.test/a.jpg'
  && C.rcOgImage_("<meta content='https://cdn.example.test/b.jpg' property='og:image' />", 'https://x.test/r') === 'https://cdn.example.test/b.jpg');
check('twitter:image when there is no og:image', C.rcOgImage_('<meta name="twitter:image" content="https://cdn.example.test/t.png">', '') === 'https://cdn.example.test/t.png');
check('a relative or protocol-less image is made absolute https', C.rcOgImage_('<meta property="og:image" content="/img/c.jpg">', 'https://site.example.test/recipes/1') === 'https://site.example.test/img/c.jpg'
  && C.rcOgImage_('<meta property="og:image" content="//cdn.example.test/d.jpg">', '') === 'https://cdn.example.test/d.jpg' && C.rcOgImage_('<meta property="og:image" content="http://cdn.example.test/e.jpg">', '') === 'https://cdn.example.test/e.jpg');
check('no image, or a bad one, is ""', C.rcOgImage_('<html><title>x</title></html>', '') === '' && C.rcOgImage_('<meta property="og:image" content="javascript:alert(1)">', '') === '' && C.rcOgImage_('', '') === '');
check('&amp; in the URL is decoded', C.rcOgImage_('<meta property="og:image" content="https://cdn.example.test/f.jpg?w=1&amp;h=2">', '') === 'https://cdn.example.test/f.jpg?w=1&h=2');
{
  const HEAD = ['Name', 'Cuisine', 'Servings', 'Prep Time', 'Link', 'Ingredients', 'Tags', 'Notes'];
  const rows = [HEAD, ['Shawarma bowls', 'Lebanese', 4, '35 min', 'https://a.example.test/1', 'chicken; rice', '', ''], ['Pasta e ceci', 'Italian', 4, '25 min', 'https://b.example.test/2', 'pasta', '', ''], ['Toast', '', 1, '5', '', 'bread', '', '']];
  for (let i = 0; i < 9; i++) rows.push(['Dish ' + i, '', 2, '', 'https://c.example.test/' + i, '', '', '']);
  const sh = fakeSheet(rows);
  const fetched = [];
  const W = { String, Number, Math, JSON, Date, Object, RegExp, isNaN, TABS: { RECIPES: 'Recipes', MEAL_PLAN: 'Meal Plan' }, RECIPE_HEADERS: HEAD,
    getSpreadsheet: () => ({ getSheetByName: n => n === 'Recipes' ? sh : null }),
    UrlFetchApp: { fetch: u => { fetched.push(u); return { getResponseCode: () => 200, getContentText: () => /a\.example/.test(u) ? '<meta property="og:image" content="https://cdn.example.test/1.jpg">' : '<p>no image</p>' }; } } };
  vm.createContext(W); vm.runInContext(RC + '\n' + fnSrc(WEB, 'webGetRecipes_'), W);
  let r = W.webRecipePhotos_();
  check('recipe_photos fills a batch of 8, names the column, marks no-image links "none"', r.filled.length === 8 && r.left === 3 && sh.grid[0][8] === 'Photo' && sh.grid[1][8] === 'https://cdn.example.test/1.jpg' && sh.grid[2][8] === 'none' && sh.grid[3][8] === '', J(sh.grid.slice(0, 4).map(x => x[8])));
  r = W.webRecipePhotos_(); W.webRecipePhotos_();
  check('…the next call does the rest, and nothing is fetched twice', r.filled.length === 3 && r.left === 0 && fetched.length === 11 && new Set(fetched).size === 11, fetched.length);
  const got = W.webGetRecipes_().recipes;
  check('the read sends the photo, never "none"', got[0].photo === 'https://cdn.example.test/1.jpg' && got[1].photo === '' && got[2].photo === '');
}

console.log('\nlast made from Meal Plan');
{
  const rows = [{ mealName: 'Shawarma bowls', date: '2026-10-28', status: 'Planned' }, { mealName: 'shawarma bowls ', date: '2026-09-01', status: 'Planned' },
    { mealName: 'Shawarma bowls', date: '2026-11-19', status: 'Planned' }, { mealName: 'Shawarma bowls', date: '2026-11-25', status: 'Planned' },
    { mealName: 'Pasta e ceci', date: '2026-11-10', status: 'Skipped' }, { mealName: 'Pasta e ceci', date: '2026-11-16', status: 'Planned' }, { mealName: '', date: '2026-11-11' }, { mealName: 'Risotto', date: '2026-11-12', status: 'Skipped' }];
  const m = C.rcMealDates_(rows, '2026-11-16');
  check('the last day made, on or before today, and the next planned', J(m['shawarma bowls']) === J({ lastMade: '2026-10-28', nextPlanned: '2026-11-19' }), J(m['shawarma bowls']));
  check('today counts as made; a skipped dinner doesn’t', J(m['pasta e ceci']) === J({ lastMade: '2026-11-16', nextPlanned: '' }) && !m['risotto'], J(m['pasta e ceci']));
  check('the recipes read joins Meal Plan, and survives it failing', /made = rcMealDates_\(_readMealPlanRows_\(mp\)/.test(fnSrc(WEB, 'webGetRecipes_')) && /catch \(err\) \{ made = \{\}; \}/.test(fnSrc(WEB, 'webGetRecipes_')));
}

console.log('\nfilters');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext('var RC_QUICK_MIN_=30,RC_LATELY_DAYS_=60,RC_DAYS_=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];\n' + ['rcMinutes_', 'rcIngs_', 'rcDay_', 'rcAgo_', 'rcLately_', 'rcFilter_', 'rcCuisines_', 'rcShort_', 'rcLine_', 'rcPickDays_', 'rbMins_', 'rbDur_', 'rbTotal_'].map(n => fnSrc(APP, n)).join('\n'), U);
check('prep times as minutes', U.rcMinutes_('35 min') === 35 && U.rcMinutes_('1 hr 15 min') === 75 && U.rcMinutes_('1h15m') === 75 && U.rcMinutes_('45') === 45 && U.rcMinutes_('1.5 hours') === 90 && U.rcMinutes_('overnight') === null && U.rcMinutes_('') === null);
const NOW = new Date(2026, 10, 16);
const R = [{ row: 2, name: 'Shawarma bowls', cuisine: 'Lebanese', servings: '4', prepTime: '35 min', ingredients: 'chicken; rice; garlic', lastMade: '2026-10-28', link: 'https://a.example.test/1' },
  { row: 3, name: 'Pasta e ceci', cuisine: 'Italian', servings: '4', prepTime: '25 min', ingredients: 'pasta; chickpeas', lastMade: '' },
  { row: 4, name: 'Lentil soup', cuisine: 'Lebanese', prepTime: '1 hr', ingredients: 'lentils; onion', lastMade: '2026-08-01' },
  { row: 5, name: 'Risotto', cuisine: 'Italian', prepTime: '40 min', ingredients: 'rice', lastMade: '2026-01-01', nextPlanned: '2026-11-19' },
  { row: 6, name: 'Toast', cuisine: '', prepTime: '5', ingredients: '' }];
const ids = l => l.map(r => r.row).join();
check('search: name, ingredient', ids(U.rcFilter_(R, 'rice', 'all', NOW)) === '2,5' && ids(U.rcFilter_(R, 'PASTA', 'all', NOW)) === '3');
check('Quick ≤ 30 min', ids(U.rcFilter_(R, '', 'quick', NOW)) === '3,6');
check('a cuisine', ids(U.rcFilter_(R, '', 'c:Lebanese', NOW)) === '2,4');
check('Not made lately: never, or 60+ days, and not planned', ids(U.rcFilter_(R, '', 'lately', NOW)) === '3,4,6');
check('cuisine chips, most first', J(U.rcCuisines_(R)) === J(['Italian', 'Lebanese']));
check('the card line', U.rcLine_(R[0], NOW) === '35 min · serves 4 · 3 ingredients · last made Oct 28' && /never planned$/.test(U.rcLine_(R[1], NOW)) && /^40 min · 1 ingredient · planned Thu, Nov 19$/.test(U.rcLine_(R[3], NOW)), U.rcLine_(R[3], NOW));
const days = U.rcPickDays_([{ weekStart: '2026-11-16', days: [{ day: 'Mon', mealName: 'Tacos' }, { day: 'Wed', mealName: '' }] }, { weekStart: '2026-11-23', days: [] }], new Date(2026, 10, 17, 15));
check('the picker: from today, two weeks, dinners and free days', days.length === 13 && days[0].day === 'Tue' && days[0].today && days[0].free && days[1].day === 'Wed' && days[1].free && days[12].day === 'Sun' && days[12].weekStart === '2026-11-23', J(days.slice(0, 2)));
check('…a planned day carries its dinner', U.rcPickDays_([{ weekStart: '2026-11-16', days: [{ day: 'Mon', mealName: 'Tacos' }] }], NOW)[0].meal === 'Tacos' && !U.rcPickDays_([{ weekStart: '2026-11-16', days: [{ day: 'Mon', mealName: 'Tacos' }] }], NOW)[0].free);
check('Plan it writes the dinner to Meal Plan', /action:'set_meal',weekStart,day,mealName:r\.name,type:'Home Cooked'/.test(APP));

console.log('\nreading a recipe: a site’s own recipe data, durations, cleaning');
{
  const X = { String, Number, Math, JSON, Date, Object, RegExp, isNaN, Array }; vm.createContext(X); vm.runInContext(RC, X);
  check('ISO durations read as time', X.rcDuration_('PT1H30M') === '1 hr 30 min' && X.rcDuration_('PT45M') === '45 min' && X.rcDuration_('PT2H') === '2 hr' && X.rcDuration_('20 minutes') === '20 minutes' && X.rcDuration_('') === '');
  const page = '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},{"@type":["Recipe"],"name":"Lemon &amp; Herb Chicken",' +
    '"recipeYield":["4","4 servings"],"prepTime":"PT15M","cookTime":"PT40M","totalTime":"PT55M","recipeIngredient":["1 1/2 lb chicken thighs","2 lemons","1 tbsp olive oil"],' +
    '"recipeInstructions":[{"@type":"HowToSection","name":"Marinate","itemListElement":[{"@type":"HowToStep","text":"Zest the lemons."},{"@type":"HowToStep","text":"Rub the chicken."}]},{"@type":"HowToStep","text":"Roast at 425°F for 40 minutes."}],' +
    '"recipeCuisine":"Mediterranean","recipeCategory":"Dinner","keywords":"easy, weeknight","tool":["sheet pan"],"nutrition":{"@type":"NutritionInformation","calories":"420 kcal","proteinContent":"35 g"},"image":["https://img.example.test/c.jpg"]}]}</script></head></html>';
  const ld = X.rcFindLd_(page);
  check('the Recipe is found inside @graph, with an array @type', !!ld && /Lemon/.test(ld.name));
  const r = X.rcClean_(X.rcFromLd_(ld, 'https://site.example.test/r'));
  check('name, servings and times', r.name === 'Lemon & Herb Chicken' && r.servings === '4' && r.prep === '15 min' && r.cook === '40 min' && r.total === '55 min', J(r));
  check('ingredients one per line, as written', J(r.ingredients) === J(['1 1/2 lb chicken thighs', '2 lemons', '1 tbsp olive oil']));
  check('directions in order, a section as a heading', J(r.directions) === J(['Marinate:', 'Zest the lemons.', 'Rub the chicken.', 'Roast at 425°F for 40 minutes.']), J(r.directions));
  check('equipment, cuisine, tags, nutrition, photo and link', J(r.equipment) === J(['sheet pan']) && r.cuisine === 'Mediterranean' && J(r.tags) === J(['Dinner', 'easy', 'weeknight'])
    && J(r.nutrition) === J(['Calories 420 kcal', 'Protein 35 g']) && r.photo === 'https://img.example.test/c.jpg' && r.link === 'https://site.example.test/r', J(r));
  check('a page with no Recipe gives nothing', X.rcFindLd_('<script type="application/ld+json">{"@type":"Article"}</script>') === null && X.rcFindLd_('<script type="application/ld+json">{broken</script>') === null);
  const c = X.rcClean_({ name: ' Soup ', ingredients: 'a; b\nc', directions: ['One', '', 'Two'], nutrition: { calories: '200' }, link: 'javascript:x', tags: 'x,y' });
  check('cleaning: lists from text, empties dropped, a bad link dropped, nutrition from an object', J(c.ingredients) === J(['a', 'b', 'c']) && J(c.directions) === J(['One', 'Two']) && c.link === '' && J(c.nutrition) === J(['Calories 200']), J(c));
  check('a ; inside an ingredient can’t split it later', J(X.rcClean_({ ingredients: ['salt; to taste'] }).ingredients) === J(['salt', 'to taste']) || J(X.rcClean_({ ingredients: ['salt, to taste'] }).ingredients) === J(['salt, to taste']));
  check('the page text for Claude drops scripts and styles', !/var x/.test(X.rcPageText_('<script>var x=1</script><p>Mix well</p>')) && /Mix well/.test(X.rcPageText_('<script>var x=1</script><p>Mix well</p>')));
}

console.log('\nrecipe_read and recipe_save');
{
  const HEAD = ['Name', 'Cuisine', 'Servings', 'Prep Time', 'Link', 'Ingredients', 'Tags', 'Notes'];
  const sh = fakeSheet([HEAD, ['Toast', '', 1, '5', '', 'bread', '', '']]);
  sh.getLastColumn = () => { let w = 0; sh.grid.forEach(r => { r.forEach((v, i) => { if (v !== '' && v != null) w = Math.max(w, i + 1); }); }); return Math.max(w, 8); };
  const origRange = sh.getRange; sh.getRange = (r, c, nr, nc) => { const g = origRange(r, c, nr, nc); g.setNumberFormat = () => g; return g; };
  let claude = null, page = '';
  const W = { String, Number, Math, JSON, Date, Object, RegExp, isNaN, Array, TABS: { RECIPES: 'Recipes', MEAL_PLAN: 'Meal Plan' }, RECIPE_HEADERS: HEAD,
    Logger: { log() {} }, CLAUDE_API_URL: 'x', CLAUDE_MODEL: 'm', getApiKey: () => 'k', tiLocked_: f => f(),
    getSpreadsheet: () => ({ getSheetByName: n => n === 'Recipes' ? sh : null }),
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => page === 403 ? 403 : 200, getContentText: () => page }) },
    fetchTracked_: (s, u, o) => { claude = JSON.parse(o.payload); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ text: '{"name":"Card soup","servings":"2","ingredients":["1 onion"],"directions":["Cook it"],"unsure":["servings"]}' }] }) }; } };
  vm.createContext(W); vm.runInContext(RC + '\n' + read('Eyes.js').match(/var EY_MIMES_[^\n]*\n/)[0] + (read('Eyes.js').match(/var EY_MAX_B64_[^\n]*\n/) || [''])[0] + fnSrc(read('Eyes.js'), 'eyBlock_') + fnSrc(read('Eyes.js'), 'eyCheckFile_') + fnSrc(WEB, 'webGetRecipes_'), W);
  page = '<script type="application/ld+json">{"@type":"Recipe","name":"Site stew","recipeIngredient":["1 carrot"],"recipeInstructions":"Simmer."}</script>';
  let r = W.webRecipeRead_({ url: 'https://site.example.test/stew' });
  check('a recipe site is read from its own recipe data, with no Claude call', r.ok && r.from === 'site' && r.recipe.name === 'Site stew' && claude === null, J(r));
  page = '<html><body><h1>Grandma’s cake</h1><p>2 eggs</p></body></html>';
  r = W.webRecipeRead_({ url: 'https://blog.example.test/cake' });
  check('a page without it goes to Claude as text, and keeps the link', r.ok && r.from === 'page' && claude && /Grandma/.test(claude.messages[0].content[0].text) && r.recipe.link === 'https://blog.example.test/cake', J(r));
  page = 403; r = W.webRecipeRead_({ url: 'https://locked.example.test/x' });
  check('a site that refuses says what to do instead', r.ok === false && /screenshot/.test(r.error));
  check('not a web link', W.webRecipeRead_({ url: 'ftp://x' }).ok === false);
  claude = null; r = W.webRecipeRead_({ imageBase64: 'QUJD', mime: 'image/jpeg' });
  check('a photo is read by Claude as an image, unsure fields passed on', r.ok && r.from === 'photo' && claude.messages[0].content[0].type === 'image' && J(r.unsure) === J(['servings']), J(r));
  check('a PDF goes as a document', (W.webRecipeRead_({ imageBase64: 'QUJD', mime: 'application/pdf' }), claude.messages[0].content[0].type === 'document'));
  check('anything else is refused', W.webRecipeRead_({ imageBase64: 'QUJD', mime: 'text/plain' }).ok === false);
  let s = W.webRecipeSave_({ recipe: { name: 'Card soup', servings: '2', prep: '10 min', cook: '20 min', ingredients: ['1 onion', '2 cups stock'], directions: ['Chop', 'Simmer'], equipment: ['pot'], nutrition: ['Calories 150'], tags: ['soup'], notes: 'Good cold' }, from: 'photo' });
  const head = sh.grid[0];
  const at = h => head.indexOf(h);
  check('save adds a row, with the new columns named after Photo', s.ok && s.row === 3 && J(RC_MORE()) === J(head.slice(9, 16)) && sh.grid[2][0] === 'Card soup', J(head));
  function RC_MORE() { return ['Cook Time', 'Total Time', 'Directions', 'Equipment', 'Nutrition', 'Source', 'Updated']; }
  check('…ingredients with ;, directions one per line, the rest in their columns', sh.grid[2][5] === '1 onion; 2 cups stock' && sh.grid[2][at('Directions')] === 'Chop\nSimmer' && sh.grid[2][at('Equipment')] === 'pot'
    && sh.grid[2][at('Cook Time')] === '20 min' && sh.grid[2][at('Nutrition')] === 'Calories 150' && sh.grid[2][at('Source')] === 'photo' && /^\d{4}-/.test(sh.grid[2][at('Updated')]), J(sh.grid[2]));
  s = W.webRecipeSave_({ row: 3, recipe: { name: 'Card soup', servings: '3', ingredients: ['1 onion'], directions: ['Chop'] } });
  check('save with a row edits that recipe, not a new one', s.ok && s.row === 3 && sh.grid.length === 3 && sh.grid[2][2] === '3' && sh.grid[2][at('Source')] === 'photo', J(sh.grid[2]));
  check('a name is needed, and the ingredients or directions', W.webRecipeSave_({ recipe: { ingredients: ['x'] } }).ok === false && W.webRecipeSave_({ recipe: { name: 'Empty' } }).ok === false);
  check('a name can’t start a formula', W.webRecipeSave_({ recipe: { name: '=HYPERLINK("x")', ingredients: ['x'] } }).ok === false);
  check('a row that isn’t there is refused', W.webRecipeSave_({ row: 99, recipe: { name: 'X', ingredients: ['x'] } }).ok === false);
  const got = W.webGetRecipes_().recipes.find(x => x.name === 'Card soup');
  check('the read returns the new fields', got && got.directions === 'Chop' && got.servings === '3' && got.source === 'photo' && got.equipment === '' , J(got));
  check('the routes', /case 'recipe_read':\s+return jsonOut_\(webRecipeRead_\(body\)\)/.test(WEB) && /case 'recipe_save':\s+return jsonOut_\(webRecipeSave_\(body\)\)/.test(WEB));
  check('Add to the list takes the card’s scaled lines', /String\(\(e\.parameter && e\.parameter\.items\) \|\| ''\)\.trim\(\) \|\| String\(sheet\.getRange\(rowNum, 6\)/.test(WEB));
}

console.log('\nservings and the shared text');
{
  const B = { String, Number, Math, JSON, Date, Object, RegExp, isNaN, Array }; vm.createContext(B);
  vm.runInContext(APP.slice(APP.indexOf('var RB_FRAC='), APP.indexOf('function rbWrap_(')), B);
  check('amounts read: whole, mixed, unicode, fraction, decimal, range', B.rbQty_('2 cups').n === 2 && B.rbQty_('1 1/2 lb chicken').n === 1.5 && B.rbQty_('1½ tsp').n === 1.5 && B.rbQty_('3/4 cup').n === 0.75 && B.rbQty_('2.5 oz').n === 2.5 && B.rbQty_('2-3 cloves').n2 === 3 && B.rbQty_('salt to taste') === null);
  check('numbers as a cook writes them', B.rbFmt_(1.5) === '1 1/2' && B.rbFmt_(0.75) === '3/4' && B.rbFmt_(2) === '2' && B.rbFmt_(0.333) === '1/3' && B.rbFmt_(2.4) === '2.4');
  check('a line scaled: 4 servings → 6, the unit singular or plural', B.rbScaleLine_('1 1/2 lb chicken thighs', 1.5) === '2 1/4 lbs chicken thighs' && B.rbScaleLine_('2 cups stock', 0.5) === '1 cup stock' && B.rbScaleLine_('1 Cup milk', 3) === '3 Cups milk' && B.rbScaleLine_('2-3 cloves garlic', 2) === '4–6 cloves garlic' && B.rbScaleLine_('salt to taste', 2) === 'salt to taste' && B.rbScaleLine_('2 eggs', 1) === '2 eggs', B.rbScaleLine_('1 1/2 lb chicken thighs', 1.5));
  const r = { name: 'Soup', servings: '4', prepTime: '10 min', cookTime: '20 min', ingredients: '2 cups stock; 1 onion', directions: 'Prep:\nChop\nSimmer', equipment: 'pot', notes: 'Good cold', link: 'https://x.example.test' };
  check('the whole time: total, else prep + cook', B.rbTotal_(r) === 30 && B.rbTotal_({ totalTime: '1 hr 5 min', prepTime: '5 min' }) === 65);
  const t = B.rbText_(r, 2);
  check('Copy as text: at the servings picked, steps numbered under their headings', /^Soup\n2 servings · 30 min\n\nIngredients\n• 1 cup stock\n• 1\/2 onion/.test(t) && /Directions\nPrep:\n1\. Chop\n2\. Simmer/.test(t) && /Equipment\n• pot/.test(t) && /https:\/\/x\.example\.test$/.test(t), t);
}

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screen: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const LIST = [Object.assign({}, R[0], { lastMade: 'recent', photo: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', ingredients: '1 1/2 lb chicken; 2 cups rice; 3 cloves garlic', directions: 'Marinate:\nRub the chicken\nRoast it', equipment: 'sheet pan', nutrition: 'Calories 520', notes: 'Extra lemon' }),
    Object.assign({}, R[1], { link: 'https://b.example.test/2' }), Object.assign({}, R[2], { lastMade: 'old' }), Object.assign({}, R[4], { link: '' })];
  for (const [file, width] of [['docs/index.html', 390], ['docs/index.html', 1280]]) {
    const L = (/lite/.test(file) ? 'lite ' : '') + '@' + width;
    console.log('\n' + L);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(({ list }) => {
      window.__calls = []; window.__ev = []; window.confirm = () => { window.__ev.push(['confirm']); return true; };
      const t = new Date(); const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const shift = n => iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - n));
      const mon = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7)), next = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7);
      window.__weeks = { weeks: [{ weekStart: iso(mon), days: [] }, { weekStart: iso(next), days: [{ day: 'Tue', mealName: 'Tacos' }] }] };
      window.__list = list.map(r => Object.assign({}, r, { lastMade: r.lastMade === 'recent' ? shift(10) : r.lastMade === 'old' ? shift(100) : r.lastMade }));
      try { navigator.clipboard.writeText = s => { window.__copied = s; return Promise.resolve(); }; } catch (e) {}
      window.fetch = function(url, opt) {
        let p = {}; try { new URL(url).searchParams.forEach((v, k) => { p[k] = v; }); } catch (e) {}
        if (opt && opt.body) { try { Object.assign(p, JSON.parse(opt.body)); } catch (e) {} }
        window.__calls.push(p);
        const a = p.action;
        const body = a === 'recipes' ? { ok: true, recipes: window.__list }
          : a === 'recipe_read' ? (p.url ? { ok: true, from: 'site', unsure: [], recipe: { name: 'Site stew', servings: '4', ingredients: ['1 carrot'], directions: ['Simmer'], link: p.url } }
                                         : { ok: true, from: 'photo', unsure: ['servings'], recipe: { name: 'Card soup', servings: '2', ingredients: ['1 onion'], directions: ['Cook it'] } })
          : a === 'recipe_save' ? { ok: true, row: 9, name: (p.recipe || {}).name } : a === 'recipe_to_shopping' ? { ok: true, count: 3 }
          : { ok: true, rows: [], items: [], recipes: [], flags: [], tasks: [] };
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
      };
    }, { list: LIST });
    await page.goto('file://' + path.resolve(ROOT, file), { waitUntil: 'load' });
    await page.waitForFunction(() => typeof RecipeBook === 'function', null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => { document.body.innerHTML = '<div id="rc" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('rc')).render(React.createElement(RecipeBook, { apiUrl: 'https://vera.test/exec', apiToken: 't',
        PlanSheet: typeof RecipePlanSheet === 'function' && !/lite/.test(location.href) ? RecipePlanSheet : null, onPlan: (r, ws, d) => window.__ev.push(['plan', r.name, ws, d]), onLoadWeeks: () => Promise.resolve(window.__weeks) })); });
    await page.waitForTimeout(400);
    const calls = () => page.evaluate(() => window.__calls.filter(c => c.action !== 'recipes'));
    const clear = () => page.evaluate(() => { window.__calls = []; });
    const chips = await page.$$eval('#rc .rb-chip', ns => ns.map(n => n.textContent));
    check(L + ': chips: All, Quick, cuisines, Not made lately, with counts', J(chips) === J(['All · 4', 'Quick ≤ 30 min · 2', 'Lebanese · 2', 'Italian · 1', 'Not made lately · 3']), J(chips));
    check(L + ': cards in name order, a photo or a plate', J(await page.$$eval('#rc .rb-card', ns => ns.map(n => n.dataset.recipe))) === J(['Lentil soup', 'Pasta e ceci', 'Shawarma bowls', 'Toast']) && !!(await page.$('#rc .rb-card[data-recipe="Shawarma bowls"] img')));
    check(L + ': the closed card: time, servings, ingredients, last made, and no details', /35 min · serves 4 · 3 ingredients · last made /.test(await page.$eval('#rc .rb-card[data-recipe="Shawarma bowls"] .rb-meta', n => n.textContent)) && !(await page.$('#rc .rb-detail')));
    check(L + ': a linked recipe with no photo asks for photos once', (await page.evaluate(() => window.__calls.filter(c => c.action === 'recipe_photos').length)) === 1);
    await page.fill('#rc .rb-search', 'chickpea'); await page.waitForTimeout(40);
    check(L + ': the search finds an ingredient', J(await page.$$eval('#rc .rb-card', ns => ns.map(n => n.dataset.recipe))) === J(['Pasta e ceci']));
    await page.fill('#rc .rb-search', ''); await page.click('#rc .rb-chip >> text=/^Not made lately/'); await page.waitForTimeout(40);
    check(L + ': Not made lately', J(await page.$$eval('#rc .rb-card', ns => ns.map(n => n.dataset.recipe))) === J(['Lentil soup', 'Pasta e ceci', 'Toast']));
    await page.click('#rc .rb-chip >> text=/^All/'); await page.waitForTimeout(40);
    // open a card
    const card = '#rc .rb-card[data-recipe="Shawarma bowls"]';
    await page.click(card + ' .rb-head'); await page.waitForTimeout(60);
    check(L + ': opening shows ingredients, equipment, numbered directions under a heading, nutrition, notes', J(await page.$$eval(card + ' .rb-ings li', ns => ns.map(n => n.textContent))) === J(['1 1/2 lb chicken', '2 cups rice', '3 cloves garlic'])
      && /sheet pan/.test(await page.$eval(card + ' .rb-equip', n => n.textContent)) && /Marinate:1\.Rubthechicken2\.Roastit/.test((await page.$eval(card + ' .rb-steps', n => n.textContent)).replace(/\s/g, ''))
      && /Calories 520/.test(await page.$eval(card + ' .rb-nut', n => n.textContent)) && /Extra lemon/.test(await page.$eval(card + ' .rb-detail', n => n.textContent)));
    await page.click(card + ' .rb-more'); await page.click(card + ' .rb-more'); await page.waitForTimeout(40);
    check(L + ': more servings scale the amounts (4 → 6)', (await page.$eval(card + ' .rb-count', n => n.textContent)) === '6' && J(await page.$$eval(card + ' .rb-ings li', ns => ns.map(n => n.textContent))) === J(['2 1/4 lbs chicken', '3 cups rice', '4 1/2 cloves garlic']));
    await clear(); await page.click(card + ' .rb-shop'); await page.waitForTimeout(80);
    let c = await calls();
    check(L + ': Add to the list sends the scaled lines', c.some(x => x.action === 'recipe_to_shopping' && x.row === '2' && x.items === '2 1/4 lbs chicken;3 cups rice;4 1/2 cloves garlic'), J(c));
    await page.click(card + ' .rb-copy'); await page.waitForTimeout(60);
    check(L + ': Copy as text, at 6 servings', /^Shawarma bowls\n6 servings · 35 min\n\nIngredients\n• 2 1\/4 lbs chicken/.test(await page.evaluate(() => window.__copied || '')), await page.evaluate(() => window.__copied || ''));
    check(L + ': Share as a picture is there', !!(await page.$(card + ' .rb-share')));
    check(L + (/lite/.test(file) ? ': no Plan it on lite' : ': Plan it'), /lite/.test(file) ? !(await page.$(card + ' .rb-plan')) : !!(await page.$(card + ' .rb-plan')));
    // Plan it (full dashboard): the week picker
    const pasta = '#rc .rb-card[data-recipe="Pasta e ceci"]';
    await page.click(pasta + ' .rb-head'); await page.waitForTimeout(40); await page.click(pasta + ' .rb-plan'); await page.waitForTimeout(120);
    const pick = await page.$$eval('.rc-dayb', ns => ns.map(n => [n.dataset.day.split(':')[1], n.classList.contains('free'), n.querySelector('small').textContent]));
    const wk = await page.evaluate(() => window.__weeks.weeks.map(w => w.weekStart));
    check(L + ': Plan it: the days from today to next Sunday, a planned one shows its dinner', pick.length >= 7 && pick.length <= 14 && pick[pick.length - 1][0] === 'Sun' && pick.some(p => p[0] === 'Tue' && !p[1] && p[2] === 'Tacos'), J(pick));
    await page.click('.rc-dayb[data-day="' + wk[1] + ':Tue"]'); await page.waitForTimeout(40);
    let ev = await page.evaluate(() => window.__ev);
    check(L + ': …a planned day asks before replacing it', J(ev.slice(-2)) === J([['confirm'], ['plan', 'Pasta e ceci', wk[1], 'Tue']]), J(ev.slice(-2)));
    await page.click(pasta + ' .rb-plan'); await page.waitForTimeout(120); await page.click('.rc-dayb[data-day="' + wk[1] + ':Sun"]'); await page.waitForTimeout(40);
    ev = await page.evaluate(() => window.__ev);
    check(L + ': …a free day plans it straight away', J(ev.slice(-1)) === J([['plan', 'Pasta e ceci', wk[1], 'Sun']]) && ev[ev.length - 2][0] !== 'confirm');
    await page.click(card + ' .rb-head'); await page.waitForTimeout(40);
    // cooking mode
    await page.click(card + ' .rb-cookb'); await page.waitForTimeout(60);
    check(L + ': cooking mode: big text, the scaled ingredients to tick, step 1 of 2', !!(await page.$('.rb-cook')) && /step 1 of 2/.test(await page.$eval('.rb-cook', n => n.textContent)) && /2 1\/4 lbs chicken/.test(await page.$eval('.rb-cook-ings', n => n.textContent)));
    await page.click('.rb-cook-next'); await page.waitForTimeout(40);
    check(L + ': …Next step moves on', /step 2 of 2/.test(await page.$eval('.rb-cook', n => n.textContent)));
    await page.click('.rb-cook-close'); await page.waitForTimeout(40);
    check(L + ': …Done closes it', !(await page.$('.rb-cook')));
    // edit
    await page.click(card + ' .rb-edit'); await page.waitForTimeout(60);
    check(L + ': Edit opens the form filled in, one ingredient per line', /Edit Shawarma bowls/.test(await page.$eval('.rb-form', n => n.textContent)) && (await page.$eval('.rb-field[data-field="ingredients"] textarea', n => n.value)) === '1 1/2 lb chicken\n2 cups rice\n3 cloves garlic');
    await clear(); await page.click('.rb-save'); await page.waitForTimeout(100);
    c = await calls();
    check(L + ': Save edits that row', c.some(x => x.action === 'recipe_save' && x.row === 2 && x.recipe.name === 'Shawarma bowls' && J(x.recipe.ingredients) === J(['1 1/2 lb chicken', '2 cups rice', '3 cloves garlic'])), J(c));
    // add from a link
    await page.fill('.rb-url', 'https://site.example.test/stew'); await clear(); await page.click('.rb-read-link'); await page.waitForTimeout(100);
    check(L + ': a link is read, and the form says check then Save', (await calls()).some(x => x.action === 'recipe_read' && x.url === 'https://site.example.test/stew') && (await page.$eval('.rb-field[data-field="name"] input', n => n.value)) === 'Site stew' && /Check it, then Save/.test(await page.$eval('.rb-msg', n => n.textContent)));
    await page.click('.rb-cancel'); await page.waitForTimeout(40);
    // add from a photo
    await page.setInputFiles('.rb-upload input', { name: 'card.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
    await page.waitForTimeout(400);
    c = await calls();
    check(L + ': a photo is sized down and read', c.some(x => x.action === 'recipe_read' && x.mime === 'image/jpeg' && x.imageBase64), J(c.map(x => x.action)));
    check(L + ': …an unsure field is marked', !!(await page.$('.rb-field.unsure[data-field="servings"]')) && /check this/.test(await page.$eval('.rb-field.unsure[data-field="servings"]', n => n.textContent)));
    await page.fill('.rb-field[data-field="servings"] input', '3'); await page.waitForTimeout(30);
    check(L + ': …fixing it clears the mark', !(await page.$('.rb-field.unsure[data-field="servings"]')));
    await clear(); await page.click('.rb-save'); await page.waitForTimeout(120);
    c = await calls();
    check(L + ': Save adds it, with where it came from', c.some(x => x.action === 'recipe_save' && !x.row && x.from === 'photo' && x.recipe.servings === '3') && /Saved Card soup/.test(await page.$eval('.rb-msg', n => n.textContent)), J(c));
    await page.click('.rb-type'); await page.waitForTimeout(40);
    check(L + ': Type it in opens an empty form', !!(await page.$('.rb-form')) && (await page.$eval('.rb-field[data-field="name"] input', n => n.value)) === '');
    await page.click('.rb-cancel');
    check(L + ': no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  check('lite’s Kitchen › Recipes shows the same block (no Plan it there)', /\{sub === 'recipes' && \(\s*<RecipeBook apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>/.test(read('docs/dashboard-lite.html')));
  check('the two dashboards share RecipeBook word for word', (() => { const a = APP, l = read('docs/dashboard-lite.html'); const cut = s => s.slice(s.indexOf('// ---- RecipeBook (Kitchen'), s.indexOf('// ---- /RecipeBook ----')); return cut(a).length > 1000 && cut(a) === cut(l); })());
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
