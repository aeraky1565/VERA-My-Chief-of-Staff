// ============================================================
// VERA — Web App Endpoint (Phase 2)
// WebApp.js — JSON API bridge for the React dashboard
// ============================================================
//
// HOW TO DEPLOY:
//   1. In Apps Script editor: Deploy > New deployment
//   2. Type: Web App
//   3. Execute as: Me
//   4. Who has access: Anyone
//   5. Click Deploy — copy the Web App URL
//   6. Set VERA_WEB_TOKEN in Script Properties (any random string)
//      All requests must include ?token=YOUR_TOKEN
//
// GET endpoints (all operations use GET to avoid CORS preflight):
//   ?action=status               → flag counts + last run date
//   ?action=flags                → all flags
//   ?action=flags&filter=active  → unacknowledged + unresolved only
//   ?action=tasks                → open tasks
//   ?action=summaries            → summaries tab
//   ?action=acknowledge&id=FLAG-xxx
//   ?action=snooze&id=FLAG-xxx&days=2
//   ?action=resolve&id=FLAG-xxx
//   ?action=chat&message=...&session=dashboard  → VERA chat (Phase 4)
//
// POST endpoints:
//   { action: 'acknowledge'|'snooze'|'resolve', id: '...', days?: N }
//   Telegram webhook POSTs are detected automatically (no token needed)
// ============================================================

// ---- Auth ------------------------------------------------------------------

function getWebToken_() {
  return PropertiesService.getScriptProperties().getProperty('VERA_WEB_TOKEN') || '';
}

function isAuthorized_(e) {
  const token = getWebToken_();
  if (!token) return false;                               // No token = locked
  return (e && e.parameter && e.parameter.token) === token;
}

// ---- Response helpers ------------------------------------------------------

function jsonOut_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function errOut_(msg, code) {
  return jsonOut_({ ok: false, error: msg, code: code || 400 });
}

// ---- doGet — all operations (GET avoids CORS preflight from file://) -------

function doGet(e) {
  if (!isAuthorized_(e)) return errOut_('Unauthorized', 401);

  const action = (e.parameter && e.parameter.action) || 'status';
  const id     = e.parameter && e.parameter.id;
  const days   = e.parameter && e.parameter.days;

  try {
    switch (action) {
      case 'status':      return jsonOut_(webGetStatus_());
      case 'flags':       return jsonOut_(webGetFlags_(e));
      case 'tasks':       return jsonOut_(webGetTasks_());
      case 'summaries':   return jsonOut_(webGetSummaries_());
      case 'acknowledge':    return jsonOut_(webAcknowledge_(id));
      case 'snooze':         return jsonOut_(webSnooze_(id, days));
      case 'resolve':        return jsonOut_(webResolve_(id));
      case 'complete_task':         return jsonOut_(webCompleteTask_(id));
      case 'add_task':              return jsonOut_(webAddTask_(e));
      case 'update_task':           return jsonOut_(webUpdateTask_(e));
      case 'shopping':        return jsonOut_(webGetShopping_());
      case 'shopping_toggle': return jsonOut_(webToggleShoppingItem_(e));
      case 'shopping_add':    return jsonOut_(webAddShoppingItem_(e));
      case 'shopping_delete': return jsonOut_(webDeleteShoppingItem_(e));
      case 'shopping_update': return jsonOut_(webUpdateShoppingItem_(e));
      case 'projects':              return jsonOut_(webGetProjects_());
      case 'complete_project_task': return jsonOut_(webCompleteProjectTask_(e.parameter.row));
      case 'add_project_task':      return jsonOut_(webAddProjectTask_(e));
      case 'update_project_task':   return jsonOut_(webUpdateProjectTask_(e));
      case 'delete_project_task':   return jsonOut_(webDeleteProjectTask_(e));
      case 'goals':        return jsonOut_(webGetGoals_());
      case 'add_goal':    return jsonOut_(webAddGoal_(e));
      case 'update_goal': return jsonOut_(webUpdateGoal_(e));
      case 'delete_goal': return jsonOut_(webDeleteGoal_(e));
      case 'interests':        return jsonOut_(webGetInterests_());
      case 'interests_add':    return jsonOut_(webAddInterest_(e));
      case 'interests_delete': return jsonOut_(webDeleteInterest_(e));
      case 'pto':                   return jsonOut_(webGetPTO_());
      case 'pto_trigger_buffer':    return jsonOut_(webTriggerBuffer_(e));
      case 'budget':                return jsonOut_(webGetBudget_());
      case 'bills':                 return jsonOut_(webGetBills_());
      case 'bills_toggle':          return jsonOut_(webToggleBill_(e));
      case 'calendar_bills':          return jsonOut_(webGetCalendarBills_());
      case 'bills_toggle_cal':        return jsonOut_(webToggleCalBill_(e));
      case 'bills_sync_transactions': return jsonOut_(webSyncBillsFromTransactions_());
      case 'tx_list':                 return jsonOut_(webGetTxList_());
      case 'dest_weather':            return jsonOut_(webGetDestWeather_(e));
      case 'cashflow':                return jsonOut_(webGetCashflow_(e));
      case 'tx_aliases':              return jsonOut_(webGetTxAliases_());
      case 'set_tx_alias':            return jsonOut_(webSetTxAlias_(e));
      case 'recipes':               return jsonOut_(webGetRecipes_());
      case 'recipe_to_shopping':    return jsonOut_(webRecipeToShopping_(e));
      case 'takeouts':              return jsonOut_(webGetTakeouts_());
      case 'homesteward':           return jsonOut_(webGetHomesteward_());
      case 'homesteward_service':   return jsonOut_(webRecordService_(e));
      case 'ideas':                 return jsonOut_(webGetIdeas_());
      case 'add_idea':              return jsonOut_(webAddIdea_(e));
      case 'update_idea':           return jsonOut_(webUpdateIdea_(e));
      case 'delete_idea':           return jsonOut_(webDeleteIdea_(e));
      case 'promote_idea':          return jsonOut_(webPromoteIdea_(e));
      case 'delete_task':           return jsonOut_(webDeleteTask_(id));
      case 'add_bill':              return jsonOut_(webAddBill_(e));
      case 'delete_bill':           return jsonOut_(webDeleteBill_(e));
      case 'add_recipe':            return jsonOut_(webAddRecipe_(e));
      case 'delete_recipe':         return jsonOut_(webDeleteRecipe_(e));
      case 'add_home_item':         return jsonOut_(webAddHomeItem_(e));
      case 'delete_home_item':      return jsonOut_(webDeleteHomeItem_(e));
      case 'itinerary':             return jsonOut_(webGetItinerary_(e));
      case 'add_itinerary_item':    return jsonOut_(webAddItineraryItem_(e));
      case 'update_itinerary_item': return jsonOut_(webUpdateItineraryItem_(e));
      case 'delete_itinerary_item': return jsonOut_(webDeleteItineraryItem_(e));
      case 'get_trip_meta':         return jsonOut_(webGetTripMeta_(e));
      case 'set_trip_meta':         return jsonOut_(webSetTripMeta_(e));
      case 'get_packing':           return jsonOut_(webGetPacking_(e));
      case 'add_packing_item':      return jsonOut_(webAddPackingItem_(e));
      case 'update_packing_item':   return jsonOut_(webUpdatePackingItem_(e));
      case 'delete_packing_item':   return jsonOut_(webDeletePackingItem_(e));
      case 'generate_packing':      return jsonOut_(webGeneratePacking_(e));
      case 'countries':             return jsonOut_(webGetCountries_());
      case 'add_country':           return jsonOut_(webAddCountry_(e));
      case 'delete_country':        return jsonOut_(webDeleteCountry_(e));
      case 'get_bucket_list':         return jsonOut_(webGetBucketList_());
      case 'add_bucket_item':         return jsonOut_(webAddBucketItem_(e));
      case 'update_bucket_item':      return jsonOut_(webUpdateBucketItem_(e));
      case 'delete_bucket_item':      return jsonOut_(webDeleteBucketItem_(e));
      case 'add_bucket_activity':     return jsonOut_(webAddBucketActivity_(e));
      case 'toggle_bucket_activity':  return jsonOut_(webToggleBucketActivity_(e));
      case 'delete_bucket_activity':  return jsonOut_(webDeleteBucketActivity_(e));
      case 'flight_statuses':       return jsonOut_(webGetFlightStatuses_(e));
      case 'force_flight_statuses': return jsonOut_(webForceFlightStatuses_(e));
      case 'recommendations':          return jsonOut_(webGetRecommendations_(e));
      case 'generate_recommendations': return jsonOut_(webGenerateRecommendations_(e));
      case 'update_recommendation':    return jsonOut_(webUpdateRecommendation_(e));
      case 'accept_recommendation':    return jsonOut_(webAcceptRecommendation_(e));
      case 'chat':                     return jsonOut_(webProcessChat_(e));
      case 'confirm_enrich':           return jsonOut_(webConfirmEnrich_(e));
      case 'generate_morning_routine': return jsonOut_(webGenerateMorningRoutine_());
      case 'morning_routine':          return jsonOut_(webGetMorningRoutine_());
      case 'morning_routine_toggle':   return jsonOut_(webToggleMorningRoutineItem_(e));
      case 'morning_routine_add':      return jsonOut_(webAddMorningRoutineItem_(e));
      case 'morning_routine_delete':   return jsonOut_(webDeleteMorningRoutineItem_(e));
      case 'morning_routine_move':     return jsonOut_(webMoveMorningRoutineItem_(e));
      case 'gym_log':                  return jsonOut_(webGetGymLog_());
      case 'gym_attend':               return jsonOut_(webLogGymAttend_(e, 'Yes'));
      case 'gym_skip':                 return jsonOut_(webLogGymAttend_(e, 'No'));
      case 'gym_backfill':             return jsonOut_(webGymBackfill_(e));
      case 'purchase_history':         return jsonOut_(webGetPurchaseHistory_());
      case 'log_purchase_run':         return jsonOut_(webLogPurchaseRun_(e));
      case 'purchase_suggestions':     return jsonOut_(webGetPurchaseSuggestions_());
      // Career tab
      case 'career':                     return jsonOut_(webGetCareer_());
      case 'update_career_position':     return jsonOut_(webUpdateCareerPosition_(e));
      case 'add_career_goal':            return jsonOut_(webAddCareerGoal_(e));
      case 'update_career_goal':         return jsonOut_(webUpdateCareerGoal_(e));
      case 'delete_career_goal':         return jsonOut_(webDeleteCareerGoal_(e));
      case 'add_career_progression':     return jsonOut_(webAddCareerProgression_(e));
      case 'delete_career_progression':  return jsonOut_(webDeleteCareerProgression_(e));
      case 'add_career_development':     return jsonOut_(webAddCareerDevelopment_(e));
      case 'update_career_development':  return jsonOut_(webUpdateCareerDevelopment_(e));
      case 'delete_career_development':  return jsonOut_(webDeleteCareerDevelopment_(e));
      case 'add_career_win':             return jsonOut_(webAddCareerWin_(e));
      case 'delete_career_win':          return jsonOut_(webDeleteCareerWin_(e));
      case 'add_career_network':         return jsonOut_(webAddCareerNetwork_(e));
      case 'update_career_network':      return jsonOut_(webUpdateCareerNetwork_(e));
      case 'delete_career_network':      return jsonOut_(webDeleteCareerNetwork_(e));
      // Prescriptions tab (Issue #116)
      case 'prescriptions':              return jsonOut_(webGetPrescriptions_());
      case 'add_prescription':           return jsonOut_(webAddPrescription_(e));
      case 'update_prescription':        return jsonOut_(webUpdatePrescription_(e));
      case 'delete_prescription':        return jsonOut_(webDeletePrescription_(e));
      // Credit Card Hub (Issues #115 + #117)
      case 'cards':                      return jsonOut_(webGetCards_());
      case 'add_card':                   return jsonOut_(webAddCard_(e));
      case 'update_card':                return jsonOut_(webUpdateCard_(e));
      case 'delete_card':                return jsonOut_(webDeleteCard_(e));
      case 'add_card_reward':            return jsonOut_(webAddCardReward_(e));
      case 'update_card_reward':         return jsonOut_(webUpdateCardReward_(e));
      case 'delete_card_reward':         return jsonOut_(webDeleteCardReward_(e));
      case 'add_card_perk':              return jsonOut_(webAddCardPerk_(e));
      case 'delete_card_perk':           return jsonOut_(webDeleteCardPerk_(e));
      case 'toggle_card_perk':           return jsonOut_(webToggleCardPerk_(e));
      case 'add_loyalty_program':        return jsonOut_(webAddLoyaltyProgram_(e));
      case 'update_loyalty_program':     return jsonOut_(webUpdateLoyaltyProgram_(e));
      case 'delete_loyalty_program':     return jsonOut_(webDeleteLoyaltyProgram_(e));
      case 'add_rewards_goal':           return jsonOut_(webAddRewardsGoal_(e));
      case 'update_rewards_goal':        return jsonOut_(webUpdateRewardsGoal_(e));
      case 'delete_rewards_goal':        return jsonOut_(webDeleteRewardsGoal_(e));
      case 'send_travel_briefing':       return jsonOut_(webSendTravelBriefing_(e));
      // Chores — Home Front tab (Issue #124)
      case 'get_chores':    return jsonOut_(webGetChores_());
      case 'add_chore':     return jsonOut_(webAddChore_(e));
      case 'delete_chore':  return jsonOut_(webDeleteChore_(e));
      case 'toggle_chore':  return jsonOut_(webToggleChore_(e));
      case 'update_chore':  return jsonOut_(webUpdateChore_(e));
      // Vehicles — Home Front tab (Issue #125)
      case 'get_vehicles':          return jsonOut_(webGetVehicles_());
      case 'add_vehicle':           return jsonOut_(webAddVehicle_(e));
      case 'delete_vehicle':        return jsonOut_(webDeleteVehicle_(e));
      case 'vehicle_oil_change':    return jsonOut_(webRecordVehicleOilChange_(e));
      case 'vehicle_service':       return jsonOut_(webRecordVehicleService_(e));
      case 'vehicle_mileage':       return jsonOut_(webUpdateVehicleMileage_(e));
      // Traveler Profiles + Visa Check — Travel tab (Issue #123)
      case 'get_profiles':          return jsonOut_(webGetProfiles_());
      case 'save_profile':          return jsonOut_(webSaveProfile_(e.parameter));
      case 'delete_profile':        return jsonOut_(webDeleteProfile_(e.parameter));
      case 'get_visa_requirements': return jsonOut_(webGetVisaRequirements_(e.parameter));
      // Important Dates — People tab (Issue #80)
      case 'get_important_dates':        return jsonOut_(webGetImportantDates_());
      case 'add_important_date':         return jsonOut_(webAddImportantDate_(e));
      case 'update_important_date':      return jsonOut_(webUpdateImportantDate_(e));
      case 'delete_important_date':      return jsonOut_(webDeleteImportantDate_(e));
      case 'preview_calendar_birthdays': return jsonOut_(webPreviewCalendarBirthdays_());
      case 'import_calendar_birthdays':  return jsonOut_(webImportCalendarBirthdays_(e));
      // Gift Ideas — People tab (Issue #105)
      case 'get_gift_data':      return jsonOut_(webGetGiftData_());
      case 'add_gift_person':    return jsonOut_(webAddGiftPerson_(e));
      case 'delete_gift_person': return jsonOut_(webDeleteGiftPerson_(e));
      case 'add_gift_idea':      return jsonOut_(webAddGiftIdea_(e));
      case 'delete_gift_idea':   return jsonOut_(webDeleteGiftIdea_(e));
      default:               return errOut_('Unknown action: ' + action);
    }
  } catch (err) {
    Logger.log('doGet error: ' + err.message + '\n' + err.stack);
    return errOut_('Server error: ' + err.message, 500);
  }
}

// ---- doPost — Telegram webhook + write operations --------------------------

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    return errOut_('Invalid JSON body: ' + parseErr.message);
  }

  // Telegram sends webhook POSTs without a token — detect by update_id field.
  // processTelegramUpdate_ sends "⏳ Thinking..." immediately via UrlFetchApp so
  // the user sees instant feedback, then edits the message with Claude's real answer.
  // Deduplication (CacheService) inside processTelegramUpdate_ prevents retry loops.
  if (body && body.update_id !== undefined) {
    // Return 200 OK immediately so Telegram never times out waiting for Claude.
    // Queue the update in ScriptCache and fire a one-shot trigger to process it.
    // Without this, the 10-20s Claude call causes Telegram to retry the delivery,
    // creating concurrent executions that result in a 302 on the next message.
    try {
      var sc  = CacheService.getScriptCache();
      var qId = String(body.update_id);
      sc.put('TG_Q_' + qId, JSON.stringify(body), 120);
      var existing = sc.get('TG_Q_IDS') || '';
      sc.put('TG_Q_IDS', existing ? existing + ',' + qId : qId, 120);
      // One trigger at a time — delete any existing queue trigger first
      ScriptApp.getProjectTriggers().forEach(function(t) {
        if (t.getHandlerFunction() === 'processTelegramQueue_') ScriptApp.deleteTrigger(t);
      });
      ScriptApp.newTrigger('processTelegramQueue_').timeBased().after(100).create();
    } catch (qErr) {
      // Fallback: process synchronously if queuing/trigger creation fails
      Logger.log('Queue fallback (sync): ' + qErr.message);
      try { processTelegramUpdate_(body); } catch (e) { Logger.log('Sync error: ' + e.message); }
    }
    return jsonOut_({ ok: true });
  }

  // VERA dashboard actions require auth
  if (!isAuthorized_(e)) return errOut_('Unauthorized', 401);

  const action = body && body.action;

  try {
    switch (action) {
      case 'chat':                       return jsonOut_(webProcessChat_(body));
      case 'acknowledge':                return jsonOut_(webAcknowledge_(body.id));
      case 'snooze':                     return jsonOut_(webSnooze_(body.id, body.days));
      case 'resolve':                    return jsonOut_(webResolve_(body.id));
      // Takeouts (Issue #112)
      case 'add_takeout_restaurant':     return jsonOut_(webAddTakeoutRestaurant_(body));
      case 'delete_takeout_restaurant':  return jsonOut_(webDeleteTakeoutRestaurant_(body));
      case 'add_takeout_item':           return jsonOut_(webAddTakeoutItem_(body));
      case 'delete_takeout_item':        return jsonOut_(webDeleteTakeoutItem_(body));
      // Purchase History (Issue #111)
      case 'log_purchase_run':           return jsonOut_(webLogPurchaseRun_(body));
      default:                           return errOut_('Unknown action: ' + action);
    }
  } catch (err) {
    Logger.log('doPost error: ' + err.message + '\n' + err.stack);
    return errOut_('Server error: ' + err.message, 500);
  }
}

// ============================================================
// READ HANDLERS
// ============================================================

// ---- Status ----------------------------------------------------------------

function webGetStatus_() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.FLAGS);

  // Read all travel_* keys from Config tab into a travelConfig map
  // Supports: travel_transit_buffer, travel_customs_buffer,
  //           travel_transit_buffer_IAD, travel_customs_buffer_DCA, etc.
  var travelConfig = { transit_buffer: 120, customs_buffer: 60 };
  try {
    var cfgSheet = ss.getSheetByName(TABS.CONFIG);
    if (cfgSheet) {
      var cfgData = cfgSheet.getDataRange().getValues();
      for (var ci = 0; ci < cfgData.length; ci++) {
        var cfgKey = String(cfgData[ci][0]).trim();
        var cfgVal = parseInt(String(cfgData[ci][1]).trim(), 10);
        if (cfgKey.indexOf('travel_') === 0 && !isNaN(cfgVal)) {
          // strip 'travel_' prefix → e.g. 'transit_buffer', 'transit_buffer_IAD'
          travelConfig[cfgKey.substring(7)] = cfgVal;
        }
      }
    }
  } catch(e) {}

  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: true, totalFlags: 0, activeFlags: 0, high: 0, medium: 0, low: 0, lastRun: null,
             travelConfig: travelConfig };
  }

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();
  const all     = data.filter(function(r) { return r[0] !== ''; });

  const active = all.filter(function(r) {
    return String(r[6]).toLowerCase() !== 'yes' &&
           String(r[8]).toLowerCase() !== 'yes';
  });

  // Most recent flag date = last run approximation
  const lastRun = all.length > 0 ? all[all.length - 1][1] : null;

  return {
    ok:             true,
    totalFlags:     all.length,
    activeFlags:    active.length,
    high:           active.filter(function(r) { return r[5] === 'High';   }).length,
    medium:         active.filter(function(r) { return r[5] === 'Medium'; }).length,
    low:            active.filter(function(r) { return r[5] === 'Low';    }).length,
    lastRun:      formatDateVal_(lastRun),
    travelConfig: travelConfig,
  };
}

// ---- Flags -----------------------------------------------------------------

function webGetFlags_(e) {
  const filter = e.parameter && e.parameter.filter; // 'active' or omit for all
  const ss     = getSpreadsheet();
  const sheet  = ss.getSheetByName(TABS.FLAGS);

  if (!sheet || sheet.getLastRow() < 2) return { ok: true, flags: [] };

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();
  let rows      = data.filter(function(r) { return r[0] !== ''; });

  if (filter === 'active') {
    rows = rows.filter(function(r) {
      return String(r[6]).toLowerCase() !== 'yes' &&
             String(r[8]).toLowerCase() !== 'yes';
    });
  }

  const flags = rows.map(function(r) {
    return {
      id:           String(r[0]),
      date:         formatDateVal_(r[1]),
      source:       String(r[2] || ''),
      flag:         String(r[3] || ''),
      reason:       String(r[4] || ''),
      urgency:      String(r[5] || 'Low'),
      acknowledged: String(r[6]).toLowerCase() === 'yes',
      snoozedUntil: formatDateVal_(r[7]),
      resolved:     String(r[8]).toLowerCase() === 'yes',
      key:          String(r[9] || ''),
    };
  });

  return { ok: true, count: flags.length, flags: flags };
}

// ---- Tasks -----------------------------------------------------------------

function webGetTasks_() {
  const tasks = getOpenTasks(); // reuse Tasks.js
  return { ok: true, count: tasks.length, tasks: tasks };
}

// ---- Summaries -------------------------------------------------------------

function webGetSummaries_() {
  // Read Summaries tab only (life intelligence: SAT, Transactions, external sheets).
  // Metrics tab (VERA's internal counts) is intentionally excluded from the dashboard.
  const ss        = getSpreadsheet();
  const summaries = readSummaryTab_(ss, TABS.SUMMARIES);
  return { ok: true, count: summaries.length, summaries: summaries };
}

// ============================================================
// WRITE HANDLERS
// ============================================================

// ---- Find a flag row by ID -------------------------------------------------

function findFlagRow_(id) {
  if (!id) throw new Error('Missing flag ID');

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.FLAGS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Flags sheet is empty');

  const numRows = sheet.getLastRow() - 1;
  const ids     = sheet.getRange(2, 1, numRows, 1).getValues();

  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) {
      return { sheet: sheet, rowNum: i + 2 };
    }
  }
  throw new Error('Flag not found: ' + id);
}

// ---- Acknowledge -----------------------------------------------------------

function webAcknowledge_(id) {
  const found = findFlagRow_(id);
  found.sheet.getRange(found.rowNum, 7).setValue('Yes'); // Column G

  // Signal Learning: record outcome so VERA can learn from user engagement
  try {
    const flagKey = found.sheet.getRange(found.rowNum, 10).getValue(); // Column J: Key
    if (flagKey) recordFlagOutcome_(String(flagKey), 'acknowledged');
  } catch (slErr) {
    Logger.log('SignalLearning: ack hook error (non-fatal) — ' + slErr.message);
  }

  return { ok: true, id: id, action: 'acknowledged' };
}

// ---- Snooze ----------------------------------------------------------------

function webSnooze_(id, days) {
  const found     = findFlagRow_(id);
  const snoozeFor = Math.max(1, parseInt(days, 10) || 2);
  const until     = new Date();
  until.setDate(until.getDate() + snoozeFor);
  const untilStr  = Utilities.formatDate(until, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  found.sheet.getRange(found.rowNum, 8).setValue(untilStr); // Column H

  // Signal Learning: record outcome
  try {
    const flagKey = found.sheet.getRange(found.rowNum, 10).getValue(); // Column J: Key
    if (flagKey) recordFlagOutcome_(String(flagKey), 'snoozed');
  } catch (slErr) {
    Logger.log('SignalLearning: snooze hook error (non-fatal) — ' + slErr.message);
  }

  return { ok: true, id: id, action: 'snoozed', snoozedUntil: untilStr };
}

// ---- Resolve ---------------------------------------------------------------

function webResolve_(id) {
  const found = findFlagRow_(id);
  found.sheet.getRange(found.rowNum, 9).setValue('Yes'); // Column I

  // Signal Learning: record outcome
  try {
    const flagKey = found.sheet.getRange(found.rowNum, 10).getValue(); // Column J: Key
    if (flagKey) recordFlagOutcome_(String(flagKey), 'resolved');
  } catch (slErr) {
    Logger.log('SignalLearning: resolve hook error (non-fatal) — ' + slErr.message);
  }

  return { ok: true, id: id, action: 'resolved' };
}

// ---- Complete task ----------------------------------------------------------

function findTaskRow_(id) {
  if (!id) throw new Error('Missing task ID');

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.TASKS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Tasks sheet is empty');

  // Row-based fallback ID (tasks without a Column A value get TASK-R{sheetRow})
  if (String(id).indexOf('TASK-R') === 0) {
    const rowNum = parseInt(String(id).substring(6), 10);
    if (!isNaN(rowNum) && rowNum >= 2) return { sheet: sheet, rowNum: rowNum };
    throw new Error('Invalid row-based task ID: ' + id);
  }

  // Normal: search Column A for the explicit ID
  const numRows = sheet.getLastRow() - 1;
  const ids     = sheet.getRange(2, 1, numRows, 1).getValues();

  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) {
      return { sheet: sheet, rowNum: i + 2 };
    }
  }
  throw new Error('Task not found: ' + id);
}

// ---- Recurring helper — compute next due date from a frequency string --------
/**
 * Given a base date and a recurring frequency string, returns the next Date.
 * Understands: Daily, Weekly, Bi-Weekly, Monthly, Quarterly, Semi-Annual,
 * Yearly/Annual, "Every N days/weeks/months", and plain "N days/weeks/months".
 * Returns null if the recurring string is empty or unrecognised as recurring.
 */
