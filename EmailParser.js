// ============================================================
// EmailParser.js — Issue #98
// Automatic inbox scan: broad Gmail search → Claude batch
// confidence scoring → enrich or create itinerary rows.
// ============================================================

const EMAIL_PARSER_VERSION = '1.0';
const MAX_SIGNAL_CHARS     = 2500;  // max chars of email body sent to Claude
const BATCH_SIZE           = 20;    // max emails per Claude batch call
const HIGH_CONF            = 0.85;  // auto-process threshold
const LOW_CONF             = 0.60;  // discard-below threshold
const MATCH_ENRICH         = 80;    // score → enrich existing row (Mode A)
const MATCH_HOLD           = 50;    // score → hold for user confirmation

// ─── TRIGGER ENTRY POINT ─────────────────────────────────────────────────────

/**
 * runEmailScan_()
 * Called every 30 minutes by a ScriptApp trigger installed by setupTriggers().
 * Scans Gmail for travel confirmation emails and processes them.
 */
function runEmailScan_() {
  var _epStart = Date.now();
  try {
  const enabled = getConfigValues()['email_parser_enabled'];
  if (enabled !== 'true') {
    veraLog_('runEmailScan', 'Email', 'Skipped', 'email_parser_enabled is not true', Date.now() - _epStart);
    return;
  }

  Logger.log('EmailParser v' + EMAIL_PARSER_VERSION + ' — scan started');

  const query   = buildTravelSearchQuery_();
  const threads = GmailApp.search(query, 0, 50);
  Logger.log('Gmail query returned ' + threads.length + ' threads');

  // Collect candidate messages (first message of each thread)
  const candidates = [];
  threads.forEach(function(thread) {
    const msg       = thread.getMessages()[0];
    const messageId = msg.getId();
    if (isAlreadyProcessed_(messageId)) return;
    candidates.push({
      id:      messageId,
      subject: msg.getSubject(),
      body:    extractSignalText_(msg.getBody()),
    });
  });

  if (!candidates.length) {
    Logger.log('EmailParser — no new candidates, exiting');
    veraLog_('runEmailScan', 'Email', 'Success', 'No new travel emails found (' + threads.length + ' threads checked)', Date.now() - _epStart);
    return;
  }
  Logger.log('EmailParser — ' + candidates.length + ' new candidates to classify');

  // Batch to Claude for confidence scoring (groups of BATCH_SIZE)
  for (var i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch   = candidates.slice(i, i + BATCH_SIZE);
    const results = callClaudeBatch_(batch);

    results.forEach(function(result) {
      const cand = batch.find(function(c) { return c.id === result.id; });
      if (!cand) return;

      // Below LOW_CONF — discard silently
      if (!result.isConfirmation || (result.confidence || 0) < LOW_CONF) {
        markProcessed_(cand.id, cand.subject, 'excluded', 'low_confidence', '');
        Logger.log('EXCLUDED [' + (result.confidence || 0).toFixed(2) + '] ' + cand.subject);
        return;
      }

      // Below HIGH_CONF — flag for manual review, hold processing
      if ((result.confidence || 0) < HIGH_CONF) {
        const holdFlag = buildConfirmMatchFlagObj_(
          result.vendor || cand.subject,
          result.date   || '',
          cand.subject,
          result.confidence
        );
        writeFlags([holdFlag]);
        markProcessed_(cand.id, cand.subject, 'held', 'medium_confidence', '');
        Logger.log('HELD [' + (result.confidence || 0).toFixed(2) + '] ' + cand.subject);
        return;
      }

      // High confidence — route by itinerary match score
      Logger.log('PROCESSING [' + (result.confidence || 0).toFixed(2) + '] ' + cand.subject);
      processConfirmedEmail_(cand, result);
    });
  }

  Logger.log('EmailParser — scan complete');
  veraLog_('runEmailScan', 'Email', 'Success',
    candidates.length + ' candidate(s) classified from ' + threads.length + ' thread(s)',
    Date.now() - _epStart);
  } catch (err) {
    Logger.log('runEmailScan_ FATAL: ' + err.message + '\n' + (err.stack || ''));
    veraLog_('runEmailScan', 'Email', 'Failed', '', Date.now() - _epStart, err.message);
  }
}

