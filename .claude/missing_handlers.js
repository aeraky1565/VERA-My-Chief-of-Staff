// Extracted from commit 30a7482 — WebApp.js
// Functions missing from current branch, for review before merging into WebApp.js

function webTriggerVictoriaBuffer_(e) {
  var cfg     = readVictoriaPTOConfig_();
  var current = readVictoriaPTOBufferRemaining_(cfg);

  if (current <= 0) {
    return { ok: false, error: 'No buffer days remaining.', remaining: 0 };
  }

  var newVal = current - 1;
  setVictoriaPTOBufferRemaining_(newVal);

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  Logger.log('Victoria PTO Buffer Day triggered. Remaining: ' + newVal + '. Date: ' + today);

  return { ok: true, remaining: newVal, triggeredOn: today };
}

function webRecordSkillPractice_(e) {
  var id = String((e.parameter || {}).id || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var row = findSkillRow_(id);
  if (row < 0) return { ok: false, error: 'skill not found: ' + id };

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  getSpreadsheet().getSheetByName(TABS.SKILLS).getRange(row, 7).setValue(today); // col 7 = Last Practiced

  Logger.log('webRecordSkillPractice_: ' + id + ' on ' + today);
  return { ok: true, id: id, lastPracticed: today, action: 'practice_recorded' };
}

function webGetWishList_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.WISH_LIST);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, items: [] };

  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, WISH_LIST_HEADERS.length).getValues();
  var items   = [];

  data.forEach(function(row, idx) {
    var id = String(row[0] || '').trim();
    if (!id) return;
    items.push({
      row:           idx + 2,
      id:            id,
      person:        String(row[1] || '').trim(),
      category:      String(row[2] || '').trim(),
      item:          String(row[3] || '').trim(),
      description:   String(row[4] || '').trim(),
      urls:          String(row[5] || '').trim(),
      price:         row[6] !== '' && row[6] !== null ? Number(row[6]) : null,
      priority:      String(row[7] || 'Medium').trim(),
      status:        String(row[8] || 'Dreaming').trim(),
      dateAdded:     formatDateVal_(row[9]),
      notes:         String(row[10] || '').trim(),
      datePurchased: formatDateVal_(row[11]),
    });
  });

  // Active items first, purchased last
  items.sort(function(a, b) {
    var aP = a.status === 'Purchased' ? 1 : 0;
    var bP = b.status === 'Purchased' ? 1 : 0;
    return aP - bP;
  });

  return { ok: true, items: items };
}

function webAddWishItem_(e) {
  var p    = e.parameter || {};
  var item = (p.item || '').trim();
  if (!item) throw new Error('item is required');

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.WISH_LIST);
  if (!sheet) throw new Error('Wish List tab not found');

  var tz       = Session.getScriptTimeZone();
  var today    = new Date();
  var dateStr  = Utilities.formatDate(today, tz, 'yyyyMMdd');
  var addedStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  var seq = 1;
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
      .forEach(function(r) { if (String(r[0] || '').indexOf('WISH-' + dateStr) === 0) seq++; });
  }
  var id = 'WISH-' + dateStr + '-' + String(seq).padStart(2, '0');

  var price = p.price !== '' && p.price != null ? Number(p.price) : '';
  if (isNaN(price)) price = '';

  // WISH_LIST_HEADERS: ID | Person | Category | Item | Description | URLs | Price | Priority | Status | Date Added | Notes | Date Purchased
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, WISH_LIST_HEADERS.length).setValues([[
    id,
    (p.person   || 'Ahmed').trim(),
    (p.category || 'Other').trim(),
    item,
    (p.description || '').trim(),
    (p.urls  || p.url || '').trim(),
    price,
    (p.priority || 'Medium').trim(),
    (p.status   || 'Dreaming').trim(),
    addedStr,
    (p.notes || '').trim(),
    '',
  ]]);

  Logger.log('webAddWishItem_: ' + id + ' — ' + item);
  return { ok: true, id: id, action: 'created' };
}