function computeNextDueDate_(fromDate, recurringStr) {
  var s = String(recurringStr || '').trim().toLowerCase();
  if (!s || s === 'no' || s === 'false' || s === '0') return null;

  var base = fromDate instanceof Date ? new Date(fromDate) : new Date();
  base.setHours(0, 0, 0, 0);
  var next = new Date(base);

  if (s === 'daily') {
    next.setDate(next.getDate() + 1);
  } else if (s === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else if (s === 'bi-weekly' || s === 'biweekly' || s === 'every 2 weeks' || s === 'fortnightly') {
    next.setDate(next.getDate() + 14);
  } else if (s === 'monthly') {
    next.setMonth(next.getMonth() + 1);
  } else if (s === 'quarterly' || s === 'every 3 months') {
    next.setMonth(next.getMonth() + 3);
  } else if (s === 'semi-annual' || s === 'semi annual' || s === 'every 6 months') {
    next.setMonth(next.getMonth() + 6);
  } else if (s === 'yearly' || s === 'annual' || s === 'annually' || s === 'every year') {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    // "every N days/weeks/months" or "N days/weeks/months"
    var m;
    if ((m = s.match(/^(?:every\s+)?(\d+)\s*days?$/))) {
      next.setDate(next.getDate() + parseInt(m[1]));
    } else if ((m = s.match(/^(?:every\s+)?(\d+)\s*weeks?$/))) {
      next.setDate(next.getDate() + parseInt(m[1]) * 7);
    } else if ((m = s.match(/^(?:every\s+)?(\d+)\s*months?$/))) {
      next.setMonth(next.getMonth() + parseInt(m[1]));
    } else {
      // Unknown string but non-empty — treat as monthly
      next.setMonth(next.getMonth() + 1);
    }
  }
  return next;
}

function webCompleteTask_(id) {
  const found = findTaskRow_(id);
  found.sheet.getRange(found.rowNum, 5).setValue('Done'); // Column E = Status

  // ---- Auto-regenerate if recurring --------------------------------------
  // TASK_HEADERS: ID(1) | Task(2) | Added Date(3) | Due Date(4) | Status(5) | Recurring(6) | Notes(7) | Flagged(8)
  const rowData      = found.sheet.getRange(found.rowNum, 1, 1, TASK_HEADERS.length).getValues()[0];
  const taskText     = String(rowData[1] || '').trim();
  const dueRaw       = rowData[3];
  const recurringVal = String(rowData[5] || '').trim();
  const notes        = String(rowData[6] || '').trim();

  const isRecurring = recurringVal !== '' &&
    recurringVal.toLowerCase() !== 'no' &&
    recurringVal.toLowerCase() !== 'false' &&
    recurringVal !== '0';

  if (!isRecurring || !taskText) {
    return { ok: true, id: id, action: 'completed' };
  }

  const tz      = Session.getScriptTimeZone();
  const today   = new Date(); today.setHours(0, 0, 0, 0);
  const baseDate = dueRaw ? new Date(dueRaw) : today;
  // If original due date has already passed, advance from today instead
  const fromDate = baseDate < today ? today : baseDate;
  const nextDate = computeNextDueDate_(fromDate, recurringVal);

  if (!nextDate) {
    return { ok: true, id: id, action: 'completed' };
  }

  const nextDateStr = Utilities.formatDate(nextDate, tz, 'yyyy-MM-dd');
  const todayStr    = Utilities.formatDate(today,    tz, 'yyyy-MM-dd');
  const dateKey     = Utilities.formatDate(today,    tz, 'yyyyMMdd');

  // Generate new task ID
  const sheet   = found.sheet;
  const lastRow = sheet.getLastRow();
  let seq = 1;
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(r) {
      if (String(r[0] || '').indexOf('TASK-' + dateKey) === 0) seq++;
    });
  }
  const newId = 'TASK-' + dateKey + '-' + String(seq).padStart(2, '0');

  // Append the regenerated task
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, TASK_HEADERS.length).setValues([[
    newId, taskText, todayStr, nextDateStr, 'Open', recurringVal, notes, ''
  ]]);

  return { ok: true, id: id, action: 'completed', recurring: true, nextTaskId: newId, nextDueDate: nextDateStr };
}

function webDeleteTask_(id) {
  const found = findTaskRow_(id);
  found.sheet.deleteRow(found.rowNum);
  return { ok: true, id: id, action: 'deleted' };
}

// ---- Add / Update task -----------------------------------------------------

function webAddTask_(e) {
  const taskText  = ((e.parameter && e.parameter.task)      || '').trim();
  const dueDate   =  (e.parameter && e.parameter.dueDate)   || '';
  const notes     =  (e.parameter && e.parameter.notes)     || '';
  const recurring =  (e.parameter && e.parameter.recurring) || '';
  if (!taskText) throw new Error('Task text is required');

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.TASKS);
  if (!sheet) throw new Error('Tasks sheet not found');

  // Generate ID: TASK-YYYYMMDD-NN
  const tz       = Session.getScriptTimeZone();
  const today    = new Date();
  const dateStr  = Utilities.formatDate(today, tz, 'yyyyMMdd');
  const addedStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  let seq = 1;
  if (sheet.getLastRow() >= 2) {
    const idData = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    idData.forEach(function(r) {
      if (String(r[0] || '').indexOf('TASK-' + dateStr) === 0) seq++;
    });
  }
  const taskId = 'TASK-' + dateStr + '-' + String(seq).padStart(2, '0');

  // TASK_HEADERS: ID | Task | Added Date | Due Date | Status | Recurring | Notes | Flagged
  const row = [taskId, taskText, addedStr, dueDate, 'Open', recurring, notes, ''];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, TASK_HEADERS.length).setValues([row]);

  return { ok: true, id: taskId, action: 'created' };
}

function webUpdateTask_(e) {
  const id      = (e.parameter && e.parameter.id)      || '';
  const found   = findTaskRow_(id);

  // TASK_HEADERS: ID(1) | Task(2) | Added Date(3) | Due Date(4) | Status(5) | Recurring(6) | Notes(7) | Flagged(8)
  if (e.parameter.task      != null) found.sheet.getRange(found.rowNum, 2).setValue(e.parameter.task);
  if (e.parameter.dueDate   != null) found.sheet.getRange(found.rowNum, 4).setValue(e.parameter.dueDate);
  if (e.parameter.status    != null) found.sheet.getRange(found.rowNum, 5).setValue(e.parameter.status);
  if (e.parameter.recurring != null) found.sheet.getRange(found.rowNum, 6).setValue(e.parameter.recurring);
  if (e.parameter.notes     != null) found.sheet.getRange(found.rowNum, 7).setValue(e.parameter.notes);

  return { ok: true, id: id, action: 'updated' };
}

// ---- Shopping --------------------------------------------------------------

function webGetShopping_() {
  const stores = getShoppingList_();
  return { ok: true, count: stores.length, stores: stores };
}

function webToggleShoppingItem_(e) {
  const tabId = (e.parameter && e.parameter.tabId) || '';
  const index = (e.parameter && e.parameter.index) || 0;
  return toggleShoppingItem_(tabId, index);
}

function webAddShoppingItem_(e) {
  const tabId = ((e.parameter && e.parameter.tabId) || '').trim();
  const text  = ((e.parameter && e.parameter.text)  || '').trim();
  if (!tabId || !text) throw new Error('tabId and text are required.');
  return addShoppingItem_(tabId, text);
}

function webDeleteShoppingItem_(e) {
  const tabId = (e.parameter && e.parameter.tabId) || '';
  const index = (e.parameter && e.parameter.index) || 0;
  return deleteShoppingItem_(tabId, index);
}

function webUpdateShoppingItem_(e) {
  const tabId = (e.parameter && e.parameter.tabId) || '';
  const index = (e.parameter && e.parameter.index) || 0;
  const text  = ((e.parameter && e.parameter.text) || '').trim();
  if (!text) throw new Error('text is required');
  return updateShoppingItem_(tabId, index, text);
}

// ---- Projects --------------------------------------------------------------

function webGetProjects_() {
  const projects = getProjects_();
  return { ok: true, count: projects.length, projects: projects };
}

function webCompleteProjectTask_(rowNum) {
  return completeProjectTask_(rowNum);
}

function webAddProjectTask_(e) {
  var projectId = ((e.parameter && e.parameter.projectId) || '').trim();
  var taskText  = ((e.parameter && e.parameter.task)      || '').trim();
  var priority  = ((e.parameter && e.parameter.priority)  || 'Medium').trim();
  var dueDate   =  (e.parameter && e.parameter.dueDate)   || '';
  var notes     =  (e.parameter && e.parameter.notes)     || '';
  if (!projectId) throw new Error('projectId is required');
  if (!taskText)  throw new Error('Task text is required');

  var sheet = getSpreadsheet().getSheetByName(TABS.PROJECTS);
  if (!sheet) throw new Error('Projects tab not found');

  // Look up project name from existing rows
  var projectName = '';
  if (sheet.getLastRow() >= 2) {
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === projectId) { projectName = data[i][1]; break; }
    }
  }
  if (!projectName) throw new Error('Project not found: ' + projectId);

  // PROJECT_HEADERS: Project ID | Project Name | Task | Status | Priority | Due Date | Notes
  var row = [projectId, projectName, taskText, 'Pending', priority, dueDate, notes];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, PROJECT_HEADERS.length).setValues([row]);
  return { ok: true, projectId: projectId, action: 'created' };
}

function webUpdateProjectTask_(e) {
  var rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row: ' + e.parameter.row);

  var sheet = getSpreadsheet().getSheetByName(TABS.PROJECTS);
  if (!sheet) throw new Error('Projects tab not found');

  // PROJ_COL is 0-indexed; sheet columns are 1-indexed (PROJ_COL.X + 1)
  if (e.parameter.task     != null) sheet.getRange(rowNum, PROJ_COL.TASK     + 1).setValue(e.parameter.task);
  if (e.parameter.priority != null) sheet.getRange(rowNum, PROJ_COL.PRIORITY + 1).setValue(e.parameter.priority);
  if (e.parameter.dueDate  != null) sheet.getRange(rowNum, PROJ_COL.DUE      + 1).setValue(e.parameter.dueDate);
  if (e.parameter.notes    != null) sheet.getRange(rowNum, PROJ_COL.NOTES    + 1).setValue(e.parameter.notes);

  return { ok: true, rowNum: rowNum, action: 'updated' };
}

function webDeleteProjectTask_(e) {
  var rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row: ' + e.parameter.row);

  var sheet = getSpreadsheet().getSheetByName(TABS.PROJECTS);
  if (!sheet) throw new Error('Projects tab not found');

  sheet.deleteRow(rowNum);
  return { ok: true, rowNum: rowNum, action: 'deleted' };
}

// ---- PTO -------------------------------------------------------------------

/**
 * Returns live PTO stats computed fresh from Google Calendar.
 * Called by the 🌴 PTO tab on dashboard open.
 */
function webGetPTO_() {
  var cfg      = readPTOConfig_();
  var ptoResult = getPTOEvents_(cfg);
  var travel   = getUpcomingTravel_(cfg);
  var gapCals  = getGapCalendars_(cfg);
  var today    = new Date();
  var stats    = computePTOStats_(ptoResult, cfg, today);

  // Attach live clear windows + milestones (may have changed since last nightly run)
  stats.clearWindows  = findClearWindows_(gapCals, today, 90, 3);
  stats.milestones    = getMilestones_(gapCals, cfg, today);
  stats.upcomingTravel = travel;

  return { ok: true, stats: stats };
}

/**
 * Decrements the PTO buffer-remaining count in the Config tab by 1.
 * Called when Ahmed clicks "Trigger a Buffer Day" in the dashboard.
 * Returns the new remaining count and the date triggered.
 */
function webTriggerBuffer_(e) {
  var cfg       = readPTOConfig_();
  var current   = readPTOBufferRemaining_(cfg);

  if (current <= 0) {
    return { ok: false, error: 'No buffer days remaining.', remaining: 0 };
  }

  var newVal = current - 1;
  setPTOBufferRemaining_(newVal);

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  Logger.log('PTO Buffer Day triggered. Remaining: ' + newVal + '. Date: ' + today);

  return { ok: true, remaining: newVal, triggeredOn: today };
}

// ---- Budget (Simple Ass Tracker) -------------------------------------------

/**
 * Reads the entire Budget tab from Simple Ass Tracker and returns structured rows.
 * Col A = label, Col B = value (empty → section header), Col C = Ahmed, Col D = Victoria.
 * SAT_SHEET_ID must be set in Script Properties.
 */
function webGetBudget_() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SAT_SHEET_ID');
  if (!sheetId) return { ok: true, rows: [], configured: false };

  try {
    var ss    = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('Budget');
    if (!sheet) return { ok: true, rows: [], configured: false, error: 'Budget tab not found' };

    var lastRow = sheet.getLastRow();
    if (lastRow < 1) return { ok: true, rows: [], configured: true };

    var numCols = Math.min(sheet.getLastColumn(), 4); // A-D: label, value, ahmed, victoria
    var data    = sheet.getRange(1, 1, lastRow, numCols).getValues();

    var rows = [];
    data.forEach(function(row) {
      var label = String(row[0] || '').trim();
      if (!label) return; // skip fully empty rows
      rows.push({
        label:    label,
        value:    (row.length > 1 && row[1] !== '') ? row[1] : null,
        ahmed:    (row.length > 2 && row[2] !== '') ? row[2] : null,
        victoria: (row.length > 3 && row[3] !== '') ? row[3] : null,
      });
    });

    return { ok: true, rows: rows, configured: true };
  } catch (err) {
    Logger.log('webGetBudget_ error: ' + err.message);
    return { ok: false, error: err.message, rows: [] };
  }
}

// ---- Bills (Issue #57) -----------------------------------------------------

/**
 * Global pre-assignment: builds a map from bill index → matched transaction.
 * Scores ALL (bill, tx) candidate pairs first, then assigns best pairs greedily
 * (highest score, lowest amtDiff) so two similar bills never fight over the
 * same transaction.
 *
 * Score legend:
 *   3 = description match + exact amount (≤$1 diff)
 *   2 = description match + near amount (≤20%)
 *   1 = description match only
 *   0 = amount-only match (≤20%)
 *
 * @param  {Array}  billRows — raw sheet rows (same order as data.forEach)
 * @param  {Array}  txList   — from getTransactionMatchMap_()
 * @param  {Object} aliasMap — from getConfigAliases_() (may be undefined)
 * @return {Object} { billIdx: { description, amount } }
 */
function buildTxMatchMap_(billRows, txList, aliasMap) {
  aliasMap = aliasMap || {};
  var pairs = [];

  billRows.forEach(function(row, bIdx) {
    var billName = String(row[0] || '').trim();
    if (!billName) return;
    var billAmt = row[1] !== '' ? Number(row[1]) : null;
    var nameLow = billName.toLowerCase();
    var words   = nameLow.split(/\s+/).filter(function(w) { return w.length > 3; });
    var aliasKws = Object.keys(aliasMap).filter(function(kw) {
      return aliasMap[kw].toLowerCase() === nameLow;
    });

    txList.forEach(function(tx, tIdx) {
      var descLow   = tx.description; // already lowercased
      var descMatch = false;

      // Alias match
      for (var a = 0; a < aliasKws.length; a++) {
        if (descLow.indexOf(aliasKws[a]) !== -1) { descMatch = true; break; }
      }
      // Bill name ⊆ description
      if (!descMatch && descLow.indexOf(nameLow) !== -1) descMatch = true;
      // Description ⊆ bill name
      if (!descMatch && nameLow.indexOf(descLow) !== -1) descMatch = true;
      // Any significant word from bill name in description
      if (!descMatch) {
        for (var w = 0; w < words.length; w++) {
          if (descLow.indexOf(words[w]) !== -1) { descMatch = true; break; }
        }
      }

      // Account-name matching — same 4-tier rules applied to tx.account (column B)
      // Catches credit-card payment rows where the account IS the card name
      // e.g. bill "Bilt World Elite Mastercard" matches account "Bilt World Elite Mastercard - Ending in 2335"
      var acctLow   = tx.account || '';
      var acctMatch = false;
      for (var aa = 0; aa < aliasKws.length; aa++) {
        if (acctLow.indexOf(aliasKws[aa]) !== -1) { acctMatch = true; break; }
      }
      if (!acctMatch && acctLow.indexOf(nameLow) !== -1) acctMatch = true; // bill name ⊆ account
      if (!acctMatch && nameLow.indexOf(acctLow) !== -1) acctMatch = true; // account ⊆ bill name
      if (!acctMatch) {
        for (var wa = 0; wa < words.length; wa++) {
          if (acctLow.indexOf(words[wa]) !== -1) { acctMatch = true; break; }
        }
      }

      var nameMatch = descMatch || acctMatch;
      var txAbsAmt = Math.abs(tx.amount);
      var amtDiff  = billAmt != null ? Math.abs(txAbsAmt - billAmt) : Infinity;
      var amtPct   = billAmt != null && billAmt !== 0 ? amtDiff / billAmt : Infinity;
      var amtMatch = amtPct <= 0.20;
      if (!nameMatch && !amtMatch) return;

      // Hard reject: if bill has a known amount and the transaction is >5× off,
      // don't show it at all (prevents e.g. "Verizon Internet Bill" $49.99 matching
      // a $3,775 transaction just because "bill" is a word in both)
      if (billAmt != null && billAmt > 0 && txAbsAmt > billAmt * 5 && !amtMatch) return;

      var exactAmt = billAmt != null && amtDiff <= 1;

      // Score 4: CC autopay keyword in description + name match + exact amount.
      // "Automatic Payment" / "Autopay Payment" / "Autopay" exclusively appear on
      // credit card payment transactions — this ensures the card's own payment record
      // always beats a generic description match on the same bill.
      var isCCAutopay = descLow.indexOf('automatic payment') !== -1 ||
                        descLow.indexOf('autopay payment')   !== -1 ||
                        descLow.indexOf('autopay')           !== -1;
      var score;
      if (nameMatch && isCCAutopay && exactAmt) score = 4; // CC autopay + name + exact → highest
      else if (nameMatch && exactAmt)           score = 3;
      else if (nameMatch && isCCAutopay && amtMatch) score = 3; // CC autopay + name + near
      else if (nameMatch && amtMatch)           score = 2;
      else if (nameMatch)                       score = 1;
      else                                      score = 0; // amount-only
      pairs.push({ bIdx: bIdx, tIdx: tIdx, score: score, amtDiff: amtDiff });
    });
  });

  // Sort: highest score first, then lowest amtDiff (tightest amount match)
  pairs.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.amtDiff - b.amtDiff;
  });

  // Step A: collect ALL scored candidates per bill before greedy assignment.
  // pairs is already sorted best-first, so allCandidatesMap[bIdx][0] is the
  // highest-quality match for that bill regardless of conflicts with other bills.
  var allCandidatesMap = {};
  pairs.forEach(function(pair) {
    if (!allCandidatesMap[pair.bIdx]) allCandidatesMap[pair.bIdx] = [];
    var tx = txList[pair.tIdx];
    allCandidatesMap[pair.bIdx].push({
      description: tx.rawDescription || tx.rawAccount,
      amount:      tx.amount
    });
  });

  // Step B: greedy assign — each bill index and tx index claimed at most once
  var usedBills = {}, usedTxs = {}, result = {};
  pairs.forEach(function(pair) {
    if (usedBills[pair.bIdx] || usedTxs[pair.tIdx]) return;
    usedBills[pair.bIdx] = true;
    usedTxs[pair.tIdx]   = true;
    var tx = txList[pair.tIdx];
    result[pair.bIdx] = {
      // Prefer raw description; fall back to account name (for CC payment rows
      // where description is generic "Automatic Payment - Thank You")
      description: tx.rawDescription || tx.rawAccount,
      amount:      tx.amount,
      candidates:  allCandidatesMap[pair.bIdx] || []  // full sorted list for chip cycling
    };
  });
  return result;
}

/**
 * Returns all rows from the Bills tab in the Life OS sheet.
 * Columns: A=Bill, B=Amount, C=Due Day, D=Frequency, E=Category,
 *          F=Account, G=Paid (YYYY-MM), H=Notes
 * paid = true when Paid column equals current YYYY-MM (auto-resets each month).
 */
function webGetBills_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BILLS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, bills: [] };

  var numRows = sheet.getLastRow() - 1;
  // Read up to BILL_HEADERS.length cols; graceful if Type col not yet added
  var numCols = Math.min(sheet.getLastColumn(), BILL_HEADERS.length);
  var data    = sheet.getRange(2, 1, numRows, numCols).getValues();

  var tz        = Session.getScriptTimeZone();
  var currMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  var txList    = getTransactionMatchMap_(currMonth); // [] if TRANSACTIONS_SHEET_ID not set
  var aliasMap  = getConfigAliases_();               // { keyword: 'Bill Name', ... }

  var matchMap = buildTxMatchMap_(data, txList, aliasMap);

  var bills = [];
  data.forEach(function(row, idx) {
    var bill = String(row[0] || '').trim();
    if (!bill) return;
    var paidVal = String(row[6] || '').trim();
    bills.push({
      row:       idx + 2,
      bill:      bill,
      amount:    row[1] !== '' ? Number(row[1]) : null,
      dueDay:    row[2] !== '' ? Number(row[2]) : null,
      frequency: String(row[3] || 'Monthly').trim(),
      category:  String(row[4] || '').trim(),
      account:   String(row[5] || '').trim(),
      paid:      paidVal === currMonth,
      notes:     String(row[7] || '').trim(),
      type:      String(row[8] || 'Expense').trim() || 'Expense', // 'Expense'|'Income'
      txMatch:      matchMap[idx] ? { description: matchMap[idx].description, amount: matchMap[idx].amount } : null,
      txCandidates: matchMap[idx] ? (matchMap[idx].candidates || []) : [],
    });
  });

  return { ok: true, bills: bills, currentMonth: currMonth };
}

/**
 * Toggles the Paid status of a bill for the current month.
 * If already paid this month → clears the field.
 * If not paid → sets to current YYYY-MM.
 */
function webToggleBill_(e) {
  var rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row: ' + e.parameter.row);

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BILLS);
  if (!sheet) throw new Error('Bills tab not found');

  var tz        = Session.getScriptTimeZone();
  var currMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');

  var cell    = sheet.getRange(rowNum, 7); // Column G = Paid
  var current = String(cell.getValue() || '').trim();
  var newVal  = (current === currMonth) ? '' : currMonth;

  cell.setValue(newVal);
  SpreadsheetApp.flush(); // ensure write is committed before caller reads it back
  return { ok: true, row: rowNum, paid: newVal !== '' };
}

/**
 * For every Bills sheet row where a transaction match is found AND the bill is
 * not already paid for the current month, writes the current YYYY-MM to the
 * Paid column. Idempotent — safe to call multiple times.
 * Returns { ok: true, synced: N }.
 */
function webSyncBillsFromTransactions_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BILLS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, synced: 0 };

  var tz        = Session.getScriptTimeZone();
  var currMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  var numRows   = sheet.getLastRow() - 1;
  var numCols   = Math.min(sheet.getLastColumn(), BILL_HEADERS.length);
  var data      = sheet.getRange(2, 1, numRows, numCols).getValues();
  var txList    = getTransactionMatchMap_(currMonth);
  var aliasMap  = getConfigAliases_();
  var synced    = 0;

  var matchMap = buildTxMatchMap_(data, txList, aliasMap);

  data.forEach(function(row, idx) {
    var bill    = String(row[0] || '').trim();
    if (!bill) return;
    var paidVal = String(row[6] || '').trim();
    if (paidVal === currMonth) return; // already paid this month
    if (!matchMap[idx]) return;

    sheet.getRange(idx + 2, 7).setValue(currMonth); // Column G = Paid
    synced++;
  });

  return { ok: true, synced: synced };
}

function webAddBill_(e) {
  const p        = e.parameter || {};
  const billName = (p.bill || p.name || '').trim();
  if (!billName) throw new Error('Bill name is required');
  const sheet = getSpreadsheet().getSheetByName(TABS.BILLS);
  if (!sheet) throw new Error('Bills tab not found');
  // BILL_HEADERS: Bill | Amount | Due Day | Frequency | Category | Account | Paid | Notes | Type
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, BILL_HEADERS.length).setValues([[
    billName,
    p.amount  !== undefined ? (Number(p.amount)  || '') : '',
    p.dueDay  !== undefined ? (Number(p.dueDay)  || '') : '',
    (p.frequency || 'Monthly').trim(),
    (p.category  || '').trim(),
    (p.account   || '').trim(),
    '',
    (p.notes     || '').trim(),
    (p.type      || 'Expense').trim(),  // 'Expense' | 'Income'
  ]]);
  return { ok: true, bill: billName, action: 'created' };
}

function webDeleteBill_(e) {
  var row = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (!row) return { ok: false, error: 'Missing row' };
  var sheet = getSpreadsheet().getSheetByName(TABS.BILLS);
  if (!sheet) return { ok: false, error: 'Bills tab not found' };
  if (row < 2 || row > sheet.getLastRow()) return { ok: false, error: 'Row out of range' };
  sheet.deleteRow(row);
  return { ok: true, deleted: row };
}

// ---- Transaction Matching Helpers ------------------------------------------

/**
 * Reads current-month transactions from the Transactions sheet and returns a
 * flat list of { description (lowercased), rawDescription, amount } objects.
 * Returns [] gracefully if TRANSACTIONS_SHEET_ID is not set or sheet is inaccessible.
 */
function getTransactionMatchMap_(currMonth) {
  var id = PropertiesService.getScriptProperties().getProperty('TRANSACTIONS_SHEET_ID');
  if (!id) return [];

  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { Logger.log('Bills txMatch: cannot open TRANSACTIONS_SHEET_ID — ' + e.message); return []; }

  // Support per-person tabs (new) and legacy single tab — mirrors Finance.js pattern
  var sheetA = ss.getSheetByName('Transactions - Ahmed');
  var sheetV = ss.getSheetByName('Transactions - Victoria');
  var rawRows = [];

  function readTab(sheet) {
    if (!sheet || sheet.getLastRow() < 2) return;
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
    rows.forEach(function(r) { rawRows.push(r); });
  }

  if (sheetA || sheetV) {
    readTab(sheetA);
    readTab(sheetV);
  } else {
    readTab(ss.getSheetByName('Transactions'));
  }

  // Columns: Date(0) | Account(1) | Description(2) | Category(3) | Tags(4) | Amount(5)
  var tz = Session.getScriptTimeZone();
  var txList = [];
  rawRows.forEach(function(row) {
    var dateVal = row[0];
    var dateStr = '';
    if (dateVal instanceof Date) {
      dateStr = Utilities.formatDate(dateVal, tz, 'yyyy-MM');
    } else {
      dateStr = String(dateVal || '').slice(0, 7);
    }
    if (dateStr !== currMonth) return;

    var desc   = String(row[2] || '').trim();
    var amount = parseFloat(String(row[5]).replace(/[$,]/g, ''));
    if (!desc || isNaN(amount)) return;

    var acct = String(row[1] || '').trim();
    txList.push({
      description:    desc.toLowerCase(),
      rawDescription: desc,
      amount:         amount,
      account:        acct.toLowerCase(),
      rawAccount:     acct,
    });
  });
  return txList;
}

/**
 * Returns current-month transactions for the bill tracker's "link transaction" picker.
 * Provides description + amount for each tx so the user can manually map a bill to a tx.
 */
function webGetTxList_() {
  var tz        = Session.getScriptTimeZone();
  var currMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  var txList    = getTransactionMatchMap_(currMonth);
  return {
    ok: true,
    transactions: txList.map(function(tx) {
      return { description: tx.rawDescription || tx.rawAccount, amount: tx.amount };
    })
  };
}

/**
 * Returns the first transaction in txList whose description matches billName,
 * using three progressively broader rules (all case-insensitive):
 *   1. Bill name is a substring of the transaction description
 *   2. Transaction description is a substring of the bill name
 *   3. Any word in the bill name that is >3 chars appears in the transaction description
 * Returns { description, amount } or null.
 */
/**
 * Resolves a 3-letter IATA airport code to a city name using the free
 * AirportGap API (no key required).  Returns the city string, or null
 * if the code is unknown or the request fails.
 * e.g. "TPA" → "Tampa", "ANC" → "Anchorage"
 */
function resolveIataToCity_(iata) {
  var url = 'https://airportgap.com/api/airports/' + encodeURIComponent(iata);
  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return null;
    var data = JSON.parse(response.getContentText());
    if (data && data.data && data.data.attributes && data.data.attributes.city) {
      return data.data.attributes.city;
    }
  } catch (e) {
    Logger.log('resolveIataToCity_ error for "' + iata + '": ' + e.message);
  }
  return null;
}

/**
 * Returns weather at the given destination for a specific local hour.
 * location = IATA airport code (e.g. "TPA") or city name.
 *   IATA codes are resolved to city names via AirportGap before geocoding,
 *   so OWM always receives a real city name (not a 3-letter code).
 * hour     = local arrival hour 0–23; -1 or omitted → current script hour.
 * Requires WEATHER_API_KEY Script Property.
 */