// ─── GMAIL SEARCH ────────────────────────────────────────────────────────────

function buildTravelSearchQuery_() {
  // Broad search: travel confirmation subjects from the last 2 days, OR anything labeled VERA
  return '(subject:(confirmation OR reservation OR booking OR "e-ticket" OR "check-in" OR "your stay" OR "your order" OR "itinerary") newer_than:2d) OR label:VERA';
}

function extractSignalText_(htmlBody) {
  if (!htmlBody) return '';
  var text = htmlBody
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.substring(0, MAX_SIGNAL_CHARS);
}

// ─── CLAUDE BATCH CONFIDENCE SCORING ─────────────────────────────────────────

function callClaudeBatch_(candidates) {
  const systemPrompt =
    'You are a booking confirmation classifier for a personal assistant. ' +
    'Classify each email as a genuine travel or dining booking confirmation or not. ' +
    'Return ONLY a valid JSON array with one object per email. No markdown, no explanation.';

  const userMsg =
    'Classify each of these emails. Return a JSON array — one entry per email.\n\n' +
    'Format:\n' +
    '[{"id":"<id>","isConfirmation":true/false,"confidence":0.0-1.0,' +
    '"vendor":"venue or company name or null","date":"YYYY-MM-DD or null",' +
    '"type":"dining|hotel|flight|show|activity|manual"}]\n\n' +
    'Emails to classify:\n' +
    JSON.stringify(candidates.map(function(c) {
      return { id: c.id, subject: c.subject, body: c.body.substring(0, 500) };
    }));

  const requestBody = {
    model:      CLAUDE_MODEL,
    max_tokens: 2048,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userMsg }],
  };

  try {
    const response = fetchTracked_('anthropic', CLAUDE_API_URL, {
      method:  'post',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         getApiKey(),
        'anthropic-version': '2023-06-01',
      },
      payload:            JSON.stringify(requestBody),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) {
      Logger.log('callClaudeBatch_ API error ' + response.getResponseCode() + ': ' + response.getContentText().substring(0, 200));
      return [];
    }
    const json    = JSON.parse(response.getContentText());
    const rawText = ((json.content || [])[0] || {}).text || '';
    return parseBatchResponse_(rawText);
  } catch(err) {
    Logger.log('callClaudeBatch_ error: ' + err.message);
    return [];
  }
}