function webUpdateWishItem_(e) {
  var p     = e.parameter || {};
  var id    = (p.id || '').trim();
  var field = (p.field || '').trim();
  var value = (p.value != null ? String(p.value) : '').trim();
  if (!id || !field) throw new Error('id and field are required');

  var found = findWishRow_(id);
  // WISH_LIST_HEADERS col map (1-based): ID=1 Person=2 Category=3 Item=4 Description=5 URLs=6 Price=7 Priority=8 Status=9 Date Added=10 Notes=11 Date Purchased=12
  var colMap = { person:2, category:3, item:4, description:5, urls:6, price:7, priority:8, status:9, notes:11 };
  var col = colMap[field.toLowerCase()];
  if (!col) throw new Error('Unknown field: ' + field);

  var writeVal = field.toLowerCase() === 'price' ? (value !== '' ? Number(value) : '') : value;
  found.sheet.getRange(found.rowNum, col).setValue(writeVal);

  Logger.log('webUpdateWishItem_: ' + id + ' ' + field + '=' + value);
  return { ok: true, id: id, action: 'updated' };
}

function webMarkWishPurchased_(e) {
  var p  = e.parameter || {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');

  var found = findWishRow_(id);
  var tz    = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  found.sheet.getRange(found.rowNum, 9).setValue('Purchased');   // Status
  found.sheet.getRange(found.rowNum, 12).setValue(today);        // Date Purchased

  Logger.log('webMarkWishPurchased_: ' + id);
  return { ok: true, id: id, action: 'purchased' };
}

function webDeleteWishItem_(e) {
  var id    = ((e.parameter && e.parameter.id) || '').trim();
  var found = findWishRow_(id);
  found.sheet.deleteRow(found.rowNum);
  Logger.log('webDeleteWishItem_: ' + id);
  return { ok: true, id: id, action: 'deleted' };
}

function webGetPacingStatus_() {
  return getPacingStatus_();
}

function webAddBucketActivity_(e) {
  var p        = e.parameter || {};
  var bucketId = (p.bucketId || '').trim();
  var activity = (p.activity || '').trim();
  if (!bucketId) throw new Error('bucketId is required.');
  if (!activity) throw new Error('activity is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BUCKET_ACTIVITIES);
  if (!sheet) throw new Error('BucketActivities tab not found. Run setupVERA() first.');
  var id = 'ba_' + Date.now();
  var dt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.appendRow([id, bucketId, activity, '', dt]);
  return { ok: true, activity: { ID: id, 'Bucket ID': bucketId, Activity: activity, Done: '', 'Added Date': dt } };
}

function webToggleBucketActivity_(e) {
  var p    = e.parameter || {};
  var id   = (p.id   || '').trim();
  var done = (p.done || '');
  if (!id) throw new Error('id is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BUCKET_ACTIVITIES);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'Activity not found.' };
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      sheet.getRange(i + 1, 4).setValue(done); // col D: Done
      return { ok: true, id: id, done: done };
    }
  }
  return { ok: false, error: 'Activity not found: ' + id };
}

function webDeleteBucketActivity_(e) {
  var id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) throw new Error('id is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BUCKET_ACTIVITIES);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'Activity not found.' };
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      sheet.deleteRow(i + 1);
      return { ok: true, id: id };
    }
  }
  return { ok: false, error: 'Activity not found: ' + id };
}

function webGymBackfill_(e) {
  var days   = parseInt((e.parameter && e.parameter.days) || '30', 10) || 30;
  var result = backfillGymSessions_(days);
  return { ok: true, added: result.added, skipped: result.skipped };
}