function webGetDestWeather_(e) {
  var p        = e.parameter;
  var location = (p.location || '').trim();
  var hour     = parseInt(p.hour || '-1', 10);
  if (!location) return { ok: false, reason: 'no_location' };

  var apiKey = PropertiesService.getScriptProperties().getProperty('WEATHER_API_KEY');
  if (!apiKey) return { ok: false, reason: 'not_configured' };

  // If it looks like an IATA code (3 uppercase letters), resolve to city first
  var locationQuery = location;
  if (/^[A-Z]{3}$/.test(location)) {
    var city = resolveIataToCity_(location);
    if (city) locationQuery = city;
    Logger.log('webGetDestWeather_: IATA "' + location + '" → "' + (city || 'unresolved, using raw') + '"');
  }

  var forecast = fetchWeatherForecast_(locationQuery, apiKey);
  if (!forecast || !forecast.list || !forecast.list.length)
    return { ok: false, reason: 'forecast_unavailable' };

  var tzOffset = forecast.city.timezone;  // seconds from UTC
  var slot;
  if (hour >= 0 && hour <= 23) {
    // Specific arrival hour — find the forecast slot closest to that local hour
    slot = findForecastSlot_(forecast.list, hour, tzOffset);
    if (!slot) return { ok: false, reason: 'no_slot' };
  } else {
    // Current conditions — use the nearest forecast slot (list[0])
    // Avoids timezone mismatch from using script server hour vs destination local time
    slot = forecast.list[0];
  }

  return {
    ok:          true,
    temp:        Math.round(slot.main.temp),
    feelsLike:   Math.round(slot.main.feels_like),
    condition:   slot.weather[0].main,
    description: slot.weather[0].description,
    emoji:       weatherEmoji_(slot.weather[0].main),
    city:        forecast.city.name,
    targetHour:  (hour >= 0 && hour <= 23) ? hour : -1,
  };
}

/**
 * Reads all Config rows with key `tx_alias:KEYWORD` and returns a map:
 * { lowercasedKeyword: 'Bill Name', ... }
 * e.g. { 'anthropic': 'Claude Subscription', 'payroll verizon': 'Verizon Paycheck' }
 * Returns {} gracefully if Config tab not found.
 */
function getConfigAliases_() {
  var aliasMap = {};
  try {
    var ss    = getSpreadsheet();
    var sheet = ss.getSheetByName(TABS.CONFIG);
    if (!sheet || sheet.getLastRow() < 2) return aliasMap;
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    rows.forEach(function(row) {
      var key = String(row[0] || '').trim();
      var val = String(row[1] || '').trim();
      if (key.indexOf('tx_alias:') === 0 && val) {
        var keyword = key.slice('tx_alias:'.length).trim().toLowerCase();
        if (keyword) aliasMap[keyword] = val;
      }
    });
  } catch (e) { Logger.log('getConfigAliases_: ' + e.message); }
  return aliasMap;
}

/**
 * Checks whether any transaction in txList matches the bill name.
 * Matching order:
 *   0. Alias map (Config tx_alias:KEYWORD → BillName): if any alias for this bill
 *      appears as a substring in a transaction description → immediate match
 *   1. Bill name is a substring of the transaction description
 *   2. Transaction description is a substring of the bill name
 *   3. Any word in the bill name that is >3 chars appears in the transaction description
 * Returns the first matching { description, amount } object, or null.
 *
 * @param {string} billName
 * @param {Array}  txList    — from getTransactionMatchMap_()
 * @param {Object} [aliasMap] — from getConfigAliases_() (optional, defaults to {})
 */
function findTxMatch_(billName, txList, aliasMap, billAmount) {
  if (!billName || !txList || txList.length === 0) return null;
  aliasMap   = aliasMap || {};
  billAmount = (billAmount != null && billAmount > 0) ? Number(billAmount) : null;

  var nameLow = billName.toLowerCase();
  var words   = nameLow.split(/\s+/).filter(function(w) { return w.length > 3; });

  // Build list of alias keywords that map to THIS bill name (case-insensitive)
  var billAliasKeywords = Object.keys(aliasMap).filter(function(kw) {
    return aliasMap[kw].toLowerCase() === nameLow;
  });

  // Collect ALL description-matching candidates (rules 0–3), respecting _used flag
  var descCandidates = [];
  for (var i = 0; i < txList.length; i++) {
    if (txList[i]._used) continue; // already claimed by another bill
    var tx      = txList[i];
    var descLow = tx.description; // already lowercased
    var hit     = false;

    // Rule 0: alias match
    for (var a = 0; a < billAliasKeywords.length; a++) {
      if (descLow.indexOf(billAliasKeywords[a]) !== -1) { hit = true; break; }
    }
    // Rule 1: bill name is substring of description
    if (!hit && descLow.indexOf(nameLow) !== -1) hit = true;
    // Rule 2: description is substring of bill name
    if (!hit && nameLow.indexOf(descLow) !== -1) hit = true;
    // Rule 3: any significant word from bill name appears in description
    if (!hit) {
      for (var w = 0; w < words.length; w++) {
        if (descLow.indexOf(words[w]) !== -1) { hit = true; break; }
      }
    }
    if (hit) descCandidates.push({ idx: i, tx: tx });
  }

  // Pick best description candidate — when bill has an amount, pick closest-amount tx
  if (descCandidates.length > 0) {
    var best = descCandidates[0];
    if (billAmount !== null && descCandidates.length > 1) {
      var bestDiff = Math.abs(Math.abs(best.tx.amount) - billAmount);
      for (var c = 1; c < descCandidates.length; c++) {
        var diff = Math.abs(Math.abs(descCandidates[c].tx.amount) - billAmount);
        if (diff < bestDiff) { bestDiff = diff; best = descCandidates[c]; }
      }
    }
    txList[best.idx]._used = true; // mark claimed so another bill can't reuse it
    return { description: best.tx.rawDescription, amount: best.tx.amount };
  }

  // Rule 4: amount-only fallback — for bills with generic descriptions (e.g. utility payments)
  // Matches the transaction whose amount is within 20% of the bill amount (closest wins)
  if (billAmount !== null) {
    var amtBest = null, amtBestDiff = Infinity;
    for (var j = 0; j < txList.length; j++) {
      if (txList[j]._used) continue;
      var adiff = Math.abs(Math.abs(txList[j].amount) - billAmount);
      if (adiff / billAmount <= 0.20 && adiff < amtBestDiff) {
        amtBestDiff = adiff; amtBest = j;
      }
    }
    if (amtBest !== null) {
      txList[amtBest]._used = true;
      return { description: txList[amtBest].rawDescription, amount: txList[amtBest].amount };
    }
  }

  return null;
}

// ---- Cashflow Endpoint (Income + Expense timeline) -------------------------

/**
 * Returns the day numbers (1-based) within a month on which a bill/income event falls.
 * @param {number} dueDay       1-31 canonical day from Bills sheet
 * @param {string} frequency    'Monthly'|'Bi-weekly'|'Quarterly'|'Annual'|'One-time'
 * @param {number} daysInMonth  actual days in the target month
 */
function projectDays_(dueDay, frequency, daysInMonth) {
  var safeDay = Math.min(dueDay, daysInMonth);
  switch (frequency) {
    case 'Bi-weekly': {
      var days = [];
      for (var offset = -14; offset <= 28; offset += 14) {
        var d = dueDay + offset;
        if (d >= 1 && d <= daysInMonth) days.push(d);
      }
      return days;
    }
    case 'Monthly':
    case 'Quarterly':
    case 'Annual':
    case 'One-time':
    default:
      return [safeDay];
  }
}

/**
 * Cashflow endpoint — returns projected income + expense events for a given month.
 * Query params: action=cashflow, month=YYYY-MM (optional, defaults to current month)
 *
 * Income sources:
 *   (a) Bills sheet rows with Type='Income' — projected dates via projectDays_()
 *   (b) Transactions sheet — positive amounts in the month (actual paychecks)
 *   Dedup: if a transaction fuzzy-matches a Bills income entry, prefer the actual
 *          tx amount/day and mark confirmed=true on the Bills entry.
 *   Unmatched transactions: added as confirmed income, flagged unrecognized=true
 *          if they have no corresponding Bills income entry at all.
 *
 * Expense sources:
 *   Bills sheet rows with Type='Expense' (or empty) — projected dates via projectDays_()
 *
 * Returns: { ok, month, income: [{name,amount,day,source,confirmed,unrecognized}],
 *            expenses: [{name,amount,day,source}], totals: {income,expenses,net} }
 */
function webGetCashflow_(e) {
  var tz = Session.getScriptTimeZone();
  var p  = (e && e.parameter) ? e.parameter : {};

  var month = (p.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month))
    month = Utilities.formatDate(new Date(), tz, 'yyyy-MM');

  var parts       = month.split('-');
  var year        = parseInt(parts[0], 10);
  var mon         = parseInt(parts[1], 10);
  var daysInMonth = new Date(year, mon, 0).getDate();

  // ---- 1. Read Bills sheet -----------------------------------------------
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BILLS);
  var billsData = [];
  if (sheet && sheet.getLastRow() >= 2) {
    var numCols = Math.min(sheet.getLastColumn(), BILL_HEADERS.length);
    billsData = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getValues();
  }

  var aliasMap = getConfigAliases_();

  // Build category skip list — same config key used by Finance.js spending filter
  var cfgVals_  = getConfigValues();
  var skipRaw_  = String(cfgVals_['finance_skip_categories'] || '').trim();
  var skipList_ = skipRaw_
    ? skipRaw_.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean)
    : SKIP_CATEGORIES_DEFAULT_;

  // ---- 2. Project Bills income + expense events ---------------------------
  var incomeProjected  = [];  // from Bills sheet (Type=Income)
  var expenseEvents    = [];  // from Bills sheet (Type=Expense)

  billsData.forEach(function(row) {
    var name      = String(row[0] || '').trim();
    if (!name) return;
    var amount    = row[1] !== '' ? Number(row[1]) : null;
    var dueDay    = row[2] !== '' ? Number(row[2]) : null;
    var frequency = String(row[3] || 'Monthly').trim();
    var type      = String(row[8] || 'Expense').trim() || 'Expense';

    if (!dueDay || dueDay < 1) return;
    var days = projectDays_(dueDay, frequency, daysInMonth);

    days.forEach(function(day) {
      if (type === 'Income') {
        incomeProjected.push({ name: name, amount: amount, day: day, source: 'bills', confirmed: false, unrecognized: false });
      } else {
        expenseEvents.push({ name: name, amount: amount, day: day, source: 'bills' });
      }
    });
  });

  // ---- 3. Read actual transactions for the month (positive = income) ------
  var txIncome = [];
  var txId = PropertiesService.getScriptProperties().getProperty('TRANSACTIONS_SHEET_ID');
  if (txId) {
    try {
      var txSS   = SpreadsheetApp.openById(txId);
      var sheetA = txSS.getSheetByName('Transactions - Ahmed');
      var sheetV = txSS.getSheetByName('Transactions - Victoria');
      var rawRows = [];
      function readTxTab_(s) {
        if (!s || s.getLastRow() < 2) return;
        s.getRange(2, 1, s.getLastRow() - 1, 6).getValues().forEach(function(r) { rawRows.push(r); });
      }
      if (sheetA || sheetV) { readTxTab_(sheetA); readTxTab_(sheetV); }
      else                  { readTxTab_(txSS.getSheetByName('Transactions')); }

      rawRows.forEach(function(row) {
        var dateVal = row[0];
        var d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
        if (isNaN(d.getTime())) return;
        if (Utilities.formatDate(d, tz, 'yyyy-MM') !== month) return;
        var amount = parseFloat(String(row[5]).replace(/[$,]/g, ''));
        if (isNaN(amount) || amount <= 0) return;
        var cat = String(row[3] || '').trim().toLowerCase();
        if (cat && skipList_.indexOf(cat) !== -1) return;
        var desc = String(row[2] || '').trim();
        if (!desc) return;
        txIncome.push({ name: desc, amount: amount, day: d.getDate(), source: 'transaction', confirmed: true });
      });
    } catch (txErr) {
      Logger.log('webGetCashflow_: transaction read failed — ' + txErr.message);
    }
  }

  // ---- 4. Dedup: match tx income against Bills income projections ----------
  var matchedTxIdx = {};
  var incomeEvents = incomeProjected.map(function(ev) {
    var evLow    = ev.name.toLowerCase();
    var evAmt    = (ev.amount != null && ev.amount > 0) ? ev.amount : null;
    var words    = evLow.split(/\s+/).filter(function(w) { return w.length > 3; });
    var aliasKws = Object.keys(aliasMap).filter(function(kw) {
      return aliasMap[kw].toLowerCase() === evLow;
    });

    // Collect description-match candidates
    var candidates = [];
    for (var i = 0; i < txIncome.length; i++) {
      if (matchedTxIdx[i]) continue;
      var txLow = txIncome[i].name.toLowerCase();
      var hit = aliasKws.some(function(kw) { return txLow.indexOf(kw) !== -1; })
             || txLow.indexOf(evLow) !== -1
             || evLow.indexOf(txLow) !== -1
             || words.some(function(w) { return txLow.indexOf(w) !== -1; });
      if (hit) candidates.push(i);
    }

    // Pick best candidate — closest amount when multiple description matches
    var bestIdx = candidates.length > 0 ? candidates[0] : -1;
    if (evAmt !== null && candidates.length > 1) {
      var bestDiff = Math.abs((txIncome[candidates[0]].amount || 0) - evAmt);
      for (var c = 1; c < candidates.length; c++) {
        var diff = Math.abs((txIncome[candidates[c]].amount || 0) - evAmt);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = candidates[c]; }
      }
    }
    if (bestIdx >= 0) {
      matchedTxIdx[bestIdx] = true;
      return { name: ev.name, amount: txIncome[bestIdx].amount, day: txIncome[bestIdx].day,
               source: 'transaction', confirmed: true, unrecognized: false };
    }

    // Amount-only fallback (20% tolerance) for income with no description match
    if (evAmt !== null) {
      var amtBest = -1, amtBestDiff = Infinity;
      for (var j = 0; j < txIncome.length; j++) {
        if (matchedTxIdx[j]) continue;
        var adiff = Math.abs((txIncome[j].amount || 0) - evAmt);
        if (adiff / evAmt <= 0.20 && adiff < amtBestDiff) {
          amtBestDiff = adiff; amtBest = j;
        }
      }
      if (amtBest >= 0) {
        matchedTxIdx[amtBest] = true;
        return { name: ev.name, amount: txIncome[amtBest].amount, day: txIncome[amtBest].day,
                 source: 'transaction', confirmed: true, unrecognized: false };
      }
    }

    return ev; // unmatched Bills income entry → keep projected
  });

  // Remaining unmatched transactions (no Bills income entry for them)
  txIncome.forEach(function(tx, i) {
    if (!matchedTxIdx[i]) {
      incomeEvents.push({ name: tx.name, amount: tx.amount, day: tx.day,
                          source: 'transaction', confirmed: true, unrecognized: true });
    }
  });

  // ---- 5. Totals ----------------------------------------------------------
  function sumAmt(arr) { return arr.reduce(function(s, ev) { return s + (ev.amount || 0); }, 0); }
  incomeEvents.sort(function(a, b)  { return a.day - b.day; });
  expenseEvents.sort(function(a, b) { return a.day - b.day; });

  return {
    ok:       true,
    month:    month,
    income:   incomeEvents,
    expenses: expenseEvents,
    totals:   { income: sumAmt(incomeEvents), expenses: sumAmt(expenseEvents),
                net: sumAmt(incomeEvents) - sumAmt(expenseEvents) },
  };
}

// ---- Transaction Alias Management ------------------------------------------

/**
 * Returns all tx_alias entries from the Config tab.
 * Response: { ok, aliases: [{keyword, bill}] }
 */
function webGetTxAliases_() {
  var aliasMap = getConfigAliases_();
  var aliases  = Object.keys(aliasMap).map(function(kw) {
    return { keyword: kw, bill: aliasMap[kw] };
  });
  aliases.sort(function(a, b) { return a.keyword.localeCompare(b.keyword); });
  return { ok: true, aliases: aliases };
}

/**
 * Creates or updates a tx_alias in the Config tab.
 * Params: keyword (the transaction text to match), bill (the bill/income name)
 * If bill is empty, deletes the alias row.
 */
function webSetTxAlias_(e) {
  var p       = (e && e.parameter) ? e.parameter : {};
  var keyword = (p.keyword || '').trim();
  var bill    = (p.bill    || '').trim();
  if (!keyword) throw new Error('keyword is required');

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) throw new Error('Config tab not found');

  var configKey = 'tx_alias:' + keyword;
  var lastRow   = sheet.getLastRow();
  var existingRow = -1;

  if (lastRow >= 2) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === configKey) { existingRow = i + 2; break; }
    }
  }

  if (!bill) {
    // Delete: if row exists, clear it (or delete the row)
    if (existingRow > 0) sheet.deleteRow(existingRow);
    return { ok: true, action: 'deleted', keyword: keyword };
  }

  if (existingRow > 0) {
    sheet.getRange(existingRow, 2).setValue(bill);
    return { ok: true, action: 'updated', keyword: keyword, bill: bill };
  }
  sheet.appendRow([configKey, bill]);
  return { ok: true, action: 'created', keyword: keyword, bill: bill };
}

// ---- Calendar Bills (Issue #76) --------------------------------------------

/**
 * Parses a dollar amount from a text string.
 * e.g. "Netflix Subscription $15.99" → 15.99, "$1,200" → 1200
 */
function parseAmountFromText_(text) {
  var match = String(text || '').match(/\$([\d,]+(?:\.\d{2})?)/);
  if (!match) return null;
  var val = parseFloat(match[1].replace(/,/g, ''));
  return isNaN(val) ? null : val;
}

/**
 * Infers a bill category from which keyword matched the event title.
 */
function inferBillCategory_(title) {
  var t = title.toLowerCase();
  if (t.indexOf('rent') !== -1 || t.indexOf('mortgage') !== -1) return 'Housing';
  if (t.indexOf('subscription') !== -1)                          return 'Subscriptions';
  if (t.indexOf('insurance') !== -1)                             return 'Insurance';
  if (t.indexOf('utilit') !== -1)                                return 'Utilities';
  if (t.indexOf('payment') !== -1)                               return 'Payments';
  return 'Bills';
}

/**
 * Reads all-day calendar events in a rolling window whose title contains a
 * bill keyword. Returns them as a structured list for the Bills dashboard.
 */
function webGetCalendarBills_() {
  var ss  = getSpreadsheet();
  var tz  = Session.getScriptTimeZone();

  // Read config
  var keywords      = ['bill', 'subscription', 'payment', 'rent', 'insurance', 'mortgage', 'utility', 'utilities'];
  var billCalendars = []; // empty = all calendars
  try {
    var cfgSheet = ss.getSheetByName(TABS.CONFIG);
    if (cfgSheet) {
      var cfgData = cfgSheet.getDataRange().getValues();
      for (var ci = 0; ci < cfgData.length; ci++) {
        var cfgKey = String(cfgData[ci][0]).trim();
        var cfgVal = String(cfgData[ci][1]).trim();
        if (cfgKey === 'bill_keywords' && cfgVal)
          keywords = cfgVal.split(',').map(function(k) { return k.trim().toLowerCase(); });
        if (cfgKey === 'bill_calendars' && cfgVal)
          billCalendars = cfgVal.split(',').map(function(c) { return c.trim().toLowerCase(); });
      }
    }
  } catch(e) {}

  // Date window: beginning of current month → end of current month
  var now   = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), 1);        // first day of month
  var end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);    // last day of month (day 0 of next month)

  // Cross-reference Bills sheet for paid status
  var paidMap = {};
  try {
    var bSheet = ss.getSheetByName(TABS.BILLS);
    if (bSheet && bSheet.getLastRow() >= 2) {
      var bData = bSheet.getRange(2, 1, bSheet.getLastRow() - 1,
                    Math.min(bSheet.getLastColumn(), BILL_HEADERS.length)).getValues();
      var mon2  = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
      bData.forEach(function(r) {
        var name = String(r[0] || '').trim().toLowerCase();
        if (name) paidMap[name] = String(r[6] || '').trim() === mon2;
      });
    }
  } catch(e) {}

  var allCals = CalendarApp.getAllCalendars();
  var seen    = {};
  var bills   = [];

  allCals.forEach(function(cal) {
    var calName = cal.getName();
    var calId   = cal.getId(); // usually the email address for personal calendars
    // Filter to specific calendars if configured
    // Match against both display name AND calendar ID (email) so either works in Config
    if (billCalendars.length > 0 &&
        billCalendars.indexOf(calName.toLowerCase()) === -1 &&
        billCalendars.indexOf(calId.toLowerCase())   === -1) return;

    var events = cal.getEvents(start, end);
    events.forEach(function(ev) {
      if (!ev.isAllDayEvent()) return;
      var title = ev.getTitle();
      var titleLow = title.toLowerCase();

      // Check if any keyword matches
      var matched = keywords.some(function(kw) { return titleLow.indexOf(kw) !== -1; });
      if (!matched) return;

      var id = ev.getId();
      if (seen[id]) return;
      seen[id] = true;

      // Parse amount from title then description
      var desc   = ev.getDescription() || '';
      var amount = parseAmountFromText_(title) || parseAmountFromText_(desc) || null;

      bills.push({
        id:          id,
        title:       title,
        date:        Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd'),
        isRecurring: ev.isRecurringEvent(),
        amount:      amount,
        notes:       desc,
        category:    inferBillCategory_(title),
        calendarName: calName,
        paid:        paidMap[title.toLowerCase()] || false,
      });
    });
  });

  // Sort by date
  bills.sort(function(a, b) { return a.date.localeCompare(b.date); });

  return { ok: true, bills: bills };
}

/**
 * Toggles paid status for a calendar-sourced bill.
 * Auto-creates a Bills sheet row on first toggle if no matching row exists.
 */
function webToggleCalBill_(e) {
  var p     = e.parameter || {};
  var title = (p.title || '').trim();
  if (!title) throw new Error('title is required');

  var ss        = getSpreadsheet();
  var sheet     = ss.getSheetByName(TABS.BILLS);
  if (!sheet) throw new Error('Bills tab not found');

  var tz        = Session.getScriptTimeZone();
  var currMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');

  // Find existing sheet row by bill name (case-insensitive)
  var rowNum = -1;
  if (sheet.getLastRow() >= 2) {
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim().toLowerCase() === title.toLowerCase()) {
        rowNum = i + 2; break;
      }
    }
  }

  // Auto-create row if not found
  if (rowNum === -1) {
    var dueDay = '';
    if (p.dueDay) {
      dueDay = Number(p.dueDay) || '';
    } else if (p.date) {
      // Derive due day from calendar event date
      dueDay = parseInt(p.date.split('-')[2], 10) || '';
    }
    var newRow = [
      title,
      p.amount ? (parseFloat(String(p.amount).replace(/,/g, '')) || '') : '',
      dueDay,
      p.frequency || (p.isRecurring === 'true' ? 'Recurring' : 'One-time'),
      (p.category || '').trim(),
      '',   // account — user can enrich later
      '',   // paid — will be set below
      (p.notes || '').trim(),
      'Expense', // Type column (col 9) — calendar bills are always expenses
    ];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, BILL_HEADERS.length).setValues([newRow]);
    rowNum = sheet.getLastRow();
  }

  // Toggle paid
  var cell    = sheet.getRange(rowNum, 7);
  var current = String(cell.getValue() || '').trim();
  var newVal  = (current === currMonth) ? '' : currMonth;
  cell.setValue(newVal);
  SpreadsheetApp.flush(); // ensure write is committed before caller reads it back

  return { ok: true, row: rowNum, paid: newVal !== '' };
}

// ---- Recipes (Issue #46) ---------------------------------------------------

function webGetRecipes_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.RECIPES);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, recipes: [] };
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, RECIPE_HEADERS.length).getValues();
  var recipes = [];
  data.forEach(function(row, idx) {
    var name = String(row[0] || '').trim();
    if (!name) return;
    recipes.push({
      row:         idx + 2,
      name:        name,
      cuisine:     String(row[1] || '').trim(),
      servings:    row[2] !== '' ? String(row[2]).trim() : null,
      prepTime:    String(row[3] || '').trim(),
      link:        String(row[4] || '').trim(),
      ingredients: String(row[5] || '').trim(),
      tags:        String(row[6] || '').trim(),
      notes:       String(row[7] || '').trim(),
    });
  });
  return { ok: true, recipes: recipes };
}

function webRecipeToShopping_(e) {
  var rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.RECIPES);
  if (!sheet) throw new Error('Recipes tab not found');
  var raw = String(sheet.getRange(rowNum, 6).getValue() || '').trim(); // Col F = Ingredients
  if (!raw) return { ok: false, error: 'No ingredients listed for this recipe.' };
  var ingredients = raw.split(';').map(function(s) { return s.trim(); }).filter(Boolean);
  return addRecipeIngredients_(ingredients);
}

function webAddRecipe_(e) {
  const p    = e.parameter || {};
  const name = (p.name || '').trim();
  if (!name) throw new Error('Recipe name is required');
  const sheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
  if (!sheet) throw new Error('Recipes tab not found');
  // RECIPE_HEADERS: Name | Cuisine | Servings | Prep Time | Link | Ingredients | Tags | Notes
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, RECIPE_HEADERS.length).setValues([[
    name,
    (p.cuisine      || '').trim(),
    (p.servings     || '').trim(),
    (p.prepTime     || '').trim(),
    (p.link         || '').trim(),
    (p.ingredients  || '').trim(),
    (p.tags         || '').trim(),
    (p.notes        || '').trim(),
  ]]);
  return { ok: true, name: name, action: 'created' };
}

function webDeleteRecipe_(e) {
  const rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row: ' + rowNum);
  const sheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
  if (!sheet) throw new Error('Recipes tab not found');
  sheet.deleteRow(rowNum);
  return { ok: true, row: rowNum, action: 'deleted' };
}

// ---- Favorite Takeouts (Issue #112) ----------------------------------------

function webGetTakeouts_() {
  var ss      = getSpreadsheet();
  var rSheet  = ss.getSheetByName(TABS.TAKEOUT_RESTAURANTS);
  var iSheet  = ss.getSheetByName(TABS.TAKEOUT_ITEMS);
  var restaurants = [];
  if (rSheet && rSheet.getLastRow() >= 2) {
    var rData = rSheet.getRange(2, 1, rSheet.getLastRow() - 1, TAKEOUT_RESTAURANT_HEADERS.length).getValues();
    rData.forEach(function(row, idx) {
      var name = String(row[0] || '').trim();
      if (!name) return;
      restaurants.push({
        row:     idx + 2,
        name:    name,
        cuisine: String(row[1] || '').trim(),
        phone:   String(row[2] || '').trim(),
        website: String(row[3] || '').trim(),
        rating:  row[4] !== '' ? Number(row[4]) : null,
        notes:   String(row[5] || '').trim(),
        items:   [],
      });
    });
  }
  if (iSheet && iSheet.getLastRow() >= 2) {
    var iData = iSheet.getRange(2, 1, iSheet.getLastRow() - 1, TAKEOUT_ITEM_HEADERS.length).getValues();
    iData.forEach(function(row, idx) {
      var restName = String(row[0] || '').trim();
      var itemName = String(row[1] || '').trim();
      if (!restName || !itemName) return;
      var rest = restaurants.find(function(r) { return r.name === restName; });
      if (rest) {
        rest.items.push({
          row:         idx + 2,
          item:        itemName,
          description: String(row[2] || '').trim(),
          rating:      row[3] !== '' ? Number(row[3]) : null,
          notes:       String(row[4] || '').trim(),
        });
      }
    });
  }
  return { ok: true, restaurants: restaurants };
}