function parseBatchResponse_(rawText) {
  try {
    var cleaned = (rawText || '').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    var start = cleaned.indexOf('[');
    var end   = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('No JSON array found');
    var parsed = JSON.parse(cleaned.substring(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error('Expected array');
    return parsed.filter(function(r) { return r && r.id; });
  } catch(err) {
    Logger.log('parseBatchResponse_ failed: ' + err.message + ' | raw: ' + (rawText || '').substring(0, 300));
    return [];
  }
}

// ─── MODE ROUTING ─────────────────────────────────────────────────────────────

/**
 * processConfirmedEmail_()
 * Called for emails with confidence ≥ HIGH_CONF.
 * Scores existing itinerary rows and routes to Mode A (enrich) or Mode B (create).
 * Also fires an independent cancellation-deadline flag if applicable.
 */
function processConfirmedEmail_(cand, result) {
  const vendor = result.vendor || cand.subject;
  const date   = result.date   || '';

  const match = findMatchingItineraryRow_(vendor, date);
  Logger.log('Match score for "' + vendor + '": ' + match.score);

  var enrichData = null;

  if (match.score >= MATCH_ENRICH) {
    // ── MODE A: Enrich-only ──────────────────────────────────────────────────
    enrichData = callClaudeEnrich_(cand.body);
    enrichItineraryRow_(match.sheet, match.rowNum, enrichData, cand.id);
    writeFlags([buildEnrichFlagObj_(match.title, match.date, enrichData)]);
    markProcessed_(cand.id, cand.subject, 'enrich_only', 'enriched', '');
    Logger.log('MODE A — enriched row ' + match.row[0] + ' for "' + vendor + '"');

  } else if (match.score >= MATCH_HOLD) {
    // ── AMBIGUOUS: Hold for user confirmation ────────────────────────────────
    enrichData = callClaudeEnrich_(cand.body);
    const pendingData = JSON.stringify({
      itineraryRowId: String(match.row[0] || ''),
      rowNum:         match.rowNum,
      enrichData:     enrichData,
    });
    writeFlags([buildConfirmHoldFlagObj_(vendor, date, match.title, enrichData, match.score)]);
    markProcessed_(cand.id, cand.subject, 'confirm_match', 'held_for_review', pendingData);
    Logger.log('HOLD — pending confirm for "' + vendor + '" (score ' + match.score + ')');

  } else {
    // ── MODE B: Create-and-enrich ────────────────────────────────────────────
    const extracted = callClaudeCreateEnrich_(cand.body);
    if (!extracted || !extracted.basic || !extracted.basic.title) {
      Logger.log('MODE B parse failed for "' + vendor + '"');
      markProcessed_(cand.id, cand.subject, 'create_and_enrich', 'parse_failed', '');
      return;
    }
    const newId = createItineraryRowFromEmail_(extracted.basic, extracted.rich, cand.id);
    writeFlags([buildNewBookingFlagObj_(newId, extracted.basic, extracted.rich)]);
    markProcessed_(cand.id, cand.subject, 'create_and_enrich', 'created', '');
    enrichData = extracted.rich;
    Logger.log('MODE B — created row ' + newId + ' for "' + vendor + '"');
  }

  // ── Cancellation deadline — independent of mode ───────────────────────────
  const policy = (enrichData && enrichData.cancellationPolicy) || '';
  if (policy && hasPendingDeadline_(policy)) {
    writeFlags([buildCancellationDeadlineFlagObj_(vendor, date, policy)]);
    Logger.log('DEADLINE FLAG written for "' + vendor + '"');
  }
}

// ─── ITINERARY ROW MATCHING ───────────────────────────────────────────────────

/**
 * findMatchingItineraryRow_()
 * Scores every row in the Itinerary sheet:
 *   date exact match → +50
 *   fuzzy token overlap of vendor vs title → 0–40
 * Returns the best-scoring row and its mode classification.
 */
function findMatchingItineraryRow_(vendor, extractedDate) {
  const ss    = getSpreadsheet();
  ensureSheet(ss, TABS.ITINERARY, ITINERARY_HEADERS);
  const sheet = ss.getSheetByName(TABS.ITINERARY);

  if (!sheet || sheet.getLastRow() < 2) {
    return { score: 0, sheet: sheet, rowNum: -1, row: null, title: '', date: '' };
  }

  const rows      = sheet.getRange(2, 1, sheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
  var bestScore   = -1;
  var bestRowNum  = -1;
  var bestRow     = null;

  rows.forEach(function(row, i) {
    var score = 0;
    // Date match: +50
    var rowDate = String(row[4] || '').substring(0, 10);  // col 5 = Date (0-indexed col 4)
    if (extractedDate && rowDate === extractedDate) score += 50;
    // Fuzzy title match: 0–40
    var rowTitle = String(row[3] || '').toLowerCase();    // col 4 = Title (0-indexed col 3)
    score += Math.round(fuzzyTokenScore_(rowTitle, (vendor || '').toLowerCase()) * 40);

    if (score > bestScore) {
      bestScore  = score;
      bestRowNum = i + 2;  // 1-based, skip header row
      bestRow    = row;
    }
  });

  return {
    score:  bestScore,
    sheet:  sheet,
    rowNum: bestRowNum,
    row:    bestRow,
    title:  bestRow ? String(bestRow[3] || '') : '',
    date:   bestRow ? String(bestRow[4] || '').substring(0, 10) : '',
  };
}

/** Simple token overlap score — 0 to 1 */
function fuzzyTokenScore_(a, b) {
  if (!a || !b) return 0;
  var tokA = a.split(/\W+/).filter(Boolean);
  var tokB = b.split(/\W+/).filter(Boolean);
  if (!tokA.length || !tokB.length) return 0;
  var matches = tokA.filter(function(t) { return t.length > 2 && tokB.indexOf(t) !== -1; }).length;
  return matches / Math.max(tokA.length, tokB.length);
}

// ─── MODE A — 15-FIELD ENRICHMENT ────────────────────────────────────────────

function callClaudeEnrich_(signalText) {
  const prompt =
    'Extract supplementary booking details from this confirmation email. ' +
    'Return ONLY valid JSON, no markdown, no explanation. ' +
    'Use null for any field not found.\n\n' +
    '{\n' +
    '  "confirmationNumber": "string or null",\n' +
    '  "cancellationPolicy": "one sentence including deadline if mentioned, or null",\n' +
    '  "dresscode": "string or null",\n' +
    '  "depositPaid": "number or null",\n' +
    '  "depositCurrency": "USD or null",\n' +
    '  "partySize": "number or null",\n' +
    '  "specialRequests": "string or null",\n' +
    '  "parkingInfo": "string or null",\n' +
    '  "contactPhone": "string or null",\n' +
    '  "loyaltyNumber": "string or null",\n' +
    '  "seatAssignment": "string or null",\n' +
    '  "mealPreference": "string or null",\n' +
    '  "checkInInstructions": "string or null",\n' +
    '  "wifiInfo": "string or null",\n' +
    '  "importantNotes": "one sentence — what a guest should know on arrival, or null"\n' +
    '}\n\n' +
    'EMAIL:\n' + signalText;

  return callClaudeJson_(prompt, {});
}

/**
 * enrichItineraryRow_()
 * Merges enrichData into the existing Metadata JSON in column J of the Itinerary sheet.
 * Never overwrites existing fields like flightNum, airline, etc.
 */
function enrichItineraryRow_(sheet, rowNum, enrichData, messageId) {
  var existing = {};
  try {
    var raw = sheet.getRange(rowNum, 10).getValue();
    if (raw) existing = JSON.parse(String(raw));
  } catch(e) {}

  // Merge: existing fields take priority for flight/hotel specifics; email data fills the rest
  var merged = Object.assign({}, enrichData || {}, existing);
  // But always overwrite the email-parser provenance fields
  merged.enrichedFrom  = 'email';
  merged.enrichedAt    = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  merged.sourceEmailId = messageId;

  sheet.getRange(rowNum, 10).setValue(JSON.stringify(merged));
}

// ─── MODE B — CREATE-AND-ENRICH ───────────────────────────────────────────────

function callClaudeCreateEnrich_(signalText) {
  const prompt =
    'Extract booking information from this confirmation email to create a new reservation record. ' +
    'Return ONLY valid JSON with two blocks: "basic" and "rich". No markdown, no explanation. ' +
    'Use null for any field not found.\n\n' +
    '{\n' +
    '  "basic": {\n' +
    '    "type": "dining|hotel|flight|show|activity|car_rental|spa|tour|manual",\n' +
    '    "title": "venue or provider name",\n' +
    '    "date": "YYYY-MM-DD or null",\n' +
    '    "startTime": "HH:MM or null",\n' +
    '    "endTime": "HH:MM or null",\n' +
    '    "location": "city or address or null"\n' +
    '  },\n' +
    '  "rich": {\n' +
    '    "confirmationNumber": "string or null",\n' +
    '    "cancellationPolicy": "one sentence including deadline if mentioned, or null",\n' +
    '    "dresscode": "string or null",\n' +
    '    "depositPaid": "number or null",\n' +
    '    "depositCurrency": "USD or null",\n' +
    '    "partySize": "number or null",\n' +
    '    "specialRequests": "string or null",\n' +
    '    "parkingInfo": "string or null",\n' +
    '    "contactPhone": "string or null",\n' +
    '    "loyaltyNumber": "string or null",\n' +
    '    "seatAssignment": "string or null",\n' +
    '    "mealPreference": "string or null",\n' +
    '    "checkInInstructions": "string or null",\n' +
    '    "wifiInfo": "string or null",\n' +
    '    "importantNotes": "one sentence — what a guest should know on arrival, or null"\n' +
    '  }\n' +
    '}\n\n' +
    'EMAIL:\n' + signalText;

  return callClaudeJson_(prompt, { basic: {}, rich: {} });
}

/**
 * createItineraryRowFromEmail_()
 * Creates a new Itinerary sheet row from the parsed email data.
 * Trip Key is left blank — user assigns it via the Travel tab.
 * Returns the new row ID.
 */
function createItineraryRowFromEmail_(basic, rich, messageId) {
  const ss    = getSpreadsheet();
  ensureSheet(ss, TABS.ITINERARY, ITINERARY_HEADERS);
  const sheet = ss.getSheetByName(TABS.ITINERARY);

  const tz      = Session.getScriptTimeZone();
  const dateKey = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  var seq       = 1;
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function(r) {
      if (String(r[0]).indexOf('ITIN-' + dateKey) === 0) seq++;
    });
  }

  var metadata          = Object.assign({}, rich || {});
  metadata.enrichedFrom  = 'email';
  metadata.enrichedAt    = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  metadata.sourceEmailId = messageId;

  const id  = 'ITIN-' + dateKey + '-' + String(seq).padStart(2, '0');
  const row = [
    id,
    '',                         // Trip Key — blank, user assigns via dashboard
    (basic.type      || 'manual'),
    (basic.title     || ''),
    (basic.date      || ''),
    (basic.startTime || ''),
    (basic.endTime   || ''),
    (basic.location  || ''),
    '',                         // Notes
    JSON.stringify(metadata),
  ];

  // Force plain-text format on date/time columns (5, 6, 7 = cols E, F, G)
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 5, 1, 3).setNumberFormat('@');
  sheet.getRange(startRow, 1, 1, ITINERARY_HEADERS.length).setValues([row]);

  return id;
}

