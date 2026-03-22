// ============================================================
// VERA — Shopping.js
// Google Doc shopping list reader/writer
// ============================================================
//
// Setup:
//   Set SHOPPING_LIST_DOC_ID in Script Properties → the ID of your
//   shared Google Doc (the long string in its URL).
//
// The Google Doc must use the Tabs feature (one tab per store).
// Items within each tab should be bullet points or checkbox lists.
// ============================================================

// ---- Config ----------------------------------------------------------------

function getShoppingDocId_() {
  return PropertiesService.getScriptProperties().getProperty('SHOPPING_LIST_DOC_ID') || '';
}

// ---- Read ------------------------------------------------------------------

/**
 * Reads all tabs from the shopping Google Doc and returns their items.
 *
 * @returns {Array} Array of store objects:
 *   [{ tabId: string, storeName: string, items: [{ index: number, text: string, done: boolean }] }]
 */
function getShoppingList_() {
  var docId = getShoppingDocId_();
  if (!docId) {
    Logger.log('getShoppingList_: SHOPPING_LIST_DOC_ID not set in Script Properties.');
    return [];
  }

  var doc  = DocumentApp.openById(docId);
  var tabs = doc.getTabs();

  return tabs.map(function(tab) {
    var body       = tab.asDocumentTab().getBody();
    var numChildren = body.getNumChildren();
    var items      = [];

    for (var i = 0; i < numChildren; i++) {
      var child = body.getChild(i);
      if (child.getType() !== DocumentApp.ElementType.LIST_ITEM) continue;

      var listItem = child.asListItem();
      var text     = listItem.getText().trim();
      if (!text) continue;

      // isStrikethrough returns null (not false) when unset — use === true
      var textEl = listItem.editAsText();
      var done   = textEl.isStrikethrough(0) === true;

      items.push({ index: i, text: text, done: done });
    }

    return {
      tabId:     tab.getId(),
      storeName: tab.getTitle(),
      items:     items,
    };
  });
}

// ---- Toggle ----------------------------------------------------------------

/**
 * Toggles the strikethrough state of a single shopping item in the Google Doc.
 *
 * @param {string} tabId      - The tab ID returned by getShoppingList_()
 * @param {number} itemIndex  - The child index within the tab's body
 * @returns {{ ok: boolean, tabId: string, index: number, done: boolean }}
 */
function toggleShoppingItem_(tabId, itemIndex) {
  var docId = getShoppingDocId_();
  if (!docId) throw new Error('SHOPPING_LIST_DOC_ID not configured in Script Properties.');

  var doc  = DocumentApp.openById(docId);
  var tabs = doc.getTabs();

  // Find the requested tab
  var found = null;
  for (var t = 0; t < tabs.length; t++) {
    if (tabs[t].getId() === tabId) { found = tabs[t]; break; }
  }
  if (!found) throw new Error('Shopping tab not found: ' + tabId);

  var body  = found.asDocumentTab().getBody();
  var idx   = parseInt(itemIndex, 10);
  var child = body.getChild(idx);

  if (!child || child.getType() !== DocumentApp.ElementType.LIST_ITEM) {
    throw new Error('List item not found at index ' + idx + ' in tab ' + tabId);
  }

  var listItem     = child.asListItem();
  var text         = listItem.getText();
  if (text.length === 0) return { ok: true, tabId: tabId, index: idx, done: false };

  var textEl       = listItem.editAsText();
  var currentlyDone = textEl.isStrikethrough(0) === true;
  textEl.setStrikethrough(0, text.length - 1, !currentlyDone);

  Logger.log('toggleShoppingItem_: tab=' + tabId + ' idx=' + idx + ' done=' + !currentlyDone);
  return { ok: true, tabId: tabId, index: idx, done: !currentlyDone };
}

// ---- Delete item -----------------------------------------------------------

/**
 * Removes a shopping list item from the Google Doc.
 *
 * @param {string} tabId      - The tab ID returned by getShoppingList_()
 * @param {number} itemIndex  - The child index within the tab's body
 * @returns {{ ok: boolean, tabId: string, index: number }}
 */
function deleteShoppingItem_(tabId, itemIndex) {
  var docId = getShoppingDocId_();
  if (!docId) throw new Error('SHOPPING_LIST_DOC_ID not configured in Script Properties.');

  var doc  = DocumentApp.openById(docId);
  var tabs = doc.getTabs();

  var found = null;
  for (var t = 0; t < tabs.length; t++) {
    if (tabs[t].getId() === tabId) { found = tabs[t]; break; }
  }
  if (!found) throw new Error('Shopping tab not found: ' + tabId);

  var body  = found.asDocumentTab().getBody();
  var idx   = parseInt(itemIndex, 10);
  var child = body.getChild(idx);

  if (!child || child.getType() !== DocumentApp.ElementType.LIST_ITEM) {
    throw new Error('List item not found at index ' + idx + ' in tab ' + tabId);
  }

  // Google Docs requires at least one paragraph-type element per section and
  // also rejects setText('') on list items.  Workaround: append a plain
  // paragraph first so the list item is no longer the sole element, then
  // remove it normally.  getShoppingList_() only reads LIST_ITEM elements so
  // the placeholder paragraph is invisible to the dashboard.
  try {
    child.removeFromParent();
    Logger.log('deleteShoppingItem_: removed. tab=' + tabId + ' idx=' + idx);
  } catch (removeErr) {
    body.appendParagraph(' ');
    child.removeFromParent();
    Logger.log('deleteShoppingItem_: removed via placeholder. tab=' + tabId + ' idx=' + idx);
  }
  return { ok: true, tabId: tabId, index: idx };
}