function webAddTakeoutRestaurant_(body) {
  var name = ((body && body.name) || '').trim();
  if (!name) throw new Error('Restaurant name is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.TAKEOUT_RESTAURANTS);
  if (!sheet) throw new Error('Takeout Restaurants tab not found');
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, TAKEOUT_RESTAURANT_HEADERS.length).setValues([[
    name,
    ((body.cuisine || '')).trim(),
    ((body.phone   || '')).trim(),
    ((body.website || '')).trim(),
    body.rating ? Number(body.rating) : '',
    ((body.notes   || '')).trim(),
  ]]);
  return { ok: true, action: 'created', name: name };
}

function webDeleteTakeoutRestaurant_(body) {
  var name = ((body && body.name) || '').trim();
  if (!name) throw new Error('name is required');
  var ss     = getSpreadsheet();
  var rSheet = ss.getSheetByName(TABS.TAKEOUT_RESTAURANTS);
  if (rSheet && rSheet.getLastRow() >= 2) {
    var rData = rSheet.getRange(2, 1, rSheet.getLastRow() - 1, 1).getValues();
    for (var i = rData.length - 1; i >= 0; i--) {
      if (String(rData[i][0]).trim() === name) rSheet.deleteRow(i + 2);
    }
  }
  var iSheet = ss.getSheetByName(TABS.TAKEOUT_ITEMS);
  if (iSheet && iSheet.getLastRow() >= 2) {
    var iData = iSheet.getRange(2, 1, iSheet.getLastRow() - 1, 1).getValues();
    for (var j = iData.length - 1; j >= 0; j--) {
      if (String(iData[j][0]).trim() === name) iSheet.deleteRow(j + 2);
    }
  }
  return { ok: true, action: 'deleted', name: name };
}

function webAddTakeoutItem_(body) {
  var restaurant = ((body && body.restaurant) || '').trim();
  var item       = ((body && body.item)       || '').trim();
  if (!restaurant || !item) throw new Error('restaurant and item are required');
  var sheet = getSpreadsheet().getSheetByName(TABS.TAKEOUT_ITEMS);
  if (!sheet) throw new Error('Takeout Items tab not found');
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, TAKEOUT_ITEM_HEADERS.length).setValues([[
    restaurant,
    item,
    ((body.description || '')).trim(),
    body.rating ? Number(body.rating) : '',
    ((body.notes       || '')).trim(),
  ]]);
  return { ok: true, action: 'created', item: item };
}

function webDeleteTakeoutItem_(body) {
  var rowNum = parseInt((body && body.row) || '0', 10);
  if (!rowNum || rowNum < 2) throw new Error('Invalid row: ' + rowNum);
  var sheet = getSpreadsheet().getSheetByName(TABS.TAKEOUT_ITEMS);
  if (!sheet) throw new Error('Takeout Items tab not found');
  sheet.deleteRow(rowNum);
  return { ok: true, action: 'deleted', row: rowNum };
}

// ---- Career Tab ------------------------------------------------------------

function webGetCareer_() {
  var ss  = getSpreadsheet();
  var tz  = Session.getScriptTimeZone();

  // Position (single row)
  var position = {};
  try {
    var pSheet = ss.getSheetByName(TABS.CAREER_POSITION);
    if (pSheet && pSheet.getLastRow() >= 2) {
      var pr = pSheet.getRange(2, 1, 1, CAREER_POSITION_HEADERS.length).getValues()[0];
      position = {
        title: String(pr[0]||'').trim(), company: String(pr[1]||'').trim(),
        department: String(pr[2]||'').trim(), startDate: String(pr[3]||'').trim(),
        workStyle: String(pr[4]||'').trim(), focusAreas: String(pr[5]||'').trim(),
        notes: String(pr[6]||'').trim(),
      };
    }
  } catch(ex) { Logger.log('career position: ' + ex.message); }

  // Goals
  var goals = [];
  try {
    var gSheet = ss.getSheetByName(TABS.CAREER_GOALS);
    if (gSheet && gSheet.getLastRow() >= 2) {
      gSheet.getRange(2, 1, gSheet.getLastRow()-1, CAREER_GOAL_HEADERS.length).getValues()
        .forEach(function(r, i) {
          if (!String(r[0]||'').trim()) return;
          goals.push({ row: i+2, id: String(r[0]).trim(), title: String(r[1]||'').trim(),
            horizon: String(r[2]||'').trim(), category: String(r[3]||'').trim(),
            status: String(r[4]||'Active').trim(), targetDate: String(r[5]||'').trim(),
            notes: String(r[6]||'').trim() });
        });
    }
  } catch(ex) { Logger.log('career goals: ' + ex.message); }

  // Progression (sorted newest first by start year)
  var progression = [];
  try {
    var prSheet = ss.getSheetByName(TABS.CAREER_PROGRESSION);
    if (prSheet && prSheet.getLastRow() >= 2) {
      prSheet.getRange(2, 1, prSheet.getLastRow()-1, CAREER_PROGRESSION_HEADERS.length).getValues()
        .forEach(function(r, i) {
          if (!String(r[0]||'').trim()) return;
          progression.push({ row: i+2, id: String(r[0]).trim(), title: String(r[1]||'').trim(),
            company: String(r[2]||'').trim(), startYear: String(r[3]||'').trim(),
            endYear: String(r[4]||'').trim(), type: String(r[5]||'').trim(),
            highlights: String(r[6]||'').trim(), notes: String(r[7]||'').trim() });
        });
      progression.sort(function(a,b) { return (b.startYear||'') > (a.startYear||'') ? 1 : -1; });
    }
  } catch(ex) { Logger.log('career progression: ' + ex.message); }

  // Development
  var development = [];
  try {
    var dSheet = ss.getSheetByName(TABS.CAREER_DEVELOPMENT);
    if (dSheet && dSheet.getLastRow() >= 2) {
      dSheet.getRange(2, 1, dSheet.getLastRow()-1, CAREER_DEVELOPMENT_HEADERS.length).getValues()
        .forEach(function(r, i) {
          if (!String(r[0]||'').trim()) return;
          development.push({ row: i+2, id: String(r[0]).trim(), item: String(r[1]||'').trim(),
            type: String(r[2]||'').trim(), status: String(r[3]||'Planned').trim(),
            targetDate: String(r[4]||'').trim(), notes: String(r[5]||'').trim() });
        });
    }
  } catch(ex) { Logger.log('career development: ' + ex.message); }

  // Wins (sorted newest first)
  var wins = [];
  try {
    var wSheet = ss.getSheetByName(TABS.CAREER_WINS);
    if (wSheet && wSheet.getLastRow() >= 2) {
      wSheet.getRange(2, 1, wSheet.getLastRow()-1, CAREER_WIN_HEADERS.length).getValues()
        .forEach(function(r, i) {
          if (!String(r[0]||'').trim()) return;
          wins.push({ row: i+2, id: String(r[0]).trim(),
            date: r[1] ? Utilities.formatDate(new Date(r[1]), tz, 'yyyy-MM-dd') : '',
            win: String(r[2]||'').trim(), impact: String(r[3]||'').trim(),
            category: String(r[4]||'').trim(), notes: String(r[5]||'').trim() });
        });
      wins.sort(function(a,b) { return (b.date||'') > (a.date||'') ? 1 : -1; });
    }
  } catch(ex) { Logger.log('career wins: ' + ex.message); }

  // Network
  var network = [];
  try {
    var nSheet = ss.getSheetByName(TABS.CAREER_NETWORK);
    if (nSheet && nSheet.getLastRow() >= 2) {
      nSheet.getRange(2, 1, nSheet.getLastRow()-1, CAREER_NETWORK_HEADERS.length).getValues()
        .forEach(function(r, i) {
          if (!String(r[0]||'').trim()) return;
          network.push({ row: i+2, id: String(r[0]).trim(), name: String(r[1]||'').trim(),
            role: String(r[2]||'').trim(), company: String(r[3]||'').trim(),
            relationship: String(r[4]||'').trim(),
            lastContact: r[5] ? Utilities.formatDate(new Date(r[5]), tz, 'yyyy-MM-dd') : '',
            notes: String(r[6]||'').trim() });
        });
    }
  } catch(ex) { Logger.log('career network: ' + ex.message); }

  return { ok: true, position: position, goals: goals, progression: progression,
           development: development, wins: wins, network: network };
}

function webUpdateCareerPosition_(e) {
  var p      = e.parameter || {};
  var ss     = getSpreadsheet();
  var sheet  = ss.getSheetByName(TABS.CAREER_POSITION);
  if (!sheet) throw new Error('Career Position tab not found');
  // Ensure at least one data row exists
  if (sheet.getLastRow() < 2) sheet.getRange(2, 1, 1, CAREER_POSITION_HEADERS.length).setValues([['','','','','','','']]);
  sheet.getRange(2, 1, 1, CAREER_POSITION_HEADERS.length).setValues([[
    (p.title       ||'').trim(),
    (p.company     ||'').trim(),
    (p.department  ||'').trim(),
    (p.startDate   ||'').trim(),
    (p.workStyle   ||'').trim(),
    (p.focusAreas  ||'').trim(),
    (p.notes       ||'').trim(),
  ]]);
  return { ok: true, action: 'updated' };
}

function webAddCareerGoal_(e) {
  var p    = e.parameter || {};
  var title = (p.title||'').trim();
  if (!title) throw new Error('title is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_GOALS);
  var id    = 'CG-' + Date.now();
  sheet.getRange(sheet.getLastRow()+1, 1, 1, CAREER_GOAL_HEADERS.length).setValues([[
    id, title, (p.horizon||'').trim(), (p.category||'').trim(),
    (p.status||'Active').trim(), (p.targetDate||'').trim(), (p.notes||'').trim(),
  ]]);
  return { ok: true, action: 'created', id: id };
}

function webUpdateCareerGoal_(e) {
  var p  = e.parameter || {};
  var id = (p.id||'').trim();
  var field = (p.field||'').trim();
  var value = (p.value||'').trim();
  if (!id || !field) throw new Error('id and field are required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_GOALS);
  var colMap = { title:2, horizon:3, category:4, status:5, targetDate:6, notes:7 };
  var col = colMap[field];
  if (!col) throw new Error('Unknown field: ' + field);
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 1).getValues();
  for (var i=0; i<data.length; i++) {
    if (String(data[i][0]).trim() === id) { sheet.getRange(i+2, col).setValue(value); return { ok: true }; }
  }
  throw new Error('Goal not found: ' + id);
}

function webDeleteCareerGoal_(e) {
  var id = ((e.parameter||{}).id||'').trim();
  if (!id) throw new Error('id is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_GOALS);
  var data  = sheet.getRange(2, 1, sheet.getLastRow()-1, 1).getValues();
  for (var i=data.length-1; i>=0; i--) {
    if (String(data[i][0]).trim() === id) { sheet.deleteRow(i+2); return { ok: true, action: 'deleted' }; }
  }
  throw new Error('Goal not found: ' + id);
}

function webAddCareerProgression_(e) {
  var p = e.parameter || {};
  var title = (p.title||'').trim();
  if (!title) throw new Error('title is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_PROGRESSION);
  var id    = 'CPR-' + Date.now();
  sheet.getRange(sheet.getLastRow()+1, 1, 1, CAREER_PROGRESSION_HEADERS.length).setValues([[
    id, title, (p.company||'').trim(), (p.startYear||'').trim(),
    (p.endYear||'').trim(), (p.type||'New Role').trim(),
    (p.highlights||'').trim(), (p.notes||'').trim(),
  ]]);
  return { ok: true, action: 'created', id: id };
}

function webDeleteCareerProgression_(e) {
  var id = ((e.parameter||{}).id||'').trim();
  if (!id) throw new Error('id is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_PROGRESSION);
  var data  = sheet.getRange(2, 1, sheet.getLastRow()-1, 1).getValues();
  for (var i=data.length-1; i>=0; i--) {
    if (String(data[i][0]).trim() === id) { sheet.deleteRow(i+2); return { ok: true, action: 'deleted' }; }
  }
  throw new Error('Entry not found: ' + id);
}

function webAddCareerDevelopment_(e) {
  var p    = e.parameter || {};
  var item = (p.item||'').trim();
  if (!item) throw new Error('item is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_DEVELOPMENT);
  var id    = 'CD-' + Date.now();
  sheet.getRange(sheet.getLastRow()+1, 1, 1, CAREER_DEVELOPMENT_HEADERS.length).setValues([[
    id, item, (p.type||'Skill').trim(), (p.status||'Planned').trim(),
    (p.targetDate||'').trim(), (p.notes||'').trim(),
  ]]);
  return { ok: true, action: 'created', id: id };
}

function webUpdateCareerDevelopment_(e) {
  var p  = e.parameter || {};
  var id = (p.id||'').trim();
  var field = (p.field||'').trim();
  var value = (p.value||'').trim();
  if (!id || !field) throw new Error('id and field are required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_DEVELOPMENT);
  var colMap = { item:2, type:3, status:4, targetDate:5, notes:6 };
  var col = colMap[field];
  if (!col) throw new Error('Unknown field: ' + field);
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 1).getValues();
  for (var i=0; i<data.length; i++) {
    if (String(data[i][0]).trim() === id) { sheet.getRange(i+2, col).setValue(value); return { ok: true }; }
  }
  throw new Error('Item not found: ' + id);
}

function webDeleteCareerDevelopment_(e) {
  var id = ((e.parameter||{}).id||'').trim();
  if (!id) throw new Error('id is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_DEVELOPMENT);
  var data  = sheet.getRange(2, 1, sheet.getLastRow()-1, 1).getValues();
  for (var i=data.length-1; i>=0; i--) {
    if (String(data[i][0]).trim() === id) { sheet.deleteRow(i+2); return { ok: true, action: 'deleted' }; }
  }
  throw new Error('Item not found: ' + id);
}

function webAddCareerWin_(e) {
  var p   = e.parameter || {};
  var win = (p.win||'').trim();
  if (!win) throw new Error('win is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_WINS);
  var id    = 'CW-' + Date.now();
  var tz    = Session.getScriptTimeZone();
  var date  = (p.date||'').trim() || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  sheet.getRange(sheet.getLastRow()+1, 1, 1, CAREER_WIN_HEADERS.length).setValues([[
    id, date, win, (p.impact||'').trim(), (p.category||'Other').trim(), (p.notes||'').trim(),
  ]]);
  return { ok: true, action: 'created', id: id };
}

function webDeleteCareerWin_(e) {
  var id = ((e.parameter||{}).id||'').trim();
  if (!id) throw new Error('id is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_WINS);
  var data  = sheet.getRange(2, 1, sheet.getLastRow()-1, 1).getValues();
  for (var i=data.length-1; i>=0; i--) {
    if (String(data[i][0]).trim() === id) { sheet.deleteRow(i+2); return { ok: true, action: 'deleted' }; }
  }
  throw new Error('Win not found: ' + id);
}

function webAddCareerNetwork_(e) {
  var p    = e.parameter || {};
  var name = (p.name||'').trim();
  if (!name) throw new Error('name is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_NETWORK);
  var id    = 'CN-' + Date.now();
  sheet.getRange(sheet.getLastRow()+1, 1, 1, CAREER_NETWORK_HEADERS.length).setValues([[
    id, name, (p.role||'').trim(), (p.company||'').trim(),
    (p.relationship||'Colleague').trim(), (p.lastContact||'').trim(), (p.notes||'').trim(),
  ]]);
  return { ok: true, action: 'created', id: id };
}

function webUpdateCareerNetwork_(e) {
  var p  = e.parameter || {};
  var id = (p.id||'').trim();
  var field = (p.field||'').trim();
  var value = (p.value||'').trim();
  if (!id || !field) throw new Error('id and field are required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_NETWORK);
  var colMap = { name:2, role:3, company:4, relationship:5, lastContact:6, notes:7 };
  var col = colMap[field];
  if (!col) throw new Error('Unknown field: ' + field);
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 1).getValues();
  for (var i=0; i<data.length; i++) {
    if (String(data[i][0]).trim() === id) { sheet.getRange(i+2, col).setValue(value); return { ok: true }; }
  }
  throw new Error('Contact not found: ' + id);
}

function webDeleteCareerNetwork_(e) {
  var id = ((e.parameter||{}).id||'').trim();
  if (!id) throw new Error('id is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.CAREER_NETWORK);
  var data  = sheet.getRange(2, 1, sheet.getLastRow()-1, 1).getValues();
  for (var i=data.length-1; i>=0; i--) {
    if (String(data[i][0]).trim() === id) { sheet.deleteRow(i+2); return { ok: true, action: 'deleted' }; }
  }
  throw new Error('Contact not found: ' + id);
}

// ---- Home Steward (Issue #21) ----------------------------------------------

function webGetHomesteward_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HOME_ITEMS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, items: [] };
  var data  = sheet.getRange(2, 1, sheet.getLastRow() - 1, HOME_ITEM_HEADERS.length).getValues();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var tz    = Session.getScriptTimeZone();

  function fmtDate(v) {
    if (!v) return '';
    try { return Utilities.formatDate(new Date(v), tz, 'yyyy-MM-dd'); } catch (ex) { return ''; }
  }
  function daysDiff(v) {
    if (!v) return null;
    try { var d = new Date(v); return Math.round((d - today) / 86400000); } catch (ex) { return null; }
  }

  var items = [];
  data.forEach(function(row, idx) {
    var item = String(row[0] || '').trim();
    if (!item) return;
    items.push({
      row:            idx + 2,
      item:           item,
      category:       String(row[1] || '').trim(),
      purchaseDate:   fmtDate(row[2]),
      warrantyExpiry: fmtDate(row[3]),
      lastService:    fmtDate(row[4]),
      nextService:    fmtDate(row[5]),
      intervalMonths: row[6] !== '' ? Number(row[6]) : null,
      notes:          String(row[7] || '').trim(),
      warrantyDays:   daysDiff(row[3]),
      serviceDays:    daysDiff(row[5]),
    });
  });
  return { ok: true, items: items };
}

function webRecordService_(e) {
  var rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HOME_ITEMS);
  if (!sheet) throw new Error('Home Items tab not found');

  var tz       = Session.getScriptTimeZone();
  var today    = new Date();
  var todayStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');
  sheet.getRange(rowNum, 5).setValue(todayStr); // Col E = Last Service

  var interval = Number(sheet.getRange(rowNum, 7).getValue() || 0); // Col G = Interval
  var nextStr  = '';
  var eventId  = '';

  if (interval > 0) {
    var next = new Date(today);
    next.setMonth(next.getMonth() + interval);
    nextStr = Utilities.formatDate(next, tz, 'yyyy-MM-dd');
    sheet.getRange(rowNum, 6).setValue(nextStr); // Col F = Next Service
    var itemName = String(sheet.getRange(rowNum, 1).getValue() || 'Item');
    var calEvent = CalendarApp.getDefaultCalendar().createAllDayEvent(
      '🔧 Service: ' + itemName, next,
      { description: 'VERA scheduled service reminder for ' + itemName }
    );
    eventId = calEvent.getId();
  }
  return { ok: true, lastService: todayStr, nextService: nextStr, calEventId: eventId };
}

function webAddHomeItem_(e) {
  const p    = e.parameter || {};
  const item = (p.item || p.name || '').trim();
  if (!item) throw new Error('Item name is required');
  const sheet = getSpreadsheet().getSheetByName(TABS.HOME_ITEMS);
  if (!sheet) throw new Error('Home Items tab not found');
  // HOME_ITEM_HEADERS: Item | Category | Purchase Date | Warranty Expiry | Last Service | Next Service | Interval (mo) | Notes
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, HOME_ITEM_HEADERS.length).setValues([[
    item,
    (p.category       || '').trim(),
    (p.purchaseDate   || '').trim(),
    (p.warrantyExpiry || '').trim(),
    '',   // Last Service
    '',   // Next Service
    p.intervalMonths !== undefined ? (Number(p.intervalMonths) || '') : '',
    (p.notes || '').trim(),
  ]]);
  return { ok: true, item: item, action: 'created' };
}

function webDeleteHomeItem_(e) {
  const rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row: ' + rowNum);
  const sheet = getSpreadsheet().getSheetByName(TABS.HOME_ITEMS);
  if (!sheet) throw new Error('Home Items tab not found');
  sheet.deleteRow(rowNum);
  return { ok: true, row: rowNum, action: 'deleted' };
}

// ---- Itinerary (Issue #63) --------------------------------------------------

/**
 * Decides whether a calendar event is travel-relevant for a trip itinerary.
 * @param {string} title     - Event title
 * @param {string} location  - Event location (may be empty string)
 * @param {string} tripLabel - Trip label extracted from tripKey (e.g. "Alaska Trip")
 * @returns {{ include: boolean, type: string }}
 */
function isItineraryCalendarRelevant_(title, location, tripLabel) {
  var titleLower    = (title    || '').toLowerCase();
  var locationLower = (location || '').toLowerCase();

  var AIRLINE_REGEX   = /\b(AA|UA|DL|SW|BA|EK|LH|AF|QR|AC|AS|B6|F9|WN|NK|G4)\s*\d+/;
  var FLIGHT_WORDS    = ['flight', 'flying', 'depart', 'arrive', '\u2708'];
  var TRANSPORT_WORDS = ['train', 'amtrak', 'eurostar', 'rail', 'thalys', 'bus', 'shuttle',
                         'transfer', 'car rental', 'rental car', 'lyft', 'uber', 'taxi'];
  var HOTEL_WORDS     = ['hotel', 'check-in', 'check in', 'check-out', 'check out',
                         'airbnb', 'vrbo', 'resort', 'inn', 'hostel', 'motel', 'lodge'];
  var VIRTUAL_LOCS    = ['zoom', 'google meet', 'teams', 'webex', 'skype',
                         'conference room', 'meet.google', 'whereby'];
  var STOP_WORDS      = { trip:1, travel:1, vacation:1, holiday:1, weekend:1, adventure:1,
                          getaway:1, visit:1, tour:1, journey:1, with:1, to:1, a:1, an:1,
                          the:1, my:1, our:1, and:1, 'in':1, at:1, for:1 };

  var i;

  // 1. Virtual/remote location → always exclude
  if (locationLower) {
    for (i = 0; i < VIRTUAL_LOCS.length; i++) {
      if (locationLower.indexOf(VIRTUAL_LOCS[i]) !== -1) return { include: false };
    }
  }

  // 2. Airline code + flight number (e.g. "AA 102", "UA123")
  if (AIRLINE_REGEX.test(title.toUpperCase())) return { include: true, type: 'flight' };

  // 3. Generic flight keywords
  for (i = 0; i < FLIGHT_WORDS.length; i++) {
    if (titleLower.indexOf(FLIGHT_WORDS[i]) !== -1) return { include: true, type: 'flight' };
  }

  // 4. Hotel / lodging keywords
  for (i = 0; i < HOTEL_WORDS.length; i++) {
    if (titleLower.indexOf(HOTEL_WORDS[i]) !== -1) return { include: true, type: 'hotel' };
  }

  // 5. Transport keywords
  for (i = 0; i < TRANSPORT_WORDS.length; i++) {
    if (titleLower.indexOf(TRANSPORT_WORDS[i]) !== -1) return { include: true, type: 'transport' };
  }

  // 6. Destination keyword extraction (words ≥3 chars not in stop list)
  var destKeywords = (tripLabel || '').toLowerCase()
    .split(/[^a-z]+/)
    .filter(function(w) { return w.length >= 3 && !STOP_WORDS[w]; });

  // 7–9. Location-based match
  if (locationLower) {
    for (i = 0; i < destKeywords.length; i++) {
      if (locationLower.indexOf(destKeywords[i]) !== -1) return { include: true, type: 'calendar' };
    }
    return { include: false }; // location present but doesn't match destination
  }

  // 9. No location, no travel keyword → exclude
  return { include: false };
}

function findItineraryRow_(id) {
  if (!id) throw new Error('Missing itinerary item ID');
  const sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Itinerary tab is empty');
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) return { sheet, rowNum: i + 2 };
  }
  throw new Error('Itinerary item not found: ' + id);
}

/**
 * Returns all stored itinerary items for a trip + auto-pulled calendar events
 * within the trip date range.
 * Params: tripKey (required), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD)
 */
function webGetItinerary_(e) {
  const p       = e.parameter || {};
  const tripKey = (p.tripKey   || '').trim();
  const start   = (p.startDate || '').trim();
  const end     = (p.endDate   || '').trim();
  if (!tripKey) throw new Error('tripKey is required');

  const tz    = Session.getScriptTimeZone();
  const items = [];

  // 1. Stored itinerary items
  const sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
  if (sheet && sheet.getLastRow() >= 2) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
    data.forEach(function(row, idx) {
      if (!String(row[0]).trim()) return;           // blank row
      if (String(row[1]).trim() !== tripKey) return; // different trip
      const meta = String(row[9] || '').trim();
      // Cells that were auto-converted to Date by Sheets must be re-formatted as strings
      function fmtDate_(v) {
        if (!v && v !== 0) return '';
        return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v).trim();
      }
      function fmtTime_(v) {
        if (!v && v !== 0) return '';
        return v instanceof Date ? Utilities.formatDate(v, tz, 'HH:mm') : String(v).trim();
      }
      items.push({
        id:        String(row[0]).trim(),
        tripKey:   String(row[1]).trim(),
        type:      String(row[2]).trim() || 'manual',
        title:     String(row[3]).trim(),
        date:      fmtDate_(row[4]),
        startTime: fmtTime_(row[5]),
        endTime:   fmtTime_(row[6]),
        location:  String(row[7]).trim(),
        notes:     String(row[8]).trim(),
        metadata:  meta,
        source:    'manual',
        row:       idx + 2,
      });
    });
  }

  // 2. Auto-pull calendar events within trip date range (smart-filtered, read-only)
  if (start && end) {
    try {
      const startDt   = new Date(start + 'T00:00:00');
      const endDt     = new Date(end   + 'T23:59:59');
      const tripLabel = tripKey.split('|')[1] || ''; // e.g. "Alaska Trip" from "2026-05-10|Alaska Trip"

      // Fetch per-event timezone via Calendar Advanced Service.
      // CalendarApp doesn't expose per-event timezone; Calendar.Events.list() does.
      // Keys stored as both resource id and iCalUID since ev.getId() returns iCalUID.
      var eventTzMap = {};  // eventId/iCalUID → { startTz, endTz }
      CalendarApp.getAllCalendars().forEach(function(cal) {
        try {
          var result = Calendar.Events.list(cal.getId(), {
            singleEvents: true,
            maxResults:   500,
            timeMin:      startDt.toISOString(),
            timeMax:      endDt.toISOString(),
            fields:       'items(id,iCalUID,start/timeZone,end/timeZone)',
          });
          (result.items || []).forEach(function(item) {
            var entry = {
              startTz: (item.start && item.start.timeZone) || null,
              endTz:   (item.end   && item.end.timeZone)   || null,
            };
            if (item.id)      eventTzMap[item.id]      = entry;
            if (item.iCalUID) eventTzMap[item.iCalUID] = entry;
          });
        } catch (tzErr) {
          Logger.log('Itinerary: TZ fetch failed for ' + cal.getId() + ' — ' + tzErr.message);
        }
      });

      CalendarApp.getAllCalendars().forEach(function(cal) {
        try {
          cal.getEvents(startDt, endDt).forEach(function(ev) {
            const evTitle    = (ev.getTitle()    || '(No title)').trim();
            const evLocation = (ev.getLocation() || '').trim();

            // Smart filter: only keep travel-relevant events
            var relevance = isItineraryCalendarRelevant_(evTitle, evLocation, tripLabel);
            if (!relevance.include) return;

            const evStart  = ev.getStartTime();
            // Use per-event timezones: departure city TZ for start, arrival city TZ for end.
            // Falls back to script TZ if the event has no explicit timezone.
            var evTzInfo  = eventTzMap[ev.getId()] || {};
            var evStartTz = evTzInfo.startTz || tz;
            var evEndTz   = evTzInfo.endTz   || tz;
            const evDate  = Utilities.formatDate(evStart, evStartTz, 'yyyy-MM-dd');
            const evTime  = ev.isAllDayEvent() ? '' : Utilities.formatDate(evStart, evStartTz, 'HH:mm');
            const evEnd   = ev.isAllDayEvent() ? '' : Utilities.formatDate(ev.getEndTime(), evEndTz, 'HH:mm');
            // Build metadata: always include calendarName; include startTz/endTz when available
            var evMeta = { calendarName: cal.getName() };
            if (evTzInfo.startTz) evMeta.startTz = evTzInfo.startTz;
            if (evTzInfo.endTz && evTzInfo.endTz !== evTzInfo.startTz) evMeta.endTz = evTzInfo.endTz;
            // For multi-day events (e.g. hotel stays spanning several nights), store the checkout
            // date in metadata so the frontend gap detector covers the full date range.
            if (ev.isAllDayEvent()) {
              var allDayEnd = new Date(ev.getEndTime());
              allDayEnd.setDate(allDayEnd.getDate() - 1); // GAS all-day end is exclusive
              var allDayEndStr = Utilities.formatDate(allDayEnd, tz, 'yyyy-MM-dd');
              if (allDayEndStr !== evDate) evMeta.checkoutDate = allDayEndStr;
            } else {
              var timedEndDate = Utilities.formatDate(ev.getEndTime(), evEndTz, 'yyyy-MM-dd');
              if (timedEndDate !== evDate) evMeta.checkoutDate = timedEndDate;
            }
            items.push({
              id:        'CAL-' + ev.getId().replace(/[^a-z0-9]/gi, '').substring(0, 16),
              tripKey:   tripKey,
              type:      relevance.type,    // 'flight' / 'hotel' / 'transport' / 'calendar'
              title:     evTitle,
              date:      evDate,
              startTime: evTime,
              endTime:   evEnd,
              location:  evLocation,
              notes:     '',
              metadata:  JSON.stringify(evMeta),
              source:    'calendar',
              row:       null,
            });
          });
        } catch (calErr) { /* skip inaccessible calendar */ }
      });
    } catch (calEx) {
      Logger.log('Itinerary: calendar pull failed — ' + calEx.message);
    }
  }

  // 3. Sort ascending by date + startTime (events with no time sort to start of day)
  items.sort(function(a, b) {
    const ak = a.date + '|' + (a.startTime || '00:00');
    const bk = b.date + '|' + (b.startTime || '00:00');
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });

  return { ok: true, tripKey: tripKey, items: items };
}

function webAddItineraryItem_(e) {
  const p       = e.parameter || {};
  const tripKey = (p.tripKey || '').trim();
  const title   = (p.title   || '').trim();
  if (!tripKey || !title) throw new Error('tripKey and title are required');

  const sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
  if (!sheet) throw new Error('Itinerary tab not found');

  const tz      = Session.getScriptTimeZone();
  const today   = new Date();
  const dateKey = Utilities.formatDate(today, tz, 'yyyyMMdd');
  const lastRow = sheet.getLastRow();
  let seq = 1;
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(r) {
      if (String(r[0]).indexOf('ITIN-' + dateKey) === 0) seq++;
    });
  }
  const id = 'ITIN-' + dateKey + '-' + String(seq).padStart(2, '0');

  // ITINERARY_HEADERS: ID|Trip Key|Type|Title|Date|Start Time|End Time|Location|Notes|Metadata
  const newRow = sheet.getLastRow() + 1;
  // Force Date (col 5), Start Time (col 6), End Time (col 7) to Plain Text so Sheets
  // does not auto-convert date/time strings to date serial numbers (Dec 30 1899 = serial 0 bug)
  sheet.getRange(newRow, 5, 1, 3).setNumberFormat('@');
  sheet.getRange(newRow, 1, 1, ITINERARY_HEADERS.length).setValues([[
    id,
    tripKey,
    (p.type      || 'manual').trim(),
    title,
    (p.date      || '').trim(),
    (p.startTime || '').trim(),
    (p.endTime   || '').trim(),
    (p.location  || '').trim(),
    (p.notes     || '').trim(),
    (p.metadata  || '').trim(),
  ]]);
  return { ok: true, id: id, action: 'created' };
}