// ─── SHARED CLAUDE JSON HELPER ────────────────────────────────────────────────

/**
 * callClaudeJson_()
 * Calls Claude with a prompt expecting a JSON object or array response.
 * Returns parsed JSON or `fallback` on any error.
 */
function callClaudeJson_(prompt, fallback) {
  try {
    const requestBody = {
      model:      CLAUDE_MODEL,
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }],
    };
    const response = fetchTracked_('anthropic', CLAUDE_API_URL, {
      method:  'post',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         getApiKey(),
        'anthropic-version': '2023-06-01',
      },
      payload:            JSON.stringify(requestBody),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) {
      Logger.log('callClaudeJson_ API error ' + response.getResponseCode());
      return fallback;
    }
    const json    = JSON.parse(response.getContentText());
    const rawText = (((json.content || [])[0]) || {}).text || '';
    var cleaned   = rawText.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    // Try object first, then array
    var start = cleaned.indexOf('{');
    var end   = cleaned.lastIndexOf('}');
    if (start === -1) { start = cleaned.indexOf('['); end = cleaned.lastIndexOf(']'); }
    if (start === -1 || end === -1) throw new Error('No JSON structure found');
    return JSON.parse(cleaned.substring(start, end + 1));
  } catch(err) {
    Logger.log('callClaudeJson_ error: ' + err.message);
    return fallback;
  }
}