// ---- Update item -----------------------------------------------------------

/**
 * Updates the text of an existing shopping list item, preserving its done state.
 *
 * @param {string} tabId      - The tab ID returned by getShoppingList_()
 * @param {number} itemIndex  - The child index within the tab's body
 * @param {string} newText    - Replacement text
 * @returns {{ ok: boolean, tabId: string, index: number, text: string }}
 */
function updateShoppingItem_(tabId, itemIndex, newText) {
  var docId = getShoppingDocId_();
  if (!docId) throw new Error('SHOPPING_LIST_DOC_ID not configured in Script Properties.');

  var doc  = DocumentApp.openById(docId);
  var tabs = doc.getTabs();

  var found = null;
  for (var t = 0; t < tabs.length; t++) {
    if (tabs[t].getId() === tabId) { found = tabs[t]; break; }
  }
  if (!found) throw new Error('Shopping tab not found: ' + tabId);

  var body     = found.asDocumentTab().getBody();
  var idx      = parseInt(itemIndex, 10);
  var child    = body.getChild(idx);

  if (!child || child.getType() !== DocumentApp.ElementType.LIST_ITEM) {
    throw new Error('List item not found at index ' + idx + ' in tab ' + tabId);
  }

  var listItem = child.asListItem();
  var wasDone  = listItem.editAsText().isStrikethrough(0) === true;
  var cleaned  = newText.trim();

  listItem.setText(cleaned);
  if (wasDone && cleaned.length > 0) {
    listItem.editAsText().setStrikethrough(0, cleaned.length - 1, true);
  }

  Logger.log('updateShoppingItem_: tab=' + tabId + ' idx=' + idx + ' text=' + cleaned);
  return { ok: true, tabId: tabId, index: idx, text: cleaned };
}

// ---- Add item --------------------------------------------------------------

/**
 * Appends a new bullet-point list item to a shopping tab.
 *
 * @param {string} tabId  - The tab ID returned by getShoppingList_()
 * @param {string} text   - The item text to add
 * @returns {{ ok: boolean, tabId: string, text: string }}
 */
function addShoppingItem_(tabId, text) {
  var docId = getShoppingDocId_();
  if (!docId) throw new Error('SHOPPING_LIST_DOC_ID not configured in Script Properties.');

  var doc  = DocumentApp.openById(docId);
  var tabs = doc.getTabs();

  var found = null;
  for (var t = 0; t < tabs.length; t++) {
    if (tabs[t].getId() === tabId) { found = tabs[t]; break; }
  }
  if (!found) throw new Error('Shopping tab not found: ' + tabId);

  var body = found.asDocumentTab().getBody();
  body.appendListItem(text).setGlyphType(DocumentApp.GlyphType.BULLET);

  Logger.log('addShoppingItem_: tab=' + tabId + ' text=' + text);
  return { ok: true, tabId: tabId, text: text };
}

// ---- Debug -----------------------------------------------------------------

// ---- Recipe shopping helpers (Issue #40) -----------------------------------

/**
 * Finds the "Recipe" tab in the Shopping Google Doc, creating it if absent.
 * @returns {string|null} Tab ID, or null if SHOPPING_LIST_DOC_ID is not set.
 */
function ensureRecipeTab_() {
  var docId = getShoppingDocId_();
  if (!docId) return null;
  var doc  = DocumentApp.openById(docId);
  var tabs = doc.getTabs();
  for (var t = 0; t < tabs.length; t++) {
    if (tabs[t].getTitle() === 'Recipe') return tabs[t].getId();
  }
  // Create the tab if it doesn't exist
  var newTab = doc.addTab({ title: 'Recipe' });
  return newTab.getId();
}

/**
 * Appends each ingredient string as a bullet item to the "Recipe" shopping tab.
 * @param {string[]} ingredients
 * @returns {{ ok: boolean, count: number, tabId: string }}
 */
function addRecipeIngredients_(ingredients) {
  var tabId = ensureRecipeTab_();
  if (!tabId) throw new Error('SHOPPING_LIST_DOC_ID not configured in Script Properties.');
  ingredients.forEach(function(ing) {
    var text = String(ing).trim();
    if (text) addShoppingItem_(tabId, text);
  });
  return { ok: true, count: ingredients.length, tabId: tabId };
}

// ---- Debug -----------------------------------------------------------------

/**
 * Run from Apps Script editor to verify the shopping doc connection.
 */
function testShoppingList() {
  Logger.log('=== testShoppingList ===');
  var docId = getShoppingDocId_();
  if (!docId) {
    Logger.log('❌ SHOPPING_LIST_DOC_ID not set in Script Properties.');
    return;
  }
  Logger.log('Doc ID: ' + docId);

  var stores = getShoppingList_();
  Logger.log('Stores found: ' + stores.length);
  stores.forEach(function(store) {
    Logger.log('  [' + store.tabId + '] ' + store.storeName + ' — ' + store.items.length + ' items');
    store.items.slice(0, 3).forEach(function(item) {
      Logger.log('    ' + (item.done ? '✓' : '○') + ' [' + item.index + '] ' + item.text);
    });
  });
  Logger.log('=== testShoppingList complete ===');
}