function webUpdateItineraryItem_(e) {
  const p     = e.parameter || {};
  const found = findItineraryRow_((p.id || '').trim());
  // ITINERARY_HEADERS: ID(1)|TripKey(2)|Type(3)|Title(4)|Date(5)|StartTime(6)|EndTime(7)|Location(8)|Notes(9)|Metadata(10)
  if (p.type      != null) found.sheet.getRange(found.rowNum, 3).setValue(p.type.trim());
  if (p.title     != null) found.sheet.getRange(found.rowNum, 4).setValue(p.title.trim());
  if (p.date      != null) { var dc = found.sheet.getRange(found.rowNum, 5); dc.setNumberFormat('@'); dc.setValue(p.date.trim()); }
  if (p.startTime != null) { var sc = found.sheet.getRange(found.rowNum, 6); sc.setNumberFormat('@'); sc.setValue(p.startTime.trim()); }
  if (p.endTime   != null) { var ec = found.sheet.getRange(found.rowNum, 7); ec.setNumberFormat('@'); ec.setValue(p.endTime.trim()); }
  if (p.location  != null) found.sheet.getRange(found.rowNum, 8).setValue(p.location.trim());
  if (p.notes     != null) found.sheet.getRange(found.rowNum, 9).setValue(p.notes.trim());
  if (p.metadata  != null) found.sheet.getRange(found.rowNum, 10).setValue(p.metadata.trim());
  return { ok: true, id: p.id, action: 'updated' };
}

function webDeleteItineraryItem_(e) {
  const id    = ((e.parameter && e.parameter.id) || '').trim();
  const found = findItineraryRow_(id);
  found.sheet.deleteRow(found.rowNum);
  return { ok: true, id: id, action: 'deleted' };
}

// ---- Packing + Trip Context (Issue #64) ------------------------------------

/**
 * Find a row in PackingItems by ID. Mirrors findItineraryRow_.
 */
function findPackingRow_(id) {
  if (!id) throw new Error('Missing packing item ID');
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.PACKING_ITEMS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('PackingItems tab is empty');
  const numRows = sheet.getLastRow() - 1;
  const ids     = sheet.getRange(2, 1, numRows, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) return { sheet, rowNum: i + 2 };
  }
  throw new Error('Packing item not found: ' + id);
}

/**
 * GET get_trip_meta — params: tripKey
 * Returns { ok, tripKey, context, notes }
 */
function webGetTripMeta_(e) {
  const p       = (e && e.parameter) ? e.parameter : {};
  const tripKey = (p.tripKey || '').trim();
  if (!tripKey) throw new Error('tripKey is required');

  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.TRIP_META, TRIP_META_HEADERS);
  const sheet = ss.getSheetByName(TABS.TRIP_META);

  if (sheet.getLastRow() >= 2) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, TRIP_META_HEADERS.length).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === tripKey) {
        return { ok: true, tripKey, context: String(data[i][1] || ''), notes: String(data[i][2] || ''), traveler: String(data[i][4] || '') };
      }
    }
  }
  return { ok: true, tripKey, context: '', notes: '', traveler: '' };
}

/**
 * GET set_trip_meta — params: tripKey, context, notes
 * Upserts TripMeta row. Returns { ok }
 */
function webSetTripMeta_(e) {
  const p       = (e && e.parameter) ? e.parameter : {};
  const tripKey = (p.tripKey || '').trim();
  if (!tripKey) throw new Error('tripKey is required');

  const ss    = getSpreadsheet();
  ensureSheet(ss, TABS.TRIP_META, TRIP_META_HEADERS);
  const sheet = ss.getSheetByName(TABS.TRIP_META);
  const tz    = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  if (sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === tripKey) {
        const rowNum = i + 2;
        sheet.getRange(rowNum, 2).setValue((p.context  || '').trim());
        sheet.getRange(rowNum, 3).setValue((p.notes    || '').trim());
        sheet.getRange(rowNum, 5).setValue((p.traveler || '').trim());
        const dc = sheet.getRange(rowNum, 4);
        dc.setNumberFormat('@');
        dc.setValue(today);
        return { ok: true };
      }
    }
  }

  // Append new row
  const newRow = sheet.getLastRow() + 1;
  const dateCell = sheet.getRange(newRow, 4);
  dateCell.setNumberFormat('@');
  sheet.getRange(newRow, 1, 1, TRIP_META_HEADERS.length).setValues([[
    tripKey,
    (p.context  || '').trim(),
    (p.notes    || '').trim(),
    today,
    (p.traveler || '').trim(),
  ]]);
  return { ok: true };
}

/**
 * GET get_packing — params: tripKey
 * Returns { ok, tripKey, items: [...], meta: { context, notes } }
 */
function webGetPacking_(e) {
  const p       = (e && e.parameter) ? e.parameter : {};
  const tripKey = (p.tripKey || '').trim();
  if (!tripKey) throw new Error('tripKey is required');

  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.PACKING_ITEMS, PACKING_ITEM_HEADERS);
  const sheet = ss.getSheetByName(TABS.PACKING_ITEMS);

  const items = [];
  if (sheet.getLastRow() >= 2) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues();
    data.forEach(function(row) {
      if (String(row[1]).trim() !== tripKey) return;
      items.push({
        id:        String(row[0]).trim(),
        tripKey:   String(row[1]).trim(),
        person:    String(row[2]).trim(),
        category:  String(row[3]).trim(),
        item:      String(row[4]).trim(),
        checked:   String(row[5]).toUpperCase() === 'TRUE',
        source:    String(row[6]).trim() || 'manual',
        addedDate: String(row[7]).trim(),
      });
    });
  }

  // Sort: ahmed → victoria → shared, then category, then item
  const personOrder = { ahmed: 0, victoria: 1, shared: 2 };
  items.sort(function(a, b) {
    const pa = personOrder[a.person] !== undefined ? personOrder[a.person] : 99;
    const pb = personOrder[b.person] !== undefined ? personOrder[b.person] : 99;
    if (pa !== pb) return pa - pb;
    if (a.category < b.category) return -1;
    if (a.category > b.category) return  1;
    if (a.item < b.item) return -1;
    if (a.item > b.item) return  1;
    return 0;
  });

  // Also fetch trip meta (context)
  let meta = { context: '', notes: '' };
  try {
    const metaResult = webGetTripMeta_(e);
    meta = { context: metaResult.context || '', notes: metaResult.notes || '' };
  } catch(err) { /* graceful */ }

  return { ok: true, tripKey, items, meta };
}

/**
 * GET add_packing_item — params: tripKey, person, category, item
 * Returns { ok, id }
 */
function webAddPackingItem_(e) {
  const p        = (e && e.parameter) ? e.parameter : {};
  const tripKey  = (p.tripKey  || '').trim();
  const person   = (p.person   || '').trim();
  const category = (p.category || '').trim();
  const item     = (p.item     || '').trim();
  if (!tripKey || !person || !category || !item) {
    throw new Error('tripKey, person, category and item are required');
  }

  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.PACKING_ITEMS, PACKING_ITEM_HEADERS);
  const sheet = ss.getSheetByName(TABS.PACKING_ITEMS);
  const tz    = Session.getScriptTimeZone();

  // Generate ID: PACK-YYYYMMDD-NN
  const dateKey = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  let seq = 1;
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function(r) {
      if (String(r[0]).indexOf('PACK-' + dateKey) === 0) seq++;
    });
  }
  const id = 'PACK-' + dateKey + '-' + String(seq).padStart(2, '0');

  const newRow    = sheet.getLastRow() + 1;
  const addedDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // Prevent Sheets auto-converting Checked and Added Date columns
  sheet.getRange(newRow, 6).setNumberFormat('@');
  sheet.getRange(newRow, 8).setNumberFormat('@');
  sheet.getRange(newRow, 1, 1, PACKING_ITEM_HEADERS.length).setValues([[
    id, tripKey, person, category, item, 'FALSE', 'manual', addedDate,
  ]]);

  return { ok: true, id };
}

/**
 * GET update_packing_item — params: id, checked?, item?, category?
 * Returns { ok, id }
 */
function webUpdatePackingItem_(e) {
  const p     = (e && e.parameter) ? e.parameter : {};
  const id    = (p.id || '').trim();
  const found = findPackingRow_(id);

  if (p.checked != null) {
    const val   = (p.checked === 'true' || p.checked === 'TRUE') ? 'TRUE' : 'FALSE';
    const cell  = found.sheet.getRange(found.rowNum, 6);
    cell.setNumberFormat('@');
    cell.setValue(val);
  }
  if (p.item     != null) found.sheet.getRange(found.rowNum, 5).setValue(p.item.trim());
  if (p.category != null) found.sheet.getRange(found.rowNum, 4).setValue(p.category.trim());

  return { ok: true, id };
}

/**
 * GET delete_packing_item — params: id
 * Returns { ok, id }
 */
function webDeletePackingItem_(e) {
  const p     = (e && e.parameter) ? e.parameter : {};
  const id    = (p.id || '').trim();
  const found = findPackingRow_(id);
  found.sheet.deleteRow(found.rowNum);
  return { ok: true, id };
}

/**
 * Geocode a destination string via Open-Meteo geocoding API.
 * Returns { lat, lon, name } or null on failure.
 */
function geocodePackingDestination_(destination) {
  if (!destination) return null;
  // Cache geocoding results for 6 hours — coordinates don't change
  var cacheKey = 'geocode_' + destination.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch(e_) {}
    }
  } catch(e_) {}
  try {
    const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
                encodeURIComponent(destination) + '&count=1&language=en&format=json';
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(resp.getContentText());
    if (!data.results || data.results.length === 0) return null;
    const r = data.results[0];
    var result = { lat: r.latitude, lon: r.longitude, name: r.name };
    try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 21600); } catch(e_) {}
    return result;
  } catch(err) {
    Logger.log('Packing geocode error: ' + err.message);
    return null;
  }
}

/**
 * Fetch weather summary for packing. Uses Open-Meteo forecast (≤14 days)
 * or prior-year archive (>14 days). Returns plain-English string or ''.
 */
function getPackingWeather_(destination, startDate, endDate) {
  if (!destination) return '';
  // Cache weather results for 6 hours (CacheService maximum TTL).
  // Prevents redundant fetches when nightlyRun and the dashboard request
  // weather for the same trip within the same timeframe.
  var wCacheKey = 'weather_' + (destination + '_' + startDate + '_' + endDate)
    .toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
  try {
    var wCached = CacheService.getScriptCache().get(wCacheKey);
    if (wCached) return wCached;
  } catch(e_) {}
  try {
    const geo = geocodePackingDestination_(destination);
    if (!geo) return '';
    const lat = geo.lat, lon = geo.lon;

    const today      = new Date();
    const tripStart  = new Date(startDate + 'T00:00:00');
    const daysUntil  = Math.floor((tripStart - today) / 86400000);
    const useForecast = daysUntil <= 14;

    let weatherUrl;
    let isArchive = false;
    if (useForecast) {
      weatherUrl =
        'https://api.open-meteo.com/v1/forecast' +
        '?latitude=' + lat + '&longitude=' + lon +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code' +
        '&start_date=' + startDate + '&end_date=' + endDate +
        '&timezone=auto&temperature_unit=fahrenheit';
    } else {
      isArchive = true;
      const yearOffset = parseInt(startDate.substring(0, 4), 10) - 1;
      const prevStart  = yearOffset + startDate.substring(4);
      const prevEnd    = yearOffset + endDate.substring(4);
      weatherUrl =
        'https://archive-api.open-meteo.com/v1/archive' +
        '?latitude=' + lat + '&longitude=' + lon +
        '&start_date=' + prevStart + '&end_date=' + prevEnd +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum' +
        '&temperature_unit=fahrenheit';
    }

    const wResp = UrlFetchApp.fetch(weatherUrl, { muteHttpExceptions: true });
    const wData = JSON.parse(wResp.getContentText());
    if (!wData.daily) return '';

    const maxTemps  = wData.daily.temperature_2m_max  || [];
    const minTemps  = wData.daily.temperature_2m_min  || [];
    const rainSums  = wData.daily.precipitation_sum   || [];
    if (maxTemps.length === 0) return '';

    const maxTemp  = Math.round(Math.max.apply(null, maxTemps.filter(function(x) { return x != null; })));
    const minTemp  = Math.round(Math.min.apply(null, minTemps.filter(function(x) { return x != null; })));
    const rainDays = rainSums.filter(function(x) { return x != null && x > 1; }).length;
    const tripDays = rainSums.length || 1;
    const rainFrac = rainDays / tripDays;

    let rainDesc;
    if (rainFrac >= 0.5)      rainDesc = 'frequent rain';
    else if (rainFrac >= 0.3) rainDesc = 'some rain';
    else if (rainFrac > 0)    rainDesc = 'minimal rain';
    else                      rainDesc = 'dry';

    let tempNote;
    if (maxTemp > 85)       tempNote = 'Hot — pack light breathable clothing.';
    else if (maxTemp > 70)  tempNote = 'Warm — light layers recommended.';
    else if (minTemp < 40)  tempNote = 'Cold — pack warm layers and a coat.';
    else                    tempNote = 'Mild — a light jacket should suffice.';

    let summary = (isArchive ? '(Seasonal average) ' : '') +
                  'Expected: ' + minTemp + '\u2013' + maxTemp + '\u00b0F, ' + rainDesc + '. ' + tempNote;
    Logger.log('Packing weather for ' + destination + ': ' + summary);
    try { CacheService.getScriptCache().put(wCacheKey, summary, 21600); } catch(e_) {}
    return summary;
  } catch(err) {
    Logger.log('getPackingWeather_ error: ' + err.message);
    return '';
  }
}

/**
 * Build the Claude prompt for packing list generation.
 */
function buildPackingPrompt_(tripLabel, startDate, endDate, durationNights,
                              context, traveler, destination, season,
                              itinerarySummary, weatherSummary,
                              activityTypes, dressCodes, freeDays) {
  var travelersLine = traveler
    ? 'Travelers: ' + traveler
    : 'Travelers: Ahmed and Victoria';
  var contextLine = 'Trip Context: ' + (context || 'General travel');
  var weatherLine = weatherSummary
    ? 'Weather: ' + weatherSummary
    : 'Weather: Unknown \u2014 pack for general conditions';
  var destLine  = destination
    ? 'Destination: ' + destination + (season ? ' (' + season + ')' : '')
    : '';
  var datesLine = 'Dates: ' + startDate + ' to ' + endDate +
                  ' (' + durationNights + ' nights' + (season ? ', ' + season : '') + ')';

  // Activity-specific hints — only emit lines relevant to this trip
  var hints = [];
  if (activityTypes.beach || activityTypes.snorkeling || activityTypes.diving || activityTypes.swimming) {
    hints.push('- Beach/water activities: include swimwear, water shoes, dry bag, reef-safe sunscreen.');
  }
  if (activityTypes.hiking || activityTypes.trekking || activityTypes.outdoor) {
    hints.push('- Hiking/outdoor: include trail shoes, daypack, moisture-wicking layers.');
  }
  if (activityTypes.skiing || activityTypes.snowboard) {
    hints.push('- Winter sports: include thermals, ski socks, goggles, gloves, neck gaiter.');
  }
  if (activityTypes.spa) {
    hints.push('- Spa day: comfortable loose clothes and flip flops.');
  }
  if (activityTypes.show || activityTypes.museum || activityTypes.theater) {
    hints.push('- Cultural/show event: ensure at least one smart-casual or formal outfit.');
  }
  if (activityTypes.theme_park) {
    hints.push('- Theme park: comfortable walking shoes, layers.');
  }
  if (activityTypes.cruise || activityTypes.ferry) {
    hints.push('- Cruise/boat: sea-sickness meds, wind layers, formal night outfit.');
  }
  if (activityTypes.dining) {
    hints.push('- Fine dining: check dress code and pack accordingly.');
  }
  if (freeDays > 0) {
    hints.push('- ' + freeDays + ' free/unscheduled day(s): versatile casual wear for exploration.');
  }
  if (dressCodes && dressCodes.length > 0) {
    var uniqueDressCodes = dressCodes.filter(function(v, i, a) { return a.indexOf(v) === i; });
    hints.push('- Reservation dress codes noted: ' + uniqueDressCodes.join(', ') + '. Pack to match the strictest.');
  }

  return (
    'You are VERA, a smart packing assistant for Ahmed and Victoria, a US-based couple.\n\n' +
    'Trip: ' + tripLabel + '\n' +
    (destLine ? destLine + '\n' : '') +
    datesLine + '\n' +
    travelersLine + '\n' +
    contextLine + '\n' +
    weatherLine + '\n\n' +
    (itinerarySummary ? '=== ITINERARY ===\n' + itinerarySummary + '\n\n' : '') +
    'Generate a practical packing list split across "ahmed", "victoria", and "shared"\n' +
    '(shared = items only needed once: adapters, sunscreen, first aid kit, travel umbrella, etc.).\n' +
    'Group by category. Use concise names like: Documents, Clothing, Shoes, Toiletries,\n' +
    'Electronics, Medications, Entertainment, Beach/Pool, Outdoor/Hiking, Formal/Dress, Snacks, Romantic.\n\n' +
    'RULES:\n' +
    '- Match context: Anniversary/Romantic/Honeymoon \u2192 nicer clothes + Romantic category;\n' +
    '  Work Trip \u2192 laptop, charger, business clothes; Family \u2192 shared snacks/kids items if relevant.\n' +
    '- Match weather: rain \u2192 rain jacket; hot \u2192 sunscreen + light clothes; cold \u2192 layers + coat.\n' +
    '- 30\u201360 total items max. Keep item names concise (e.g. "3 T-shirts", not "t-shirt 1, t-shirt 2").\n' +
    '- Do NOT include basic everyday items unless travel-specific (e.g. include "travel toothbrush" not just "toothbrush").\n' +
    (hints.length ? '\nACTIVITY-SPECIFIC RULES:\n' + hints.join('\n') + '\n' : '') +
    '\nCRITICAL \u2014 RESPONSE FORMAT:\n' +
    'Return ONLY a raw JSON object. No markdown. No code fences. No explanation.\n' +
    'Start with { and end with }.\n\n' +
    '{"ahmed":[{"category":"Documents","item":"Passport"},{"category":"Clothing","item":"3 T-shirts"}],' +
    '"victoria":[{"category":"Documents","item":"Passport"},{"category":"Clothing","item":"Swimsuit"}],' +
    '"shared":[{"category":"Electronics","item":"Universal adapter"},{"category":"Toiletries","item":"Sunscreen SPF 50"}]}\n\n' +
    'Generate the packing list now:'
  );
}

/**
 * Defensively parse Claude packing response. Returns { ahmed, victoria, shared } arrays.
 */
function parsePackingResponse_(rawContent) {
  try {
    let cleaned = (rawContent || '').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON object found');
    const parsed = JSON.parse(cleaned.substring(start, end + 1));
    return {
      ahmed:    Array.isArray(parsed.ahmed)    ? parsed.ahmed    : [],
      victoria: Array.isArray(parsed.victoria) ? parsed.victoria : [],
      shared:   Array.isArray(parsed.shared)   ? parsed.shared   : [],
    };
  } catch(err) {
    Logger.log('parsePackingResponse_ failed: ' + err.message + ' | raw: ' + (rawContent || '').substring(0, 200));
    return { ahmed: [], victoria: [], shared: [] };
  }
}

/**
 * GET generate_packing — params: tripKey, startDate, endDate
 * Generates a Claude-powered packing list (with weather context), saves to PackingItems tab.
 * Returns { ok, items: [...] }
 */