// ─── FLAG BUILDERS ────────────────────────────────────────────────────────────

function buildEnrichFlagObj_(title, date, enrichData) {
  var details = [];
  if (enrichData.confirmationNumber) details.push('Conf# ' + enrichData.confirmationNumber);
  if (enrichData.dresscode)          details.push(enrichData.dresscode);
  if (enrichData.cancellationPolicy) details.push(enrichData.cancellationPolicy);
  if (enrichData.parkingInfo)        details.push(enrichData.parkingInfo);
  return {
    source:  'Email Parser',
    flag:    (title || 'Booking') + ' enriched from confirmation email',
    reason:  details.length ? details.join(' · ') : 'Rich details extracted from confirmation email — review in itinerary.',
    urgency: 'Low',
    key:     'enriched_' + slugify_(title) + '_' + (date || '').replace(/-/g, ''),
  };
}

function buildConfirmMatchFlagObj_(vendor, date, subject, confidence) {
  return {
    source:  'Email Parser',
    flag:    'Confirmation email received — no itinerary match found',
    reason:  'Email "' + subject + '" looks like a booking confirmation (' +
             Math.round((confidence || 0) * 100) + '% confidence). ' +
             'VERA could not match it to an existing itinerary item with enough certainty. ' +
             'Review and add manually via the Travel tab if needed.',
    urgency: 'Medium',
    key:     'unmatched_email_' + slugify_(vendor || subject) + '_' + (date || '').replace(/-/g, ''),
  };
}