function webGetVisaRequirements_(params) {
  var destination = (params.destination || '').trim();
  if (!destination) return { ok: false, error: 'destination required' };

  // Load traveler profiles
  var profilesResult = webGetProfiles_();
  var profiles = profilesResult.profiles.filter(function(p) { return p.passportCountry; });
  if (profiles.length === 0) return { ok: true, results: [], note: 'No passport countries set in profiles.' };

  // Fetch or use cached passport-index CSV
  var cacheKey = 'passport_index_csv';
  var cache    = CacheService.getScriptCache();
  var csv      = cache.get(cacheKey);
  if (!csv) {
    try {
      var resp = UrlFetchApp.fetch(
        'https://raw.githubusercontent.com/ilyankou/passport-index-dataset/master/passport-index-matrix.csv',
        { muteHttpExceptions: true }
      );
      csv = resp.getContentText();
      cache.put(cacheKey, csv, 21600); // 6 hours
    } catch (err) {
      return { ok: false, error: 'Could not fetch visa data: ' + err.message };
    }
  }

  var lines   = csv.split('\n');
  var headers = lines[0].split(',');

  // Normalize function for country name matching
  function norm(s) { return String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // Common aliases
  var aliases = {
    'usa': 'united states', 'us': 'united states', 'unitedstatesofamerica': 'united states',
    'uk': 'united kingdom', 'gb': 'united kingdom', 'greatbritain': 'united kingdom',
    'uae': 'united arab emirates',
    'drc': 'democratic republic of the congo',
    'southkorea': 'korea, south',
    'northkorea': 'korea, north',
    'taiwan': 'taiwan',
    'russia': 'russia',
    'czechia': 'czech republic',
    'türkiye': 'turkey', 'turkiye': 'turkey',
    'egypt': 'egypt',
    'canada': 'canada',
    'jordan': 'jordan',
    'france': 'france', 'japan': 'japan', 'germany': 'germany'
  };

  var destNorm = norm(destination);
  var destLookup = aliases[destNorm] ? norm(aliases[destNorm]) : destNorm;

  // Find destination column index
  var destIdx = -1;
  for (var i = 1; i < headers.length; i++) {
    if (norm(headers[i]) === destLookup) { destIdx = i; break; }
  }
  if (destIdx === -1) {
    return { ok: true, results: [], note: 'Destination "' + destination + '" not found. Try the full English country name.' };
  }
  var destName = headers[destIdx].trim();

  // Group profiles by name (each row = one passport, name is the combining key)
  var byName = {};
  var nameOrder = [];
  profiles.forEach(function(prof) {
    if (!byName[prof.name]) { byName[prof.name] = []; nameOrder.push(prof.name); }
    byName[prof.name].push(prof);
  });

  var order = { green: 0, yellow: 1, red: 2, grey: 3 };
  var results = [];
  nameOrder.forEach(function(name) {
    var passportResults = byName[name].map(function(prof) {
      var passNorm   = norm(prof.passportCountry);
      var passLookup = aliases[passNorm] ? norm(aliases[passNorm]) : passNorm;
      var status = null;
      for (var j = 1; j < lines.length; j++) {
        var cols = lines[j].split(',');
        if (cols[0] && norm(cols[0]) === passLookup) {
          status = (cols[destIdx] || '').trim();
          break;
        }
      }
      return {
        passportCountry: prof.passportCountry,
        status:          status,
        label:           visaStatusLabel_(status),
        color:           visaStatusColor_(status)
      };
    });
    // Sort best first
    passportResults.sort(function(a, b) { return (order[a.color] || 3) - (order[b.color] || 3); });
    results.push({ name: name, passports: passportResults });
  });

  return { ok: true, results: results, destination: destName };
}

function webGetSavedScenarios_(params) {
  var scenarios = getFinancialScenarios_(params.goalId || null);
  return { ok: true, scenarios: scenarios };
}

function webSyncLifePlanDoc_() {
  try {
    var data = readLifePlanDoc_();
    return { ok: true, parsed: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function webFetchResourceContent_(e) {
  var id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) return { ok: false, error: 'id required' };

  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.RESOURCES);
  if (!sheet) return { ok: false, error: 'Resources sheet not found' };

  var rows = sheet.getDataRange().getValues();
  var hdrs = rows[0];
  var resource = null;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      resource = {};
      hdrs.forEach(function(h, j) { resource[h] = rows[i][j]; });
      break;
    }
  }
  if (!resource) return { ok: false, error: 'not found' };

  var driveFileId = String(resource['Drive File ID'] || '').trim();
  // If the stored value looks like a full URL, extract the file ID from it
  if (driveFileId && driveFileId.indexOf('://') !== -1) {
    var dm = driveFileId.match(/\/d\/([a-zA-Z0-9_-]{25,})/);
    if (!dm) dm = driveFileId.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
    driveFileId = dm ? dm[1] : '';
  }
  if (!driveFileId) return { ok: false, error: 'no_drive_file', name: resource['Name'], url: resource['URL'] };

  try {
    var doc  = DocumentApp.openById(driveFileId);
    var text = doc.getBody().getText();
    // Truncate to ~12,000 chars (~3,000 tokens) to stay within context limits
    if (text.length > 12000) text = text.substring(0, 12000) + '\n[...content truncated...]';
    return { ok: true, id: id, name: resource['Name'], content: text };
  } catch (err) {
    return { ok: false, error: 'cannot_read_file', name: resource['Name'], url: resource['URL'],
             detail: err.message };
  }
}