function webGeneratePacking_(e) {
  const p         = (e && e.parameter) ? e.parameter : {};
  const tripKey   = (p.tripKey   || '').trim();
  const startDate = (p.startDate || '').trim();
  const endDate   = (p.endDate   || '').trim();
  if (!tripKey) throw new Error('tripKey is required');

  // Step 1 — Parse trip label from tripKey ("YYYY-MM-DD|Label")
  const pipeIdx  = tripKey.indexOf('|');
  const tripLabel = pipeIdx >= 0 ? tripKey.substring(pipeIdx + 1) : tripKey;

  // Duration in nights
  let durationNights = '?';
  if (startDate && endDate) {
    try {
      const diff = (new Date(endDate + 'T00:00:00') - new Date(startDate + 'T00:00:00')) / 86400000;
      durationNights = Math.max(0, Math.round(diff)).toString();
    } catch(err) { /* ignore */ }
  }

  // Step 2 — Load itinerary items and build summary string
  const ss       = getSpreadsheet();
  const itinSheet = ss.getSheetByName(TABS.ITINERARY);
  let itinerarySummary = '';
  var activityTypes = {};  // e.g. { beach: true, dining: true, flight: true }
  var dressCodes    = [];  // dress codes collected from email-enriched metadata
  if (itinSheet && itinSheet.getLastRow() >= 2) {
    const itinData = itinSheet.getRange(2, 1, itinSheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
    const lines = [];
    itinData.forEach(function(row) {
      if (String(row[1]).trim() !== tripKey) return;
      const date  = String(row[4]).trim();
      const itype = String(row[2]).trim().toLowerCase();
      const title = String(row[3]).trim();
      const loc   = String(row[7]).trim();
      if (itype) activityTypes[itype] = true;

      var dresscode     = '';
      var importantNote = '';
      if (row[9]) {
        try {
          var meta = JSON.parse(String(row[9]));
          if (meta.dresscode)      { dresscode = meta.dresscode; dressCodes.push(meta.dresscode); }
          if (meta.importantNotes) importantNote = meta.importantNotes;
        } catch(e_) { /* skip unparseable metadata */ }
      }

      let line = '\u2022 [' + itype + '] ' + title;
      if (date)          line = date + ' ' + line;
      if (loc)           line += ' @ ' + loc;
      if (dresscode)     line += ' (dresscode: ' + dresscode + ')';
      if (importantNote) line += ' \u2014 ' + importantNote;
      lines.push(line);
    });
    itinerarySummary = lines.join('\n');

    // Step 2b — Count free/unscheduled days
    var scheduledDates = {};
    lines.forEach(function(l) {
      var m = l.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) scheduledDates[m[1]] = true;
    });
    var freeDays = Math.max(0, parseInt(durationNights, 10) - Object.keys(scheduledDates).length);
    if (isNaN(freeDays)) freeDays = 0;
  } else {
    var freeDays = 0;
  }

  // Step 3 — Load trip context and traveler
  let context  = '';
  var traveler = '';
  try {
    const metaResult = webGetTripMeta_(e);
    context  = metaResult.context  || '';
    traveler = metaResult.traveler || '';
  } catch(err) { /* graceful */ }

  // Step 4 — Infer destination for weather
  let destination = '';
  if (!destination && itinSheet && itinSheet.getLastRow() >= 2) {
    const itinData = itinSheet.getRange(2, 1, itinSheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
    // a. Flight metadata.dest
    for (let i = 0; i < itinData.length; i++) {
      const row = itinData[i];
      if (String(row[1]).trim() !== tripKey) continue;
      if (String(row[2]).trim() === 'flight' && row[9]) {
        try {
          const meta = JSON.parse(String(row[9]));
          if (meta.dest) { destination = meta.dest; break; }
        } catch(err) { /* skip */ }
      }
    }
    // b. Hotel location
    if (!destination) {
      for (let i = 0; i < itinData.length; i++) {
        const row = itinData[i];
        if (String(row[1]).trim() !== tripKey) continue;
        if (String(row[2]).trim() === 'hotel' && String(row[7]).trim()) {
          destination = String(row[7]).trim(); break;
        }
      }
    }
  }
  // c. Trip label (strip generic words)
  if (!destination) {
    destination = tripLabel
      .replace(/\b(trip|adventure|vacation|holiday|weekend|getaway|tour|visit)\b/gi, '')
      .trim();
  }

  // Step 4b — Derive season from startDate month
  var season = '';
  if (startDate) {
    var mo = parseInt(startDate.substring(5, 7), 10);
    season = (mo <= 2 || mo === 12) ? 'Winter'
           : mo <= 5  ? 'Spring'
           : mo <= 8  ? 'Summer'
           : 'Fall';
  }

  // Step 5 — Weather
  const weatherSummary = getPackingWeather_(destination, startDate || '', endDate || '');

  // Step 6 — Build prompt with full enriched context
  const prompt = buildPackingPrompt_(
    tripLabel, startDate, endDate, durationNights,
    context, traveler, destination, season,
    itinerarySummary, weatherSummary,
    activityTypes, dressCodes, freeDays
  );

  // Step 7 — Call Claude
  const apiKey = getApiKey();
  const requestBody = {
    model:      CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  };
  const fetchOptions = {
    method:  'post',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload:            JSON.stringify(requestBody),
    muteHttpExceptions: true,
  };
  const response = UrlFetchApp.fetch(CLAUDE_API_URL, fetchOptions);
  const json     = JSON.parse(response.getContentText());
  if (!json.content || !json.content[0]) throw new Error('Claude API returned unexpected response');
  const rawText = json.content[0].text || '';

  // Step 8 — Parse response
  const packingData = parsePackingResponse_(rawText);

  // Step 9 — Clear existing AI items for this trip (bottom-to-top to avoid row shifting)
  ensureSheet(ss, TABS.PACKING_ITEMS, PACKING_ITEM_HEADERS);
  const packSheet = ss.getSheetByName(TABS.PACKING_ITEMS);
  if (packSheet.getLastRow() >= 2) {
    const allRows = packSheet.getRange(2, 1, packSheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues();
    const rowsToDelete = [];
    for (let i = 0; i < allRows.length; i++) {
      if (String(allRows[i][1]).trim() === tripKey && String(allRows[i][6]).trim() === 'ai') {
        rowsToDelete.push(i + 2); // 1-based row number
      }
    }
    rowsToDelete.sort(function(a, b) { return b - a; }); // descending
    rowsToDelete.forEach(function(rowNum) { packSheet.deleteRow(rowNum); });
  }

  // Step 10 — Batch-append new AI items
  const tz      = Session.getScriptTimeZone();
  const dateKey = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  const addedDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  let seq = 1;
  if (packSheet.getLastRow() >= 2) {
    packSheet.getRange(2, 1, packSheet.getLastRow() - 1, 1).getValues().forEach(function(r) {
      if (String(r[0]).indexOf('PACK-' + dateKey) === 0) seq++;
    });
  }

  const allNewItems = [];
  [['ahmed', packingData.ahmed], ['victoria', packingData.victoria], ['shared', packingData.shared]]
    .forEach(function(pair) {
      const person = pair[0];
      const list   = pair[1];
      list.forEach(function(entry) {
        if (!entry.item) return;
        allNewItems.push([
          'PACK-' + dateKey + '-' + String(seq++).padStart(2, '0'),
          tripKey,
          person,
          entry.category || 'General',
          entry.item,
          'FALSE',
          'ai',
          addedDate,
        ]);
      });
    });

  if (allNewItems.length > 0) {
    const startRow = packSheet.getLastRow() + 1;
    // Set plain-text format on Checked (col 6) and Added Date (col 8) for all new rows
    packSheet.getRange(startRow, 6, allNewItems.length, 1).setNumberFormat('@');
    packSheet.getRange(startRow, 8, allNewItems.length, 1).setNumberFormat('@');
    packSheet.getRange(startRow, 1, allNewItems.length, PACKING_ITEM_HEADERS.length).setValues(allNewItems);
  }

  // Return all items for this trip
  return webGetPacking_(e);
}

// ---- Trip Recommendations (Issue #73) --------------------------------------

/**
 * GET recommendations — params: tripKey
 * Returns all recommendation rows for the given trip.
 */
function webGetRecommendations_(e) {
  const p       = (e && e.parameter) ? e.parameter : {};
  const tripKey = (p.tripKey || '').trim();
  if (!tripKey) throw new Error('tripKey is required');
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.TRIP_RECOMMENDATIONS, TRIP_RECS_HEADERS);
  const sheet = ss.getSheetByName(TABS.TRIP_RECOMMENDATIONS);
  if (sheet.getLastRow() < 2) return { ok: true, recs: [] };
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, TRIP_RECS_HEADERS.length).getValues();
  const recs = [];
  data.forEach(function(row) {
    if (String(row[1]).trim() !== tripKey) return;
    recs.push({
      id:          String(row[0]).trim(),
      tripKey:     String(row[1]).trim(),
      date:        String(row[2]).trim(),
      type:        String(row[3]).trim(),
      title:       String(row[4]).trim(),
      description: String(row[5]).trim(),
      rationale:   String(row[6]).trim(),
      priceRange:  String(row[7]).trim(),
      link:        String(row[8]).trim(),
      status:      String(row[9]).trim() || 'pending',
      source:      String(row[10]).trim(),
      generatedAt: String(row[11]).trim(),
    });
  });
  return { ok: true, recs: recs };
}

/**
 * GET update_recommendation — params: id, status ('added'|'dismissed'|'pending')
 * Updates the status of a recommendation row.
 */
function webUpdateRecommendation_(e) {
  const p      = (e && e.parameter) ? e.parameter : {};
  const id     = (p.id     || '').trim();
  const status = (p.status || '').trim();
  if (!id || !status) throw new Error('id and status are required');
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.TRIP_RECOMMENDATIONS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Recommendation not found: ' + id);
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) {
      sheet.getRange(i + 2, 10).setValue(status); // col 10 = Status (1-based)
      return { ok: true, id: id, status: status };
    }
  }
  throw new Error('Recommendation not found: ' + id);
}

/**
 * GET accept_recommendation — params: recId, tripKey
 * Converts a recommendation into a real Itinerary row and marks it as 'added'.
 */
function webAcceptRecommendation_(e) {
  const p       = (e && e.parameter) ? e.parameter : {};
  const recId   = (p.recId   || '').trim();
  const tripKey = (p.tripKey || '').trim();
  if (!recId || !tripKey) throw new Error('recId and tripKey are required');

  const ss       = getSpreadsheet();
  const recSheet = ss.getSheetByName(TABS.TRIP_RECOMMENDATIONS);
  if (!recSheet || recSheet.getLastRow() < 2) throw new Error('Rec not found: ' + recId);

  const recData = recSheet.getRange(2, 1, recSheet.getLastRow() - 1, TRIP_RECS_HEADERS.length).getValues();
  let rec = null;
  let recRowNum = -1;
  for (let i = 0; i < recData.length; i++) {
    if (String(recData[i][0]).trim() === recId) {
      rec = {
        date:        String(recData[i][2]).trim(),
        type:        String(recData[i][3]).trim() || 'manual',
        title:       String(recData[i][4]).trim(),
        description: String(recData[i][5]).trim(),
        link:        String(recData[i][8]).trim(),
      };
      recRowNum = i + 2;
      break;
    }
  }
  if (!rec) throw new Error('Rec not found: ' + recId);

  // Add to Itinerary sheet
  const itinSheet = ss.getSheetByName(TABS.ITINERARY);
  if (!itinSheet) throw new Error('Itinerary sheet not found');
  const tz      = Session.getScriptTimeZone();
  const dateKey = Utilities.formatDate(new Date(), tz, 'yyyyMMddHHmmss');
  const newId   = 'ITIN-REC-' + dateKey;
  const metadata = rec.link ? JSON.stringify({ link: rec.link }) : '{}';
  const newRow  = itinSheet.getLastRow() + 1;
  itinSheet.getRange(newRow, 1, 1, ITINERARY_HEADERS.length).setValues([[
    newId, tripKey, rec.type, rec.title, rec.date, '', '', '', rec.description, metadata,
  ]]);

  // Mark rec as 'added'
  recSheet.getRange(recRowNum, 10).setValue('added');

  // Return updated recs for this trip
  return webGetRecommendations_({ parameter: { tripKey: tripKey } });
}

/**
 * Builds the Claude system prompt for trip recommendations.
 */
function buildRecsSystemPrompt_() {
  return (
    'You are VERA, an intelligent travel advisor for Ahmed and Victoria, a couple based near Washington DC (IAD). ' +
    'Your job is to analyze a trip itinerary and suggest specific, high-quality activities, restaurants, and experiences ' +
    'that fill experiential gaps. You have access to a web_search tool — use it 1-2 times to find real, ' +
    'current venues at the destination before writing your final recommendations. ' +
    'Be specific: real venue names, real addresses, real details from your searches.'
  );
}

/**
 * Builds the user message for trip recommendations.
 */
function buildRecsUserPrompt_(tripLabel, startDate, endDate, durationNights, context, destination, itinerarySummary, gapSummary) {
  return (
    'Trip: ' + tripLabel + '\n' +
    'Dates: ' + startDate + ' to ' + endDate + ' (' + durationNights + ' nights)\n' +
    'Context: ' + (context || 'General travel') + '\n' +
    'Destination: ' + (destination || tripLabel) + '\n\n' +
    '=== PLANNED ITINERARY ===\n' + (itinerarySummary || '(No items planned yet)') + '\n\n' +
    '=== DAY-BY-DAY GAP ANALYSIS ===\n' + gapSummary + '\n\n' +
    'Search the web for top attractions and dining in ' + (destination || tripLabel) + ' matching the trip context, ' +
    'then provide 8-15 targeted recommendations that fill the gaps above.\n\n' +
    'RULES:\n' +
    '- Prioritize days marked "NO DINING" with a dining rec, and days marked "NO ACTIVITIES" with an activity rec.\n' +
    '- Match context: Romantic/Anniversary/Honeymoon → spas, candlelit dinners, scenic spots; Work Trip → quick sights near hotel, good coffee; Family → family-friendly attractions.\n' +
    '- For layovers ≥ 6 hours, recommend things to do near the layover airport.\n' +
    '- Include a mix of: dining, activities, coffee/morning spots, and hidden gems.\n' +
    '- Use real venue names and real details from your web search.\n\n' +
    'CRITICAL — RESPONSE FORMAT:\n' +
    'Return ONLY a raw JSON array. No markdown. No code fences. No explanation. Start with [ and end with ].\n' +
    '[{"date":"YYYY-MM-DD","type":"dining","title":"Venue Name","description":"1-2 sentence description.","rationale":"Why this fills a gap.","priceRange":"$$","link":"https://..."},' +
    '{"date":"YYYY-MM-DD","type":"museum","title":"Attraction Name","description":"Description.","rationale":"Rationale.","priceRange":"$","link":""}]\n\n' +
    'Valid types: flight, train, hotel, reservation, dining, coffee, nightlife, winery, city_tour, museum, beach, mountain, camera, show, spa, skiing, snorkeling, theme_park, shopping, market, manual\n\n' +
    'Generate the recommendations now:'
  );
}

/**
 * Parses Claude's JSON array response for recommendations.
 * Returns an array of rec objects, or [] on failure.
 */
function parseRecsResponse_(rawContent) {
  try {
    var cleaned = (rawContent || '').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    var start = cleaned.indexOf('[');
    var end   = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('No JSON array found');
    var parsed = JSON.parse(cleaned.substring(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error('Expected array');
    return parsed.filter(function(r) { return r && r.title; });
  } catch(err) {
    Logger.log('parseRecsResponse_ failed: ' + err.message + ' | raw: ' + (rawContent || '').substring(0, 200));
    return [];
  }
}

/**
 * Builds a day-by-day gap analysis string for the Claude prompt.
 * Tells Claude which days have no dining / no activities planned.
 */
function buildRecsGapSummary_(tripKey, startDate, endDate, itinData) {
  var TRANSPORT = { flight: 1, train: 1, bus: 1, car: 1, ferry: 1, cruise: 1, walking: 1, bicycle: 1 };
  var DINING    = { dining: 1, reservation: 1, coffee: 1, nightlife: 1, winery: 1 };
  var ACTIVITY  = { city_tour: 1, museum: 1, beach: 1, mountain: 1, camera: 1, show: 1,
                    spa: 1, skiing: 1, snorkeling: 1, theme_park: 1, shopping: 1, market: 1 };

  // Build per-date coverage map
  var dateMap = {};
  itinData.forEach(function(row) {
    if (String(row[1]).trim() !== tripKey) return;
    var date = String(row[4]).trim();
    var type = String(row[2]).trim();
    if (!date) return;
    if (!dateMap[date]) dateMap[date] = { transport: false, hotel: false, dining: false, activity: false };
    if (TRANSPORT[type]) dateMap[date].transport = true;
    if (type === 'hotel' || type === 'cruise') dateMap[date].hotel = true;
    if (DINING[type])    dateMap[date].dining   = true;
    if (ACTIVITY[type])  dateMap[date].activity = true;
  });

  var tz    = Session.getScriptTimeZone();
  var lines = [];
  var d     = new Date(startDate + 'T12:00:00'); // noon to avoid DST edge cases
  var end   = new Date(endDate   + 'T12:00:00');
  while (d <= end) {
    var ds      = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    var dayName = Utilities.formatDate(d, tz, 'EEE MMM d');
    var info    = dateMap[ds] || {};
    var notes   = [];
    if (info.transport) notes.push('transport ✓');
    if (info.hotel)     notes.push('accommodation ✓');
    if (info.dining)    notes.push('dining ✓');
    else                notes.push('NO DINING');
    if (info.activity)  notes.push('activity ✓');
    else                notes.push('NO ACTIVITIES');
    lines.push(dayName + ': ' + notes.join(', '));
    d = new Date(d.getTime() + 86400000);
  }
  return lines.join('\n');
}

/**
 * GET generate_recommendations — params: tripKey, startDate, endDate
 * Runs Claude (with optional web search) to generate trip recommendations,
 * saves them to the TripRecommendations sheet, and returns all recs.
 */
function webGenerateRecommendations_(e) {
  const p         = (e && e.parameter) ? e.parameter : {};
  const tripKey   = (p.tripKey   || '').trim();
  const startDate = (p.startDate || '').trim();
  const endDate   = (p.endDate   || '').trim();
  if (!tripKey) throw new Error('tripKey is required');

  // Trip label
  const pipeIdx  = tripKey.indexOf('|');
  const tripLabel = pipeIdx >= 0 ? tripKey.substring(pipeIdx + 1) : tripKey;

  // Duration
  let durationNights = '?';
  if (startDate && endDate) {
    try {
      const diff = (new Date(endDate + 'T00:00:00') - new Date(startDate + 'T00:00:00')) / 86400000;
      durationNights = Math.max(0, Math.round(diff)).toString();
    } catch(err) { /* ignore */ }
  }

  // Load itinerary items
  const ss        = getSpreadsheet();
  const itinSheet = ss.getSheetByName(TABS.ITINERARY);
  let itinData = [];
  let itinerarySummary = '';
  if (itinSheet && itinSheet.getLastRow() >= 2) {
    itinData = itinSheet.getRange(2, 1, itinSheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
    const lines = [];
    itinData.forEach(function(row) {
      if (String(row[1]).trim() !== tripKey) return;
      const date  = String(row[4]).trim();
      const type  = String(row[2]).trim();
      const title = String(row[3]).trim();
      const loc   = String(row[7]).trim();
      let line = '• [' + type + '] ' + title;
      if (date) line = date + ' ' + line;
      if (loc)  line += ' @ ' + loc;
      lines.push(line);
    });
    itinerarySummary = lines.join('\n');
  }

  // Gap analysis string
  const gapSummary = buildRecsGapSummary_(tripKey, startDate, endDate, itinData);

  // Trip context
  let context = '';
  try { context = (webGetTripMeta_(e) || {}).context || ''; } catch(err) { /* graceful */ }

  // Infer destination (same logic as packing)
  let destination = '';
  for (let i = 0; i < itinData.length && !destination; i++) {
    const row = itinData[i];
    if (String(row[1]).trim() !== tripKey) continue;
    if (String(row[2]).trim() === 'flight' && row[9]) {
      try {
        const meta = JSON.parse(String(row[9]));
        if (meta.dest) { destination = meta.dest; break; }
      } catch(err) { /* skip */ }
    }
  }
  for (let i = 0; i < itinData.length && !destination; i++) {
    const row = itinData[i];
    if (String(row[1]).trim() !== tripKey) continue;
    if (String(row[2]).trim() === 'hotel' && String(row[7]).trim()) {
      destination = String(row[7]).trim();
    }
  }
  if (!destination) {
    destination = tripLabel
      .replace(/\b(trip|adventure|vacation|holiday|weekend|getaway|tour|visit)\b/gi, '')
      .trim();
  }

  // Build prompts
  const sysPrompt  = buildRecsSystemPrompt_();
  const userMsg    = buildRecsUserPrompt_(tripLabel, startDate, endDate, durationNights, context, destination, itinerarySummary, gapSummary);
  const apiKey     = getApiKey();
  const tools      = getSearchTools_(); // from Chat.js — empty if no VERA_SEARCH_API_KEY

  // Claude call with optional tool-use loop (mirrors callClaudeChat_ pattern)
  let messages = [{ role: 'user', content: userMsg }];
  let rawText  = '';
  for (let iter = 0; iter < 4; iter++) {
    const requestBody = {
      model:      CLAUDE_MODEL,
      max_tokens: 4096,
      system:     sysPrompt,
      messages:   messages,
    };
    if (tools.length) requestBody.tools = tools;

    const response     = UrlFetchApp.fetch(CLAUDE_API_URL, {
      method:  'post',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      payload:            JSON.stringify(requestBody),
      muteHttpExceptions: true,
    });
    const json = JSON.parse(response.getContentText());
    if (response.getResponseCode() !== 200) {
      throw new Error('Claude API error ' + response.getResponseCode() + ': ' + response.getContentText().substring(0, 200));
    }

    if (json.stop_reason === 'tool_use') {
      // Execute any web_search tool calls
      const assistantMsg  = { role: 'assistant', content: json.content };
      const toolResults   = [];
      (json.content || []).forEach(function(block) {
        if (block.type !== 'tool_use') return;
        const results = doWebSearch_((block.input || {}).query || '');
        const text    = results.map(function(r) { return r.title + ': ' + r.snippet; }).join('\n\n') || 'No results found.';
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: text });
      });
      messages = messages.concat([assistantMsg, { role: 'user', content: toolResults }]);
      continue; // next iteration
    }

    // end_turn — extract text
    rawText = (json.content || [])
      .filter(function(b) { return b.type === 'text'; })
      .map(function(b) { return b.text; })
      .join('');
    break;
  }

  // Parse JSON array from response
  const recsData = parseRecsResponse_(rawText);

  // Clear existing AI recs for this trip
  ensureSheet(ss, TABS.TRIP_RECOMMENDATIONS, TRIP_RECS_HEADERS);
  const recSheet = ss.getSheetByName(TABS.TRIP_RECOMMENDATIONS);
  if (recSheet.getLastRow() >= 2) {
    const allRows = recSheet.getRange(2, 1, recSheet.getLastRow() - 1, TRIP_RECS_HEADERS.length).getValues();
    const toDelete = [];
    for (let i = 0; i < allRows.length; i++) {
      if (String(allRows[i][1]).trim() === tripKey && String(allRows[i][10]).trim() === 'ai') {
        toDelete.push(i + 2);
      }
    }
    toDelete.sort(function(a, b) { return b - a; });
    toDelete.forEach(function(rowNum) { recSheet.deleteRow(rowNum); });
  }

  // Write new recs
  const tz          = Session.getScriptTimeZone();
  const dateKey     = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  const generatedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  let seq = 1;
  if (recSheet.getLastRow() >= 2) {
    recSheet.getRange(2, 1, recSheet.getLastRow() - 1, 1).getValues().forEach(function(r) {
      if (String(r[0]).indexOf('REC-' + dateKey) === 0) seq++;
    });
  }

  const newRows = [];
  recsData.forEach(function(rec) {
    if (!rec.title) return;
    newRows.push([
      'REC-' + dateKey + '-' + String(seq++).padStart(3, '0'),
      tripKey,
      rec.date        || '',
      rec.type        || 'manual',
      rec.title       || '',
      rec.description || '',
      rec.rationale   || '',
      rec.priceRange  || '',
      rec.link        || '',
      'pending',
      'ai',
      generatedAt,
    ]);
  });

  if (newRows.length > 0) {
    const startRow = recSheet.getLastRow() + 1;
    recSheet.getRange(startRow, 1, newRows.length, TRIP_RECS_HEADERS.length).setValues(newRows);
  }

  return webGetRecommendations_({ parameter: { tripKey: tripKey } });
}

// ---- Ideas / Braindump (Issue #18) -----------------------------------------

function findIdeaRow_(id) {
  if (!id) throw new Error('Missing idea ID');
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.IDEAS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Ideas sheet is empty');
  const numRows = sheet.getLastRow() - 1;
  const ids     = sheet.getRange(2, 1, numRows, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) {
      return { sheet: sheet, rowNum: i + 2 };
    }
  }
  throw new Error('Idea not found: ' + id);
}

function webGetIdeas_() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.IDEAS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, ideas: [] };

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, IDEA_HEADERS.length).getValues();
  const ideas   = [];

  data.forEach(function(row, idx) {
    const id = String(row[0] || '').trim();
    if (!id) return;
    ideas.push({
      row:       idx + 2,
      id:        id,
      dateAdded: formatDateVal_(row[1]),
      idea:      String(row[2] || '').trim(),
      category:  String(row[3] || '').trim(),
      tags:      String(row[4] || '').trim(),
      notes:     String(row[5] || '').trim(),
      status:    String(row[6] || 'New').trim(),
    });
  });

  return { ok: true, ideas: ideas };
}

function webAddIdea_(e) {
  const p        = e.parameter || {};
  const ideaText = (p.idea || '').trim();
  if (!ideaText) throw new Error('Idea text is required');

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.IDEAS);
  if (!sheet) throw new Error('Ideas tab not found');

  // Generate ID: IDEA-YYYYMMDD-NN
  const tz       = Session.getScriptTimeZone();
  const today    = new Date();
  const dateStr  = Utilities.formatDate(today, tz, 'yyyyMMdd');
  const addedStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  let seq = 1;
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
      .forEach(function(r) { if (String(r[0] || '').indexOf('IDEA-' + dateStr) === 0) seq++; });
  }
  const ideaId = 'IDEA-' + dateStr + '-' + String(seq).padStart(2, '0');

  // IDEA_HEADERS: ID | Date Added | Idea | Category | Tags | Notes | Status
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, IDEA_HEADERS.length).setValues([[
    ideaId, addedStr, ideaText,
    (p.category || 'General').trim(),
    (p.tags  || '').trim(),
    (p.notes || '').trim(),
    'New',
  ]]);

  return { ok: true, id: ideaId, action: 'created' };
}

function webUpdateIdea_(e) {
  const p     = e.parameter || {};
  const id    = (p.id || '').trim();
  const found = findIdeaRow_(id);

  // IDEA_HEADERS: ID(1) | Date Added(2) | Idea(3) | Category(4) | Tags(5) | Notes(6) | Status(7)
  if (p.idea     != null) found.sheet.getRange(found.rowNum, 3).setValue(p.idea.trim());
  if (p.category != null) found.sheet.getRange(found.rowNum, 4).setValue(p.category.trim());
  if (p.tags     != null) found.sheet.getRange(found.rowNum, 5).setValue(p.tags.trim());
  if (p.notes    != null) found.sheet.getRange(found.rowNum, 6).setValue(p.notes.trim());
  if (p.status   != null) found.sheet.getRange(found.rowNum, 7).setValue(p.status.trim());

  return { ok: true, id: id, action: 'updated' };
}

function webDeleteIdea_(e) {
  const id    = ((e.parameter && e.parameter.id) || '').trim();
  const found = findIdeaRow_(id);
  found.sheet.deleteRow(found.rowNum);
  return { ok: true, id: id, action: 'deleted' };
}

/**
 * Promotes an idea to a new open task in the Tasks tab.
 * Marks the idea Status = "Promoted".
 */
function webPromoteIdea_(e) {
  const p  = e.parameter || {};
  const id = (p.id || p.ideaId || '').trim();
  if (!id) throw new Error('Idea ID is required');

  // 1. Find the idea row
  const found    = findIdeaRow_(id);
  const ideaData = found.sheet.getRange(found.rowNum, 1, 1, IDEA_HEADERS.length).getValues()[0];
  // IDEA_HEADERS: ID(0) | Date Added(1) | Idea(2) | Category(3) | Tags(4) | Notes(5) | Status(6)
  const ideaText  = String(ideaData[2] || '').trim();
  const ideaNotes = String(ideaData[5] || '').trim();
  if (!ideaText) throw new Error('Idea text is empty for: ' + id);

  // 2. Create a task — pattern mirrors webAddTask_
  const taskSheet = getSpreadsheet().getSheetByName(TABS.TASKS);
  if (!taskSheet) throw new Error('Tasks tab not found');

  const tz       = Session.getScriptTimeZone();
  const today    = new Date();
  const dateStr  = Utilities.formatDate(today, tz, 'yyyyMMdd');
  const addedStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  let seq = 1;
  if (taskSheet.getLastRow() >= 2) {
    taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, 1).getValues()
      .forEach(function(r) { if (String(r[0] || '').indexOf('TASK-' + dateStr) === 0) seq++; });
  }
  const taskId = 'TASK-' + dateStr + '-' + String(seq).padStart(2, '0');

  // TASK_HEADERS: ID | Task | Added Date | Due Date | Status | Recurring | Notes | Flagged
  taskSheet.getRange(taskSheet.getLastRow() + 1, 1, 1, TASK_HEADERS.length)
    .setValues([[taskId, ideaText, addedStr, '', 'Open', '', ideaNotes, '']]);

  // 3. Mark idea as Promoted
  found.sheet.getRange(found.rowNum, 7).setValue('Promoted'); // Col G = Status

  return { ok: true, ideaId: id, taskId: taskId, action: 'promoted' };
}

// ---- Chat ------------------------------------------------------------------

/**
 * Chat handler — accepts both GET (text-only, existing path) and POST (with optional image).
 * @param {Object} source - Either the Apps Script event `e` (GET) or a parsed POST body object
 */
function webProcessChat_(source) {
  // GET: params are in source.parameter; POST: params are top-level on the body object
  const message       = source.message       || (source.parameter && source.parameter.message)  || '';
  const sessionId     = source.session       || (source.parameter && source.parameter.session)  || 'dashboard';
  const imageBase64   = source.imageBase64   || null;
  const imageMimeType = source.imageMimeType || null;
  return processChat_(message, sessionId, imageBase64, imageMimeType);
}

// ============================================================
// UTILITIES
// ============================================================

// ---- Goals (Yearly Goals Kanban) -------------------------------------------

function webGetGoals_() {
  const goals = getGoals_();
  return { ok: true, count: goals.length, goals: goals };
}

function webAddGoal_(e) {
  const p = e.parameter || {};
  const goal = createGoal_(
    p.title || '',
    p.description || '',
    p.status || 'To Do',
    p.category || '',
    p.year || '',
    p.notes || ''
  );
  return { ok: true, goal: goal };
}

function webUpdateGoal_(e) {
  const p  = e.parameter || {};
  const id = (p.id || '').trim();
  if (!id) throw new Error('Goal ID is required');

  const fields = {};
  ['title', 'description', 'status', 'category', 'year', 'progress', 'notes'].forEach(function(k) {
    if (p[k] != null) fields[k] = p[k];
  });

  const updated = updateGoal_(id, fields);
  if (!updated) return { ok: false, error: 'Goal not found: ' + id };
  return { ok: true, goal: updated };
}

function webDeleteGoal_(e) {
  const id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) throw new Error('Goal ID is required');
  const deleted = deleteGoal_(id);
  return { ok: deleted, id: id, action: 'deleted' };
}