function buildConfirmHoldFlagObj_(vendor, date, existingTitle, enrichData, score) {
  var details = [];
  if (enrichData.confirmationNumber) details.push('Conf# ' + enrichData.confirmationNumber);
  if (enrichData.cancellationPolicy) details.push(enrichData.cancellationPolicy);
  return {
    source:  'Email Parser',
    flag:    'Confirmation email matched to itinerary — please verify',
    reason:  'Email for "' + vendor + '" (' + (date || 'unknown date') + ') was matched to "' +
             existingTitle + '" with low confidence (score: ' + score + '/100). ' +
             'Details ready to write: ' + (details.join(' · ') || 'see email') + '. ' +
             'Resolve this flag to confirm the enrichment write.',
    urgency: 'Medium',
    key:     'confirm_match_' + slugify_(vendor) + '_' + (date || '').replace(/-/g, ''),
  };
}

function buildNewBookingFlagObj_(newId, basic, rich) {
  var details = [];
  if (rich.confirmationNumber) details.push('Conf# ' + rich.confirmationNumber);
  if (rich.cancellationPolicy) details.push(rich.cancellationPolicy);
  if (rich.parkingInfo)        details.push(rich.parkingInfo);
  return {
    source:  'Email Parser',
    flag:    'New booking parsed from email — verify and assign to trip',
    reason:  (basic.title || 'Booking') + ' · ' + (basic.date || 'unknown date') + ' · ' +
             (basic.location || 'location unknown') + '. ' +
             'New itinerary row created (' + newId + '). ' +
             (details.length ? details.join(' · ') + '. ' : '') +
             'Assign to the correct trip in the Travel tab.',
    urgency: 'Medium',
    key:     'new_booking_' + slugify_(basic.title || 'booking') + '_' + (basic.date || '').replace(/-/g, ''),
  };
}

function buildCancellationDeadlineFlagObj_(title, date, policy) {
  return {
    source:  'Email Parser',
    flag:    (title || 'Booking') + ' — cancellation window closes soon',
    reason:  (date ? 'Reservation on ' + date + '. ' : '') + policy,
    urgency: 'High',
    key:     'cancel_deadline_' + slugify_(title || 'booking') + '_' + (date || '').replace(/-/g, ''),
  };
}

/** Returns true if the cancellation policy mentions an imminent same-day/tonight deadline. */
function hasPendingDeadline_(policy) {
  if (!policy) return false;
  var keywords = ['by tonight', 'by today', 'day-of', 'day of', '24-hour', '24 hour',
                  '48-hour', '48 hour', 'tonight', 'today'];
  var lc = policy.toLowerCase();
  return keywords.some(function(k) { return lc.indexOf(k) !== -1; });
}

/** Converts a string to a lowercase slug safe for use as a flag key. */
function slugify_(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 40);
}

// ─── PROCESSED EMAILS LOG ─────────────────────────────────────────────────────