// ---- Countries Visited (Issue #74) -----------------------------------------

function webGetCountries_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.COUNTRIES);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, entries: [] };
  var rows    = sheet.getDataRange().getValues();
  var headers = rows[0];
  var entries = rows.slice(1)
    .filter(function(r) { return r[0] !== ''; })
    .map(function(r) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = r[i]; });
      return obj;
    });
  return { ok: true, entries: entries };
}

function webAddCountry_(e) {
  var p         = e.parameter || {};
  var country   = (p.country   || '').trim();
  var city      = (p.city      || '').trim();
  var year      = parseInt(p.year,  10) || new Date().getFullYear();
  var traveller = (p.traveller || 'Both').trim();
  var tripKey   = (p.tripKey   || '').trim();
  var notes     = (p.notes     || '').trim();
  if (!country) throw new Error('Country is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.COUNTRIES);
  if (!sheet) throw new Error('Countries tab not found. Run setupVERA() first.');
  var id = 'c_' + Date.now();
  sheet.appendRow([id, country, city, year, traveller, tripKey, notes]);
  return { ok: true, entry: { ID: id, Country: country, City: city, Year: year,
                               Traveller: traveller, 'Trip Key': tripKey, Notes: notes } };
}

function webDeleteCountry_(e) {
  var id    = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) throw new Error('Country entry ID is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.COUNTRIES);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'Entry not found.' };
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      sheet.deleteRow(i + 1);
      return { ok: true, id: id, action: 'deleted' };
    }
  }
  return { ok: false, error: 'Entry not found: ' + id };
}

// ---- Bucket List (Travel wishlist) -----------------------------------------

function webGetBucketList_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BUCKET_LIST);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, entries: [] };

  var rows    = sheet.getDataRange().getValues();
  var headers = rows[0];
  var entries = rows.slice(1)
    .filter(function(r) { return r[0] !== ''; })
    .map(function(r) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = r[i]; });
      obj.activities = []; // will be populated below
      return obj;
    });

  // Join BucketActivities — embed each activity into its parent entry
  var actSheet = ss.getSheetByName(TABS.BUCKET_ACTIVITIES);
  if (actSheet && actSheet.getLastRow() >= 2) {
    var actRows    = actSheet.getDataRange().getValues();
    var actHeaders = actRows[0];
    var entryMap   = {};
    entries.forEach(function(e) { entryMap[String(e.ID)] = e; });
    actRows.slice(1).forEach(function(r) {
      if (!r[0]) return;
      var act = {};
      actHeaders.forEach(function(h, i) { act[h] = r[i]; });
      var bid = String(act['Bucket ID'] || '').trim();
      if (entryMap[bid]) entryMap[bid].activities.push(act);
    });
  }

  return { ok: true, entries: entries };
}

function webAddBucketItem_(e) {
  var p          = e.parameter || {};
  var country    = (p.country    || '').trim();
  var city       = (p.city       || '').trim();
  var targetYear = parseInt(p.targetYear, 10) || '';
  var traveller  = (p.traveller  || 'Both').trim();
  var stars      = parseInt(p.stars, 10) || '';
  var dreamTrip  = (p.dreamTrip  || '').trim();
  var notes      = (p.notes      || '').trim();
  if (!country) throw new Error('Country is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BUCKET_LIST);
  if (!sheet) throw new Error('Bucket List tab not found. Run setupVERA() first.');
  var id = 'b_' + Date.now();
  sheet.appendRow([id, country, city, targetYear, traveller, stars, dreamTrip, notes, '']);
  return { ok: true, entry: { ID: id, Country: country, City: city,
    'Target Year': targetYear, Traveller: traveller, Stars: stars,
    'Dream Trip': dreamTrip, Notes: notes, Visited: '' } };
}

function webUpdateBucketItem_(e) {
  var p  = e.parameter || {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('Bucket item ID is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BUCKET_LIST);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'Entry not found.' };
  var rows    = sheet.getDataRange().getValues();
  var headers = rows[0];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      // Update only the fields present in params
      if (p.visited !== undefined) {
        var visitedCol = headers.indexOf('Visited');
        if (visitedCol >= 0) sheet.getRange(i + 1, visitedCol + 1).setValue(p.visited);
      }
      if (p.stars !== undefined) {
        var starsCol = headers.indexOf('Stars');
        if (starsCol >= 0) sheet.getRange(i + 1, starsCol + 1).setValue(parseInt(p.stars, 10) || '');
      }
      return { ok: true, id: id };
    }
  }
  return { ok: false, error: 'Entry not found: ' + id };
}

function webDeleteBucketItem_(e) {
  var id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) throw new Error('Bucket item ID is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BUCKET_LIST);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'Entry not found.' };
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      sheet.deleteRow(i + 1);
      return { ok: true, id: id, action: 'deleted' };
    }
  }
  return { ok: false, error: 'Entry not found: ' + id };
}

// ---- Bucket Activities (Issue #113) ----------------------------------------

/**
 * Adds an activity to a Bucket List entry.
 * GET ?action=add_bucket_activity&bucketId=b_xxx&activity=text
 */
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

/**
 * Toggles the Done field of a Bucket Activity.
 * GET ?action=toggle_bucket_activity&id=ba_xxx&done=yes  (or done='' to uncheck)
 */
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

/**
 * Deletes a Bucket Activity row.
 * GET ?action=delete_bucket_activity&id=ba_xxx
 */
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

// ---- Flight Status (Issue #66) ---------------------------------------------

/**
 * Returns the flight_status object from metadata for every flight item in a trip.
 * GET ?action=flight_statuses&tripKey=ENCODED_TRIP_KEY
 * Response: { ok: true, statuses: { itemId: { status, dep_scheduled, ... }, ... } }
 */
function webGetFlightStatuses_(e) {
  var tripKey = (e.parameter && e.parameter.tripKey) || '';
  if (!tripKey) return { ok: false, error: 'Missing tripKey' };
  var sheet    = getSpreadsheet().getSheetByName(TABS.ITINERARY);
  var statuses = {};

  // Phase 1: Itinerary sheet rows (manually added or CSV-imported flights)
  if (sheet) {
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][1] || '').trim() !== tripKey) continue;   // col B = Trip Key
      if (String(rows[i][2] || '').trim() !== 'flight') continue;  // col C = Type
      var id   = String(rows[i][0] || '');                         // col A = ID
      var meta = {};
      try { meta = JSON.parse(String(rows[i][9] || '{}') || '{}'); } catch(e_) {}
      if (meta.flight_status) statuses[id] = meta.flight_status;
    }
  }

  // Phase 2: Calendar-sourced flight statuses stored in Script Properties cache.
  // These are flights that came from Google Calendar (not the Itinerary sheet),
  // keyed by the same CAL-xxx IDs assigned in webGetItinerary_().
  var calCache = getCalFlightStatusCache_();
  for (var calId in calCache) {
    var entry = calCache[calId];
    if (entry && entry.tripKey === tripKey && entry.status) {
      statuses[calId] = entry.status;
    }
  }

  return { ok: true, statuses: statuses };
}

/**
 * Force-polls AviationStack for all flights in the given trip, bypassing
 * rate limiting and window guards. Writes fresh status to the sheet, then
 * returns the updated statuses immediately.
 * GET ?action=force_flight_statuses&tripKey=ENCODED_TRIP_KEY
 */
function webForceFlightStatuses_(e) {
  var tripKey = (e.parameter && e.parameter.tripKey) || '';
  if (!tripKey) return { ok: false, error: 'Missing tripKey' };
  try {
    checkFlightStatuses_(true, tripKey);
    var result = webGetFlightStatuses_(e);
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---- Shared Interest Ledger (Issue #28) ------------------------------------

function webGetInterests_() {
  const interests = getSharedInterestLedger_();
  return { ok: true, count: interests.length, interests: interests };
}

function webAddInterest_(e) {
  const p        = e.parameter || {};
  const person   = (p.person   || 'Ahmed').trim();
  const interest = (p.interest || '').trim();
  const category = (p.category || 'Other').trim();
  const notes    = (p.notes    || '').trim();
  if (!interest) throw new Error('Interest text is required.');
  const created = createInterest_(person, interest, category, 'Manual', notes);
  return { ok: true, interest: created };
}

function webDeleteInterest_(e) {
  const id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) throw new Error('Interest ID is required.');
  const archived = deleteInterest_(id);
  return { ok: archived, id: id, action: 'archived' };
}

function formatDateVal_(val) {
  if (!val || val === '') return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val);
}

// ---- Email Parser — Confirm Pending Enrichment (Issue #98) ------------------

/**
 * Confirms a held email enrichment match and writes it to the Itinerary row.
 * GET ?action=confirm_enrich&messageId=<gmail_message_id>&token=<VERA_WEB_TOKEN>
 * Called from the dashboard when the user approves a "confirm match" flag.
 */
function webConfirmEnrich_(e) {
  var messageId = (e.parameter && e.parameter.messageId) || '';
  if (!messageId) return { ok: false, error: 'messageId required' };
  return confirmPendingEnrichment_(messageId);
}

// ---- Morning Routine AI Generation (Issue #101) ----------------------------

/**
 * Calls Claude to generate a personalized morning routine checklist.
 * Writes VERA-sourced items to the Morning Routine sheet tab (replacing
 * any previous VERA items), preserving manually-added items.
 * GET ?action=generate_morning_routine&token=<VERA_WEB_TOKEN>
 * Returns: { ok: true, items: [...] } — full updated list from sheet
 */
function webGenerateMorningRoutine_() {
  var prompt =
    'You are VERA, a personal chief of staff AI. Generate a personalized morning routine checklist.\n' +
    'Follow these frameworks:\n' +
    '1. The 10-10-10 Framework: Three 10-min blocks — Input (read a book or saved article, no news/social media), ' +
    'Movement (10-min walk outside for morning sunlight), Stillness (5-10 min breath meditation).\n' +
    '2. Administrative Sweep: Check VERA FLAGS for high-priority alerts; scan today\'s calendar for surprises.\n' +
    '3. Physical anchors: hydrate (full glass of water), light/air exposure.\n\n' +
    'Return a JSON array of 7-10 concise checklist item strings (under 60 chars each, no markdown, no numbers).\n' +
    'Example: ["Drink a full glass of water", "Step outside for 10 minutes", "Read for 10 minutes"]\n' +
    'Return ONLY the JSON array, nothing else.';
  var generatedTexts = callClaudeJson_(prompt, []);
  if (!Array.isArray(generatedTexts)) generatedTexts = [];
  if (generatedTexts.length === 0) return { ok: false, error: 'Claude returned no items' };

  var sheet = getSpreadsheet().getSheetByName(TABS.MORNING_ROUTINE);
  if (!sheet) throw new Error('Morning Routine tab not found — run createSheetTabs() first');

  // Delete all existing vera-sourced rows (bottom-to-top to keep row indices valid)
  if (sheet.getLastRow() > 1) {
    var allRows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    for (var i = allRows.length - 1; i >= 0; i--) {
      if (String(allRows[i][2] || '') === 'vera') sheet.deleteRow(i + 2);
    }
  }

  // Shift sort orders of remaining manual items to make room at top for vera items
  var veraCount = generatedTexts.length;
  if (sheet.getLastRow() > 1) {
    var manualCount = sheet.getLastRow() - 1;
    var sorts = sheet.getRange(2, 4, manualCount, 1).getValues();
    for (var j = 0; j < sorts.length; j++) {
      sheet.getRange(j + 2, 4).setValue((parseInt(sorts[j][0], 10) || 0) + veraCount);
    }
  }

  // Append new vera items with sort orders 1..veraCount (displayed before manual items)
  var tz        = Session.getScriptTimeZone();
  var dateStr   = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  var addedDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  generatedTexts.forEach(function(text, idx) {
    var itemId = 'ROUTINE-' + dateStr + 'V-' + String(idx).padStart(2, '0');
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, MORNING_ROUTINE_HEADERS.length)
         .setValues([[itemId, text, 'vera', idx + 1, false, '', addedDate]]);
  });

  return webGetMorningRoutine_(); // Return full updated list sorted by Sort
}

// ============================================================
// MORNING ROUTINE — Sheet-backed checklist (cross-device)
// ============================================================

/**
 * Returns all morning routine items sorted by Sort order.
 * GET ?action=morning_routine
 */
function webGetMorningRoutine_() {
  var sheet = getSpreadsheet().getSheetByName(TABS.MORNING_ROUTINE);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, items: [] };
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, MORNING_ROUTINE_HEADERS.length).getValues();
  var items = rows
    .filter(function(r) { return String(r[0] || '').trim() !== ''; })
    .map(function(r) {
      return {
        id:        String(r[0]),
        text:      String(r[1]),
        source:    String(r[2] || 'manual'),
        sort:      parseInt(r[3], 10) || 0,
        checked:   r[4] === true || String(r[4]).toLowerCase() === 'true',
        checkedAt: String(r[5] || ''),
        addedDate: String(r[6] || ''),
      };
    })
    .sort(function(a, b) { return a.sort - b.sort; });
  return { ok: true, items: items };
}

/**
 * Toggles the checked state of a single morning routine item.
 * GET ?action=morning_routine_toggle&id=ROUTINE-...
 */
function webToggleMorningRoutineItem_(e) {
  var id    = (e.parameter && e.parameter.id) || '';
  var found = findMorningRoutineRow_(id);
  var curr  = found.sheet.getRange(found.rowNum, 5).getValue();
  var nowOn = !(curr === true || String(curr).toLowerCase() === 'true');
  var ts    = nowOn
    ? Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss")
    : '';
  found.sheet.getRange(found.rowNum, 5).setValue(nowOn);
  found.sheet.getRange(found.rowNum, 6).setValue(ts);
  return { ok: true, id: id, checked: nowOn };
}

/**
 * Adds a new manual item to the morning routine.
 * GET ?action=morning_routine_add&text=...&source=manual
 */
function webAddMorningRoutineItem_(e) {
  var text   = ((e.parameter && e.parameter.text)   || '').trim();
  var source =  (e.parameter && e.parameter.source) || 'manual';
  if (!text) throw new Error('Item text is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.MORNING_ROUTINE);
  if (!sheet) throw new Error('Morning Routine tab not found');
  var tz      = Session.getScriptTimeZone();
  var dateStr = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  // Generate unique ID
  var seq = 0;
  if (sheet.getLastRow() > 1) {
    var existingIds = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    existingIds.forEach(function(r) { if (String(r[0]).indexOf('ROUTINE-' + dateStr) === 0) seq++; });
  }
  var itemId = 'ROUTINE-' + dateStr + '-' + String(seq).padStart(2, '0');
  // Sort order: append at end (higher number = shown later)
  var maxSort = 0;
  if (sheet.getLastRow() > 1) {
    var sorts = sheet.getRange(2, 4, sheet.getLastRow() - 1, 1).getValues();
    sorts.forEach(function(r) { var n = parseInt(r[0], 10) || 0; if (n > maxSort) maxSort = n; });
  }
  var addedDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, MORNING_ROUTINE_HEADERS.length)
       .setValues([[itemId, text, source, maxSort + 1, false, '', addedDate]]);
  return { ok: true, id: itemId, action: 'added' };
}

/**
 * Deletes a morning routine item by ID.
 * GET ?action=morning_routine_delete&id=ROUTINE-...
 */
function webDeleteMorningRoutineItem_(e) {
  var found = findMorningRoutineRow_((e.parameter && e.parameter.id) || '');
  found.sheet.deleteRow(found.rowNum);
  return { ok: true, action: 'deleted' };
}

/**
 * Moves a morning routine item up (dir=-1) or down (dir=1) by swapping Sort values.
 * GET ?action=morning_routine_move&id=ROUTINE-...&dir=-1
 */
function webMoveMorningRoutineItem_(e) {
  var id  = (e.parameter && e.parameter.id)  || '';
  var dir = parseInt((e.parameter && e.parameter.dir) || '0', 10);
  if (!id || dir === 0) throw new Error('Missing id or dir');
  var sheet = getSpreadsheet().getSheetByName(TABS.MORNING_ROUTINE);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, action: 'no_change' };
  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, 4).getValues(); // [ID, Item, Source, Sort]
  data.sort(function(a, b) { return (parseInt(a[3], 10) || 0) - (parseInt(b[3], 10) || 0); });
  var idx = -1;
  for (var i = 0; i < data.length; i++) { if (String(data[i][0]) === id) { idx = i; break; } }
  if (idx === -1) throw new Error('Item not found: ' + id);
  var swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= data.length) return { ok: true, action: 'no_change' };
  // Swap Sort values between the two items
  var thisFound = findMorningRoutineRow_(String(data[idx][0]));
  var swapFound = findMorningRoutineRow_(String(data[swapIdx][0]));
  var thisSort  = parseInt(data[idx][3],    10) || 0;
  var swapSort  = parseInt(data[swapIdx][3],10) || 0;
  thisFound.sheet.getRange(thisFound.rowNum, 4).setValue(swapSort);
  swapFound.sheet.getRange(swapFound.rowNum, 4).setValue(thisSort);
  return { ok: true, action: 'moved' };
}

/**
 * Finds the sheet row number for a morning routine item by ID.
 * @returns {{ sheet: Sheet, rowNum: number }}
 */
function findMorningRoutineRow_(id) {
  if (!id) throw new Error('Missing routine item ID');
  var sheet = getSpreadsheet().getSheetByName(TABS.MORNING_ROUTINE);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Morning Routine tab is empty');
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) return { sheet: sheet, rowNum: i + 2 };
  }
  throw new Error('Routine item not found: ' + id);
}

// ---- Gym Log (Issue #97) ---------------------------------------------------

function webGetGymLog_() {
  return { ok: true, sessions: getGymLog_() };
}

function webLogGymAttend_(e, attended) {
  var id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) throw new Error('id is required');
  return logGymAttendance_(id, attended);
}

function webGymBackfill_(e) {
  var days   = parseInt((e.parameter && e.parameter.days) || '30', 10) || 30;
  var result = backfillGymSessions_(days);
  return { ok: true, added: result.added, skipped: result.skipped };
}

// ── Purchase History (Issue #111) ─────────────────────────────

function webGetPurchaseHistory_() {
  return { ok: true, items: getPurchaseStats_() };
}

function webLogPurchaseRun_(e) {
  var storeId  = (e.storeId  || (e.parameter && e.parameter.storeId)  || '').toString().trim();
  var rawItems = (e.items     || (e.parameter && e.parameter.items)    || '[]').toString().trim();
  if (!storeId) throw new Error('storeId is required');
  var itemTexts = JSON.parse(rawItems);
  if (!Array.isArray(itemTexts) || !itemTexts.length) throw new Error('items must be a non-empty JSON array');
  return logPurchaseRun_(storeId, itemTexts);
}

function webGetPurchaseSuggestions_() {
  var cfg  = getConfigValues();
  var days = parseInt(cfg['pantry_restock_days_ahead'] || '7', 10) || 7;
  return { ok: true, suggestions: getItemsDue_(days) };
}

// ============================================================
// PRESCRIPTIONS (Issue #116)
// ============================================================

function webGetPrescriptions_() {
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.PRESCRIPTIONS);
  if (!sheet) return { ok: true, prescriptions: [] };
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { ok: true, prescriptions: [] };

  var prescriptions = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue; // skip empty rows
    prescriptions.push({
      row:        i + 1,
      id:         r[0]  || '',
      person:     r[1]  || '',
      medication: r[2]  || '',
      dosage:     r[3]  || '',
      frequency:  r[4]  || '',
      doctor:     r[5]  || '',
      pharmacy:   r[6]  || '',
      rxNumber:   r[7]  || '',
      lastFilled: r[8]  || '',
      refillDate: r[9]  || '',
      daysSupply: r[10] || '',
      active:     r[11] || 'Yes',
      notes:      r[12] || '',
    });
  }

  // Sort: active first, then by refill date ascending (no refill date last)
  prescriptions.sort(function(a, b) {
    var aActive = (a.active === 'Yes') ? 0 : 1;
    var bActive = (b.active === 'Yes') ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    if (!a.refillDate && !b.refillDate) return 0;
    if (!a.refillDate) return 1;
    if (!b.refillDate) return -1;
    return new Date(a.refillDate) - new Date(b.refillDate);
  });

  return { ok: true, prescriptions: prescriptions };
}

function webAddPrescription_(e) {
  var p          = (e && e.parameter) ? e.parameter : {};
  var medication = (p.medication || '').trim();
  if (!medication) throw new Error('medication is required');

  var id = 'RX-' + Date.now();
  var row = [
    id,
    (p.person     || 'Ahmed').trim(),
    medication,
    (p.dosage     || '').trim(),
    (p.frequency  || '').trim(),
    (p.doctor     || '').trim(),
    (p.pharmacy   || '').trim(),
    (p.rxNumber   || '').trim(),
    (p.lastFilled || '').trim(),
    (p.refillDate || '').trim(),
    (p.daysSupply || '').trim(),
    (p.active     || 'Yes').trim(),
    (p.notes      || '').trim(),
  ];

  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.PRESCRIPTIONS);
  sheet.appendRow(row);
  return { ok: true, id: id };
}

function webUpdatePrescription_(e) {
  var p  = (e && e.parameter) ? e.parameter : {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');

  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.PRESCRIPTIONS);
  var rows  = sheet.getDataRange().getValues();

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      var rowNum = i + 1;
      // Only overwrite columns that were explicitly provided
      var fieldMap = {
        person:     2,  // col B → index 1 → column 2
        medication: 3,
        dosage:     4,
        frequency:  5,
        doctor:     6,
        pharmacy:   7,
        rxNumber:   8,
        lastFilled: 9,
        refillDate: 10,
        daysSupply: 11,
        active:     12,
        notes:      13,
      };
      for (var key in fieldMap) {
        if (p[key] != null) {
          sheet.getRange(rowNum, fieldMap[key]).setValue(p[key].toString().trim());
        }
      }
      return { ok: true };
    }
  }
  throw new Error('Prescription not found: ' + id);
}

function webDeletePrescription_(e) {
  var p  = (e && e.parameter) ? e.parameter : {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');

  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.PRESCRIPTIONS);
  var rows  = sheet.getDataRange().getValues();

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { ok: true, action: 'deleted' };
    }
  }
  throw new Error('Prescription not found: ' + id);
}

// ============================================================
// CREDIT CARD HUB (Issues #115 + #117)
// ============================================================

function webGetCards_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  function readSheet(tabKey) {
    var s = ss.getSheetByName(TABS[tabKey]);
    if (!s || s.getLastRow() < 2) return [];
    return s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).getValues();
  }

  // --- Credit Cards ---
  var cardRows = readSheet('CREDIT_CARDS');
  var cards = cardRows.filter(function(r) { return r[0]; }).map(function(r) {
    return {
      id:              String(r[0]  || ''),
      cardName:        String(r[1]  || ''),
      issuer:          String(r[2]  || ''),
      last4:           String(r[3]  || ''),
      annualFee:       r[4]  !== '' ? Number(r[4])  : null,
      dueDay:          r[5]  !== '' ? Number(r[5])  : null,
      lastUsed:        String(r[6]  || ''),
      owner:           String(r[7]  || 'Ahmed'),
      authUser:        String(r[8]  || ''),
      active:          String(r[9]  || 'Yes'),
      statementCredit: String(r[10] || ''),
      notes:           String(r[11] || ''),
    };
  });
  // Sort: active first → owner order → name alpha
  var ownerOrder = { 'Ahmed': 0, 'Victoria': 1 };
  cards.sort(function(a, b) {
    var aA = a.active === 'Yes' ? 0 : 1, bA = b.active === 'Yes' ? 0 : 1;
    if (aA !== bA) return aA - bA;
    var ao = ownerOrder[a.owner] != null ? ownerOrder[a.owner] : 3;
    var bo = ownerOrder[b.owner] != null ? ownerOrder[b.owner] : 3;
    if (ao !== bo) return ao - bo;
    return a.cardName.localeCompare(b.cardName);
  });

  // --- Card Rewards ---
  var rewardRows = readSheet('CARD_REWARDS');
  var rewards = rewardRows.filter(function(r) { return r[0]; }).map(function(r) {
    return {
      id:         String(r[0] || ''),
      cardName:   String(r[1] || ''),
      category:   String(r[2] || ''),
      rate:       String(r[3] || ''),
      rateType:   String(r[4] || ''),
      conditions: String(r[5] || ''),
    };
  });

  // --- Card Perks ---
  var perkRows = readSheet('CARD_PERKS');
  var perks = perkRows.filter(function(r) { return r[0]; }).map(function(r) {
    return {
      id:        String(r[0] || ''),
      cardName:  String(r[1] || ''),
      perk:      String(r[2] || ''),
      amount:    r[3] !== '' ? Number(r[3]) : null,
      frequency: String(r[4] || 'Monthly'),
      category:  String(r[5] || ''),
      lastUsed:  String(r[6] || ''),
    };
  });

  // --- Loyalty Programs ---
  var progRows = readSheet('LOYALTY_PROGRAMS');
  var programs = progRows.filter(function(r) { return r[0]; }).map(function(r) {
    return {
      id:            String(r[0] || ''),
      program:       String(r[1] || ''),
      linkedCard:    String(r[2] || ''),
      totalPoints:   r[3] !== '' ? Number(r[3]) : 0,
      centsPerPoint: r[4] !== '' ? Number(r[4]) : 1.0,
      bestUse:       String(r[5] || ''),
      expiry:        String(r[6] || ''),
      notes:         String(r[7] || ''),
    };
  });

  // --- Rewards Goals ---
  var goalRows = readSheet('REWARDS_GOALS');
  var goals = goalRows.filter(function(r) { return r[0]; }).map(function(r) {
    return {
      id:            String(r[0] || ''),
      goal:          String(r[1] || ''),
      targetProgram: String(r[2] || ''),
      targetPoints:  r[3] !== '' ? Number(r[3]) : 0,
      currentPoints: r[4] !== '' ? Number(r[4]) : 0,
      notes:         String(r[5] || ''),
    };
  });

  return { ok: true, cards: cards, rewards: rewards, perks: perks, programs: programs, goals: goals };
}

// ---- Credit Card CRUD ----

function webAddCard_(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  var cardName = (p.cardName || p.card_name || '').trim();
  if (!cardName) throw new Error('cardName is required');
  var id = 'CC-' + Date.now();
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CREDIT_CARDS);
  sheet.appendRow([
    id,
    cardName,
    (p.issuer          || '').trim(),
    (p.last4           || '').trim(),
    (p.annualFee       || '').toString().trim(),
    (p.dueDay          || '').toString().trim(),
    (p.lastUsed        || '').trim(),
    (p.owner           || 'Ahmed').trim(),
    (p.authUser        || '').trim(),
    (p.active          || 'Yes').trim(),
    (p.statementCredit || '').trim(),
    (p.notes           || '').trim(),
  ]);
  return { ok: true, id: id };
}

function webUpdateCard_(e) {
  var p  = (e && e.parameter) ? e.parameter : {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CREDIT_CARDS);
  var rows  = sheet.getDataRange().getValues();
  var colMap = { cardName:2, issuer:3, last4:4, annualFee:5, dueDay:6, lastUsed:7, owner:8, authUser:9, active:10, statementCredit:11, notes:12 };
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      for (var key in colMap) {
        if (p[key] != null) sheet.getRange(i + 1, colMap[key]).setValue(p[key].toString().trim());
      }
      return { ok: true };
    }
  }
  throw new Error('Card not found: ' + id);
}

function webDeleteCard_(e) {
  var p  = (e && e.parameter) ? e.parameter : {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  // Find card name first (for cascade delete)
  var cardSheet = ss.getSheetByName(TABS.CREDIT_CARDS);
  var cardRows  = cardSheet.getDataRange().getValues();
  var cardName  = null;
  for (var i = 1; i < cardRows.length; i++) {
    if (cardRows[i][0] === id) { cardName = String(cardRows[i][1]); cardSheet.deleteRow(i + 1); break; }
  }
  if (!cardName) throw new Error('Card not found: ' + id);

  // Cascade: delete matching rows in Card Rewards + Card Perks (iterate in reverse to avoid row shift)
  function cascadeDelete(tabName) {
    var s = ss.getSheetByName(tabName);
    if (!s || s.getLastRow() < 2) return;
    var r = s.getDataRange().getValues();
    for (var j = r.length - 1; j >= 1; j--) {
      if (String(r[j][1]) === cardName) s.deleteRow(j + 1);
    }
  }
  cascadeDelete(TABS.CARD_REWARDS);
  cascadeDelete(TABS.CARD_PERKS);

  return { ok: true, action: 'deleted' };
}

// ---- Card Rewards CRUD ----

function webAddCardReward_(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  var cardName = (p.cardName || '').trim();
  var category = (p.category || '').trim();
  var rate     = (p.rate     || '').toString().trim();
  var rateType = (p.rateType || '').trim();
  if (!cardName || !category || !rate || !rateType) throw new Error('cardName, category, rate, rateType are required');
  var id    = 'CR-' + Date.now();
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CARD_REWARDS);
  sheet.appendRow([id, cardName, category, rate, rateType, (p.conditions || '').trim()]);
  return { ok: true, id: id };
}

function webUpdateCardReward_(e) {
  var p  = (e && e.parameter) ? e.parameter : {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CARD_REWARDS);
  var rows  = sheet.getDataRange().getValues();
  var colMap = { cardName:2, category:3, rate:4, rateType:5, conditions:6 };
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      for (var key in colMap) {
        if (p[key] != null) sheet.getRange(i + 1, colMap[key]).setValue(p[key].toString().trim());
      }
      return { ok: true };
    }
  }
  throw new Error('Card reward not found: ' + id);
}

function webDeleteCardReward_(e) {
  var p  = (e && e.parameter) ? e.parameter : {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CARD_REWARDS);
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) { sheet.deleteRow(i + 1); return { ok: true, action: 'deleted' }; }
  }
  throw new Error('Card reward not found: ' + id);
}

// ---- Card Perks CRUD + toggle ----

function webAddCardPerk_(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  var cardName  = (p.cardName  || '').trim();
  var perk      = (p.perk      || '').trim();
  var frequency = (p.frequency || 'Monthly').trim();
  if (!cardName || !perk) throw new Error('cardName and perk are required');
  var id    = 'CP-' + Date.now();
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CARD_PERKS);
  sheet.appendRow([id, cardName, perk, (p.amount || '').toString().trim(), frequency, (p.category || '').trim(), '']);
  return { ok: true, id: id };
}

function webDeleteCardPerk_(e) {
  var p  = (e && e.parameter) ? e.parameter : {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CARD_PERKS);
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) { sheet.deleteRow(i + 1); return { ok: true, action: 'deleted' }; }
  }
  throw new Error('Card perk not found: ' + id);
}

function webToggleCardPerk_(e) {
  var p  = (e && e.parameter) ? e.parameter : {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CARD_PERKS);
  var rows  = sheet.getDataRange().getValues();
  var tz    = Session.getScriptTimeZone();
  var now   = new Date();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      var freq       = String(rows[i][4] || 'Monthly');
      var currentPeriod = freq === 'Annual'
        ? Utilities.formatDate(now, tz, 'yyyy')
        : Utilities.formatDate(now, tz, 'yyyy-MM');
      var lastUsed   = String(rows[i][6] || '').trim();
      var newUsed    = (lastUsed === currentPeriod) ? '' : currentPeriod;
      sheet.getRange(i + 1, 7).setValue(newUsed);
      return { ok: true, used: newUsed !== '', period: currentPeriod };
    }
  }
  throw new Error('Card perk not found: ' + id);
}

// ---- Loyalty Programs CRUD ----

function webAddLoyaltyProgram_(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  var program     = (p.program     || '').trim();
  var totalPoints = (p.totalPoints || '0').toString().trim();
  if (!program) throw new Error('program is required');
  var id    = 'LP-' + Date.now();
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.LOYALTY_PROGRAMS);
  sheet.appendRow([
    id, program,
    (p.linkedCard    || '').trim(),
    totalPoints,
    (p.centsPerPoint || '1.0').toString().trim(),
    (p.bestUse       || '').trim(),
    (p.expiry        || '').trim(),
    (p.notes         || '').trim(),
  ]);
  return { ok: true, id: id };
}

function webUpdateLoyaltyProgram_(e) {
  var p  = (e && e.parameter) ? e.parameter : {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.LOYALTY_PROGRAMS);
  var rows  = sheet.getDataRange().getValues();
  var colMap = { program:2, linkedCard:3, totalPoints:4, centsPerPoint:5, bestUse:6, expiry:7, notes:8 };
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      for (var key in colMap) {
        if (p[key] != null) sheet.getRange(i + 1, colMap[key]).setValue(p[key].toString().trim());
      }
      return { ok: true };
    }
  }
  throw new Error('Loyalty program not found: ' + id);
}

function webDeleteLoyaltyProgram_(e) {
  var p  = (e && e.parameter) ? e.parameter : {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.LOYALTY_PROGRAMS);
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) { sheet.deleteRow(i + 1); return { ok: true, action: 'deleted' }; }
  }
  throw new Error('Loyalty program not found: ' + id);
}

// ---- Rewards Goals CRUD ----

function webAddRewardsGoal_(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  var goal         = (p.goal         || '').trim();
  var targetProgram = (p.targetProgram || '').trim();
  var targetPoints  = (p.targetPoints  || '0').toString().trim();
  if (!goal || !targetProgram) throw new Error('goal and targetProgram are required');
  var id    = 'RG-' + Date.now();
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.REWARDS_GOALS);
  sheet.appendRow([
    id, goal, targetProgram, targetPoints,
    (p.currentPoints || '0').toString().trim(),
    (p.notes         || '').trim(),
  ]);
  return { ok: true, id: id };
}

function webUpdateRewardsGoal_(e) {
  var p  = (e && e.parameter) ? e.parameter : {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.REWARDS_GOALS);
  var rows  = sheet.getDataRange().getValues();
  var colMap = { goal:2, targetProgram:3, targetPoints:4, currentPoints:5, notes:6 };
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      for (var key in colMap) {
        if (p[key] != null) sheet.getRange(i + 1, colMap[key]).setValue(p[key].toString().trim());
      }
      return { ok: true };
    }
  }
  throw new Error('Rewards goal not found: ' + id);
}

function webDeleteRewardsGoal_(e) {
  var p  = (e && e.parameter) ? e.parameter : {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('id is required');
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.REWARDS_GOALS);
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) { sheet.deleteRow(i + 1); return { ok: true, action: 'deleted' }; }
  }
  throw new Error('Rewards goal not found: ' + id);
}

// ============================================================
// Important Dates — People tab (Issue #80)
// ============================================================

function webGetImportantDates_() {
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.IMPORTANT_DATES);
  var dates = [];
  if (sheet && sheet.getLastRow() >= 2) {
    var rows = sheet.getDataRange().getValues();
    var hdrs = rows[0];
    rows.slice(1).forEach(function(r) {
      if (!r[0]) return;
      var obj = {};
      hdrs.forEach(function(h, i) { obj[h] = r[i]; });
      dates.push(obj);
    });
  }
  return { ok: true, dates: dates };
}

function webAddImportantDate_(e) {
  var p         = e.parameter || {};
  var label     = (p.label     || '').trim();
  var date      = (p.date      || '').trim();
  var person    = (p.person    || '').trim();
  var recurring = (p.recurring || 'Yes').trim();
  var leadTime  = parseInt(p.leadTime || '30', 10);
  var notes     = (p.notes     || '').trim();
  if (!label || !date) return { ok: false, error: 'label and date required' };
  var id = 'id_' + Date.now();
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  ss.getSheetByName(TABS.IMPORTANT_DATES)
    .appendRow([id, date, label, person, recurring, leadTime, notes, '']);
  return { ok: true, entry: { ID: id, Date: date, Label: label, Person: person,
                               Recurring: recurring, 'Lead Time Days': leadTime, Notes: notes,
                               'Last Actioned Year': '' } };
}

function webUpdateImportantDate_(e) {
  var p        = e.parameter || {};
  var id       = (p.id       || '').trim();
  var label    = (p.label    || '').trim();
  var date     = (p.date     || '').trim();
  var person   = (p.person   || '').trim();
  var recurring= (p.recurring|| '').trim();
  var leadTime = p.leadTime ? parseInt(p.leadTime, 10) : null;
  var notes    = (p.notes    || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.IMPORTANT_DATES);
  var rows  = sheet.getDataRange().getValues();
  var hdrs  = rows[0];
  var colMap = {};
  hdrs.forEach(function(h, i) { colMap[h] = i + 1; });
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      if (date)      sheet.getRange(i+1, colMap['Date']).setValue(date);
      if (label)     sheet.getRange(i+1, colMap['Label']).setValue(label);
      if (person)    sheet.getRange(i+1, colMap['Person']).setValue(person);
      if (recurring) sheet.getRange(i+1, colMap['Recurring']).setValue(recurring);
      if (leadTime)  sheet.getRange(i+1, colMap['Lead Time Days']).setValue(leadTime);
      if (notes !== undefined) sheet.getRange(i+1, colMap['Notes']).setValue(notes);
      return { ok: true, id: id };
    }
  }
  return { ok: false, error: 'not found' };
}

function webDeleteImportantDate_(e) {
  var id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.IMPORTANT_DATES);
  if (!sheet) return { ok: false, error: 'Important Dates sheet not found' };
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === id) { sheet.deleteRow(i + 1); return { ok: true, id: id }; }
  }
  return { ok: false, error: 'not found' };
}

function webPreviewCalendarBirthdays_() {
  var found = [];
  var now   = new Date();
  // Scan 13 months ahead to catch all annual birthdays at least once
  var lookAhead = new Date(now.getFullYear(), now.getMonth() + 13, now.getDate());

  // Build calendar list: getAllCalendars() + explicit lookup for the Google Contacts
  // "Birthdays" system calendar, which often doesn't appear in getAllCalendars().
  var cals = CalendarApp.getAllCalendars();
  var calIds = {};
  cals.forEach(function(c) { calIds[c.getId()] = true; });
  ['Birthdays', 'contacts@group.v.calendar.google.com'].forEach(function(nameOrId) {
    var extra = CalendarApp.getCalendarsByName(nameOrId);
    extra.forEach(function(c) { if (!calIds[c.getId()]) { cals.push(c); calIds[c.getId()] = true; } });
  });

  cals.forEach(function(cal) {
    var calName = cal.getName().toLowerCase();
    var isBirthdayCal = calName.indexOf('birthday') !== -1 || calName.indexOf('contact') !== -1;
    var isJointChaos  = calName.indexOf('joint chaos') !== -1;

    // For dedicated birthday/contact calendars: scan all events (they're all birthdays)
    // For Joint Chaos + any other calendar: only scan if event title contains "birthday"
    var events = cal.getEvents(now, lookAhead);
    events.forEach(function(ev) {
      var title = ev.getTitle() || '';
      var titleLow = title.toLowerCase();

      // Skip events that don't have "birthday" in the title
      if (titleLow.indexOf('birthday') === -1) return;
      // Skip VERA-generated flag events (contain a colon followed by digits, e.g. ": 78 days")
      if (/:\s*\d+\s*days?/i.test(title)) return;

      // Get date — use getAllDayStartDate() for all-day events to avoid timezone offset issues
      var dateObj = ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime();
      var mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      var dd = String(dateObj.getDate()).padStart(2, '0');

      // Extract person name — handle all observed formats:
      // "Victoria's Birthday", "Caiden Birthday", "Birthday - Dad",
      // "Kelly E's Birthday", "Austin's Birthday!", "JC & Omar Birthday"
      var person = title
        .replace(/birthday\s*[-–:]\s*/ig, '')  // "Birthday - Name" / "Birthday: Name"
        .replace(/[-–:]\s*birthday\b.*/ig, '') // "Name - Birthday..." strip from dash onward
        .replace(/[''`]s?\s*birthday\b.*/ig, '') // "Name's Birthday..." strip from 's onward
        .replace(/\s*birthday\b.*/ig, '')       // "Name Birthday..." strip from birthday onward
        .replace(/[!?.,;]+$/, '')              // strip trailing punctuation
        .trim();

      if (!person) return;
      // Deduplicate by person name (case-insensitive) — same person may appear in multiple calendars
      if (!found.find(function(f) { return f.person.toLowerCase() === person.toLowerCase(); })) {
        found.push({ person: person, date: mm + '-' + dd, label: person + "'s Birthday" });
      }
    });
  });

  found.sort(function(a, b) { return a.person.localeCompare(b.person); });
  Logger.log('webPreviewCalendarBirthdays_: found ' + found.length + ' birthday(s): ' +
             found.map(function(f){ return f.person + ' (' + f.date + ')'; }).join(', '));
  return { ok: true, previews: found };
}

function webImportCalendarBirthdays_(e) {
  var entries = [];
  try { entries = JSON.parse((e.parameter && e.parameter.entries) || '[]'); } catch(_) {}
  if (!entries.length) return { ok: false, error: 'no entries provided' };
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.IMPORTANT_DATES);
  if (!sheet) return { ok: false, error: 'Important Dates sheet not found' };
  entries.forEach(function(en) {
    var id = 'id_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    sheet.appendRow([id, en.date, en.label, en.person, 'Yes', 30, '', '']);
    Utilities.sleep(60); // avoid ID collision on rapid appends
  });
  return { ok: true, count: entries.length };
}

// ============================================================
// Gift Ideas — People tab (Issue #105)
// ============================================================

function webGetGiftData_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var people = [];
  var pSheet = ss.getSheetByName(TABS.GIFT_PEOPLE);
  if (pSheet && pSheet.getLastRow() >= 2) {
    people = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 1).getValues()
               .map(function(r) { return String(r[0]).trim(); })
               .filter(function(n) { return n; });
  }
  var ideas = [];
  var iSheet = ss.getSheetByName(TABS.GIFT_IDEAS);
  if (iSheet && iSheet.getLastRow() >= 2) {
    var rows = iSheet.getDataRange().getValues();
    var hdrs = rows[0];
    rows.slice(1).forEach(function(r) {
      if (!r[0]) return;
      var obj = {};
      hdrs.forEach(function(h, i) { obj[h] = r[i]; });
      ideas.push(obj);
    });
  }
  return { ok: true, people: people, ideas: ideas };
}

function webAddGiftPerson_(e) {
  var name = ((e.parameter && e.parameter.name) || '').trim();
  if (!name) return { ok: false, error: 'name required' };
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.GIFT_PEOPLE);
  sheet.appendRow([name]);
  return { ok: true, name: name };
}

function webDeleteGiftPerson_(e) {
  var name = ((e.parameter && e.parameter.name) || '').trim();
  if (!name) return { ok: false, error: 'name required' };
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  // Remove from Gift People
  var pSheet = ss.getSheetByName(TABS.GIFT_PEOPLE);
  if (pSheet && pSheet.getLastRow() >= 2) {
    var pRows = pSheet.getDataRange().getValues();
    for (var i = pRows.length - 1; i >= 1; i--) {
      if (String(pRows[i][0]).trim() === name) { pSheet.deleteRow(i + 1); break; }
    }
  }
  // Remove all their ideas
  var iSheet = ss.getSheetByName(TABS.GIFT_IDEAS);
  if (iSheet && iSheet.getLastRow() >= 2) {
    var iRows = iSheet.getDataRange().getValues();
    for (var j = iRows.length - 1; j >= 1; j--) {
      if (String(iRows[j][1]).trim() === name) iSheet.deleteRow(j + 1);
    }
  }
  return { ok: true, name: name };
}

function webAddGiftIdea_(e) {
  var person = ((e.parameter && e.parameter.person) || '').trim();
  var idea   = ((e.parameter && e.parameter.idea)   || '').trim();
  if (!person || !idea) return { ok: false, error: 'person and idea required' };
  var id = 'gi_' + Date.now();
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  ss.getSheetByName(TABS.GIFT_IDEAS).appendRow([id, person, idea, new Date()]);
  return { ok: true, idea: { ID: id, Person: person, Idea: idea } };
}

function webDeleteGiftIdea_(e) {
  var id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.GIFT_IDEAS);
  if (!sheet) return { ok: false, error: 'Gift Ideas sheet not found' };
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === id) { sheet.deleteRow(i + 1); return { ok: true, id: id }; }
  }
  return { ok: false, error: 'not found' };
}

// ============================================================
// Chores — Household chore checklist (Issue #124)
// ============================================================

function webGetChores_() {
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CHORES);
  var chores = [];
  if (sheet && sheet.getLastRow() >= 2) {
    var rows = sheet.getDataRange().getValues();
    var hdrs = rows[0];
    rows.slice(1).forEach(function(r) {
      if (!r[0]) return;
      var obj = {}; hdrs.forEach(function(h, i) { obj[h] = r[i]; }); chores.push(obj);
    });
  }
  return { ok: true, chores: chores };
}

function webAddChore_(e) {
  var p       = e.parameter || {};
  var chore   = (p.chore   || '').trim();
  var cadence = (p.cadence || 'Daily').trim();
  if (!chore) return { ok: false, error: 'chore text required' };
  var validCadences = ['Daily', 'Weekly', 'Biweekly', 'Monthly', 'Seasonal'];
  if (validCadences.indexOf(cadence) === -1) cadence = 'Daily';
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CHORES);
  var id    = 'ch_' + Date.now();
  var sort  = sheet.getLastRow();
  var date  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.appendRow([id, chore, cadence, sort, false, '', date]);
  return { ok: true, chore: { ID: id, Chore: chore, Cadence: cadence, Sort: sort,
                               Checked: false, 'Checked At': '', 'Added Date': date } };
}

function webDeleteChore_(e) {
  var id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CHORES);
  if (!sheet) return { ok: false, error: 'Chores sheet not found' };
  var rows  = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === id) { sheet.deleteRow(i + 1); return { ok: true, id: id }; }
  }
  return { ok: false, error: 'not found' };
}

function webToggleChore_(e) {
  var id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CHORES);
  if (!sheet) return { ok: false, error: 'Chores sheet not found' };
  var rows     = sheet.getDataRange().getValues();
  var hdrs     = rows[0];
  var chkIdx   = hdrs.indexOf('Checked');
  var chkAtIdx = hdrs.indexOf('Checked At');
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    var newChecked = !rows[i][chkIdx];
    var ts = newChecked ? Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : '';
    sheet.getRange(i + 1, chkIdx + 1).setValue(newChecked);
    sheet.getRange(i + 1, chkAtIdx + 1).setValue(ts);
    return { ok: true, id: id, checked: newChecked, checkedAt: ts };
  }
  return { ok: false, error: 'not found' };
}

function webUpdateChore_(e) {
  var p  = e.parameter || {};
  var id = (p.id || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CHORES);
  if (!sheet) return { ok: false, error: 'Chores sheet not found' };
  var rows  = sheet.getDataRange().getValues();
  var hdrs  = rows[0];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    if (p.cadence !== undefined) sheet.getRange(i + 1, hdrs.indexOf('Cadence') + 1).setValue(p.cadence);
    if (p.chore   !== undefined) sheet.getRange(i + 1, hdrs.indexOf('Chore')   + 1).setValue(p.chore);
    if (p.sort    !== undefined) sheet.getRange(i + 1, hdrs.indexOf('Sort')    + 1).setValue(parseInt(p.sort, 10));
    return { ok: true, id: id };
  }
  return { ok: false, error: 'not found' };
}

// ============================================================
// Vehicles — Issue #125
// ============================================================

function vehicleRowToObj_(hdrs, row) {
  var obj = {};
  hdrs.forEach(function(h, i) { obj[h] = row[i]; });
  var today = new Date();
  today.setHours(0,0,0,0);
  function daysDiff(val) {
    if (!val) return null;
    var d = new Date(val); d.setHours(0,0,0,0);
    return Math.round((d - today) / 86400000);
  }
  obj.nextOilChangeMileage = (parseFloat(obj['Last Oil Change Mileage']) || 0) + (parseFloat(obj['Oil Interval (mi)']) || 0);
  obj.milesUntilOilChange  = obj.nextOilChangeMileage - (parseFloat(obj['Current Mileage']) || 0);
  obj.registrationDays     = daysDiff(obj['Registration Expiry']);
  obj.insuranceDays        = daysDiff(obj['Insurance Expiry']);
  obj.warrantyB2bDays      = daysDiff(obj['Warranty Expiry (B2B)']);
  obj.warrantyPowertrainDays = daysDiff(obj['Warranty Expiry (Powertrain)']);
  obj.serviceDays          = daysDiff(obj['Next Service']);
  return obj;
}

function webGetVehicles_() {
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.VEHICLES);
  if (!sheet) return { ok: true, vehicles: [] };
  var rows  = sheet.getDataRange().getValues();
  if (rows.length < 2) return { ok: true, vehicles: [] };
  var hdrs  = rows[0];
  var vehicles = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    vehicles.push(vehicleRowToObj_(hdrs, rows[i]));
  }
  return { ok: true, vehicles: vehicles };
}

function webAddVehicle_(e) {
  var p  = e.parameter || {};
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.VEHICLES);
  if (!sheet) return { ok: false, error: 'Vehicles sheet not found' };
  var rows  = sheet.getDataRange().getValues();
  var hdrs  = rows[0];
  var maxId = 0;
  for (var i = 1; i < rows.length; i++) {
    var n = parseInt(rows[i][0], 10);
    if (!isNaN(n) && n > maxId) maxId = n;
  }
  var newId = String(maxId + 1);
  var row = hdrs.map(function(h) {
    if (h === 'ID') return newId;
    return p[h] !== undefined ? p[h] : '';
  });
  sheet.appendRow(row);
  var allRows = sheet.getDataRange().getValues();
  return { ok: true, vehicle: vehicleRowToObj_(hdrs, allRows[allRows.length - 1]) };
}

function webDeleteVehicle_(e) {
  var p  = e.parameter || {};
  var id = (p.id || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.VEHICLES);
  if (!sheet) return { ok: false, error: 'Vehicles sheet not found' };
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    sheet.deleteRow(i + 1);
    return { ok: true };
  }
  return { ok: false, error: 'not found' };
}

function webRecordVehicleOilChange_(e) {
  var p  = e.parameter || {};
  var id = (p.id || '').trim();
  var currentMileage = parseFloat(p.currentMileage || 0);
  if (!id) return { ok: false, error: 'id required' };
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.VEHICLES);
  if (!sheet) return { ok: false, error: 'Vehicles sheet not found' };
  var rows  = sheet.getDataRange().getValues();
  var hdrs  = rows[0];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    var today = new Date();
    var interval = parseFloat(rows[i][hdrs.indexOf('Oil Interval (mi)')]) || 5000;
    sheet.getRange(i + 1, hdrs.indexOf('Last Oil Change Date')    + 1).setValue(Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd'));
    sheet.getRange(i + 1, hdrs.indexOf('Last Oil Change Mileage') + 1).setValue(currentMileage);
    sheet.getRange(i + 1, hdrs.indexOf('Current Mileage')         + 1).setValue(currentMileage);
    var nextMi = currentMileage + interval;
    // Create a calendar reminder
    try {
      var cal = CalendarApp.getDefaultCalendar();
      var nickname = rows[i][hdrs.indexOf('Nickname')] || 'Vehicle';
      var reminderDate = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000); // ~90 days
      cal.createAllDayEvent(nickname + ' Oil Change Due (~' + Math.round(nextMi) + ' mi)', reminderDate);
    } catch(calErr) { /* non-fatal */ }
    var updatedRows = sheet.getDataRange().getValues();
    return { ok: true, vehicle: vehicleRowToObj_(hdrs, updatedRows[i]) };
  }
  return { ok: false, error: 'not found' };
}

function webRecordVehicleService_(e) {
  var p  = e.parameter || {};
  var id = (p.id || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.VEHICLES);
  if (!sheet) return { ok: false, error: 'Vehicles sheet not found' };
  var rows  = sheet.getDataRange().getValues();
  var hdrs  = rows[0];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    var today = new Date();
    var intervalMo = parseFloat(rows[i][hdrs.indexOf('Service Interval (mo)')]) || 6;
    var nextService = new Date(today.getFullYear(), today.getMonth() + intervalMo, today.getDate());
    sheet.getRange(i + 1, hdrs.indexOf('Last Service') + 1).setValue(Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd'));
    sheet.getRange(i + 1, hdrs.indexOf('Next Service') + 1).setValue(Utilities.formatDate(nextService, Session.getScriptTimeZone(), 'yyyy-MM-dd'));
    var updatedRows = sheet.getDataRange().getValues();
    return { ok: true, vehicle: vehicleRowToObj_(hdrs, updatedRows[i]) };
  }
  return { ok: false, error: 'not found' };
}

function webUpdateVehicleMileage_(e) {
  var p  = e.parameter || {};
  var id = (p.id || '').trim();
  var mileage = parseFloat(p.mileage || 0);
  if (!id) return { ok: false, error: 'id required' };
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.VEHICLES);
  if (!sheet) return { ok: false, error: 'Vehicles sheet not found' };
  var rows  = sheet.getDataRange().getValues();
  var hdrs  = rows[0];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    sheet.getRange(i + 1, hdrs.indexOf('Current Mileage') + 1).setValue(mileage);
    var updatedRows = sheet.getDataRange().getValues();
    return { ok: true, vehicle: vehicleRowToObj_(hdrs, updatedRows[i]) };
  }
  return { ok: false, error: 'not found' };
}

// ============================================================
// Traveler Profiles + Visa Requirements (Issue #123)
// ============================================================

function webGetProfiles_() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TABS.PROFILES);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, profiles: [] };
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, PROFILES_HEADERS.length).getValues();
  var profiles = rows
    .filter(function(r) { return r[0]; })
    .map(function(r) {
      return {
        id:             r[0],
        name:           r[1],
        passportCountry: r[2],
        passportExpiry: r[3] ? Utilities.formatDate(new Date(r[3]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
        specialDocs:    r[4],
        notes:          r[5]
      };
    });
  return { ok: true, profiles: profiles };
}

function webSaveProfile_(params) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TABS.PROFILES);
  var id    = (params.id || '').trim();
  var row   = [
    id || ('PROF-' + Date.now()),
    params.name           || '',
    params.passportCountry || '',
    params.passportExpiry  || '',
    params.specialDocs     || '',
    params.notes           || ''
  ];
  if (!id) {
    sheet.appendRow(row);
    return { ok: true, id: row[0] };
  }
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) {
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return { ok: true, id: id };
    }
  }
  // Not found — insert as new
  sheet.appendRow(row);
  return { ok: true, id: row[0] };
}

function webDeleteProfile_(params) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TABS.PROFILES);
  var id    = (params.id || '').trim();
  if (!id) return { ok: false, error: 'No id' };
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'not found' };
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

function visaStatusLabel_(status) {
  if (!status || status === '' || status === '-1') return 'No Data';
  if (status === 'VR') return 'Visa Required';
  if (status === 'VOA') return 'Visa on Arrival';
  if (status === 'ETA') return 'eTA / e-Visa';
  if (status === 'CB') return 'No Passport Control';
  if (status === 'VF') return 'Visa Free';
  if (/^\d+$/.test(status)) return 'Visa Free (' + status + ' days)';
  return status;
}

function visaStatusColor_(status) {
  if (!status || status === '' || status === '-1') return 'grey';
  if (status === 'VR') return 'red';
  if (status === 'VOA' || status === 'ETA') return 'yellow';
  if (status === 'VF' || /^\d+$/.test(status) || status === 'CB') return 'green';
  return 'grey';
}