function isAlreadyProcessed_(messageId) {
  const ss    = getSpreadsheet();
  ensureSheet(ss, TABS.PROCESSED_EMAILS, PROCESSED_EMAILS_HEADERS);
  const sheet = ss.getSheetByName(TABS.PROCESSED_EMAILS);
  if (sheet.getLastRow() < 2) return false;
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  return ids.some(function(r) { return String(r[0]) === messageId; });
}

function markProcessed_(messageId, subject, mode, outcome, pendingData) {
  const ss          = getSpreadsheet();
  ensureSheet(ss, TABS.PROCESSED_EMAILS, PROCESSED_EMAILS_HEADERS);
  const sheet       = ss.getSheetByName(TABS.PROCESSED_EMAILS);
  const processedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  sheet.appendRow([messageId, processedAt, (subject || '').substring(0, 120), mode, outcome, pendingData || '']);
}

// ─── CONFIRM PENDING ENRICHMENT (hold → write) ────────────────────────────────

/**
 * confirmPendingEnrichment_()
 * Called by webConfirmEnrich_() in WebApp.js when a user confirms an ambiguous match.
 * Reads the pending enrichment data from the Processed Emails log and writes it to
 * the matched itinerary row.
 */
function confirmPendingEnrichment_(messageId) {
  const ss    = getSpreadsheet();
  ensureSheet(ss, TABS.PROCESSED_EMAILS, PROCESSED_EMAILS_HEADERS);
  const sheet = ss.getSheetByName(TABS.PROCESSED_EMAILS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'No Processed Emails log found' };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, PROCESSED_EMAILS_HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) !== messageId) continue;

    const pendingRaw = String(rows[i][5] || '');
    if (!pendingRaw) return { ok: false, error: 'No pending enrichment data for this message ID' };

    var pending;
    try { pending = JSON.parse(pendingRaw); } catch(e) {
      return { ok: false, error: 'Invalid pending data: ' + e.message };
    }

    // Find the itinerary row by stored ID
    const iSheet = ss.getSheetByName(TABS.ITINERARY);
    if (!iSheet || iSheet.getLastRow() < 2) return { ok: false, error: 'Itinerary sheet is empty' };

    const iRows     = iSheet.getRange(2, 1, iSheet.getLastRow() - 1, 1).getValues();
    var targetRowNum = -1;
    for (var j = 0; j < iRows.length; j++) {
      if (String(iRows[j][0]) === pending.itineraryRowId) { targetRowNum = j + 2; break; }
    }
    if (targetRowNum === -1) return { ok: false, error: 'Itinerary row not found: ' + pending.itineraryRowId };

    enrichItineraryRow_(iSheet, targetRowNum, pending.enrichData, messageId);

    // Update outcome in Processed Emails log
    sheet.getRange(i + 2, 5).setValue('confirmed_and_enriched');
    sheet.getRange(i + 2, 6).setValue('');  // Clear pending data after write

    Logger.log('confirmPendingEnrichment_: enriched row ' + pending.itineraryRowId);
    return { ok: true, id: pending.itineraryRowId };
  }

  return { ok: false, error: 'Message ID not found in Processed Emails log' };
}

// ─── TEST / DRY RUN ───────────────────────────────────────────────────────────

/**
 * testEmailScan_()
 * Dry-run mode — logs what the scanner would process without writing anything.
 * Run from the Apps Script editor to verify Gmail query coverage.
 */
function testEmailScan_() {
  Logger.log('=== EMAIL PARSER DRY RUN ===');
  const query   = buildTravelSearchQuery_();
  Logger.log('Search query: ' + query);
  const threads = GmailApp.search(query, 0, 20);
  Logger.log('Threads found: ' + threads.length);

  threads.forEach(function(thread) {
    const msg  = thread.getMessages()[0];
    const id   = msg.getId();
    const subj = msg.getSubject();
    const proc = isAlreadyProcessed_(id);
    Logger.log((proc ? '[SKIP — already processed] ' : '[CANDIDATE] ') + subj + '  (' + id + ')');
  });

  Logger.log('=== DRY RUN COMPLETE — no writes performed ===');
}
