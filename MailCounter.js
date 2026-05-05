// ============================================================
// MailCounter.js — USPS Informed Delivery mail/package counter
// Issue #175
//
// Scans Gmail for USPS Informed Delivery emails and maintains
// running counters (pieces of mail + packages) in Script Properties.
// Counters accumulate until user resets via "Got the mail!" button.
//
// Script Properties used:
//   MAIL_COUNTER_PIECES        — integer string, running total of mail pieces
//   MAIL_COUNTER_PACKAGES      — integer string, running total of packages
//   MAIL_COUNTER_LAST_SCAN     — ISO timestamp of newest email already processed
//   MAIL_COUNTER_LAST_SCAN_RUN — ISO timestamp of when scan last ran
//   MAIL_COUNTER_LAST_RESET    — ISO timestamp of last user reset
// ============================================================

/**
 * Scans Gmail for USPS Informed Delivery emails and increments counters.
 * Called by a 10am daily trigger installed by setupTriggers().
 */
function scanUSPSMail_() {
  try {
    var props   = PropertiesService.getScriptProperties();
    var lastScan = props.getProperty('MAIL_COUNTER_LAST_SCAN') || '2000-01-01T00:00:00.000Z';
    var lastScanDate = new Date(lastScan);

    var threads = GmailApp.search('from:informeddelivery.usps.com is:unread', 0, 10);

    var mailDelta    = 0;
    var pkgDelta     = 0;
    var latestDate   = lastScanDate;

    for (var t = 0; t < threads.length; t++) {
      var msgs = threads[t].getMessages();
      for (var m = 0; m < msgs.length; m++) {
        var msg     = msgs[m];
        var msgDate = msg.getDate();

        // Skip already-processed emails
        if (msgDate <= lastScanDate) continue;

        var body = msg.getPlainBody() || msg.getBody().replace(/<[^>]+>/g, ' ');
        Logger.log('📧 Processing email from ' + msgDate.toISOString() + ' | body preview: ' + body.replace(/\s+/g, ' ').substring(0, 300));

        // --- Parse mail pieces ---
        // "3 mailpiece(s)"  ← actual USPS format
        // "3 pieces of First-Class Mail" / "1 piece of mail" / "2 mail pieces"  ← legacy
        var pieceMatch1 = body.match(/(\d+)\s+mailpiece/i);
        var pieceMatch2 = body.match(/(\d+)\s+pieces?\s+of\s+(?:First-Class\s+)?[Mm]ail/);
        var pieceMatch3 = body.match(/(\d+)\s+[Mm]ail\s+pieces?/);
        var pieces = 0;
        if      (pieceMatch1) pieces = parseInt(pieceMatch1[1], 10);
        else if (pieceMatch2) pieces = parseInt(pieceMatch2[1], 10);
        else if (pieceMatch3) pieces = parseInt(pieceMatch3[1], 10);
        mailDelta += pieces;

        // --- Parse packages ---
        // "0 inbound package(s)"  ← actual USPS format
        // "2 packages scheduled" / "1 package arriving"  ← legacy
        var pkgMatch = body.match(/(\d+)\s+(?:inbound\s+)?package/i);
        if (pkgMatch) pkgDelta += parseInt(pkgMatch[1], 10);

        // Track newest processed message date
        if (msgDate > latestDate) latestDate = msgDate;
      }
    }

    // Update running totals
    var currentPieces = parseInt(props.getProperty('MAIL_COUNTER_PIECES')   || '0', 10);
    var currentPkgs   = parseInt(props.getProperty('MAIL_COUNTER_PACKAGES') || '0', 10);

    props.setProperties({
      'MAIL_COUNTER_PIECES':        String(currentPieces + mailDelta),
      'MAIL_COUNTER_PACKAGES':      String(currentPkgs   + pkgDelta),
      'MAIL_COUNTER_LAST_SCAN':     latestDate.toISOString(),
      'MAIL_COUNTER_LAST_SCAN_RUN': new Date().toISOString(),
    });

    Logger.log('📬 Mail scan complete. +'  + mailDelta + ' pieces, +' + pkgDelta + ' packages. Totals: ' + (currentPieces + mailDelta) + ' / ' + (currentPkgs + pkgDelta));
  } catch (err) {
    Logger.log('⚠ scanUSPSMail_ error: ' + err.message);
  }
}

/**
 * Returns current counter state from Script Properties.
 * @return {{pieces:number, packages:number, lastScan:string, lastScanRun:string, lastReset:string}}
 */
function getMailCounter_() {
  var props = PropertiesService.getScriptProperties();
  return {
    pieces:      parseInt(props.getProperty('MAIL_COUNTER_PIECES')        || '0', 10),
    packages:    parseInt(props.getProperty('MAIL_COUNTER_PACKAGES')      || '0', 10),
    lastScan:    props.getProperty('MAIL_COUNTER_LAST_SCAN')     || null,
    lastScanRun: props.getProperty('MAIL_COUNTER_LAST_SCAN_RUN') || null,
    lastReset:   props.getProperty('MAIL_COUNTER_LAST_RESET')    || null,
  };
}

/**
 * Resets mail and package counters to 0.
 * Called when user clicks "Got the mail!" in the dashboard.
 * Does NOT clear MAIL_COUNTER_LAST_SCAN to avoid re-processing old emails.
 */
function resetMailCounter_() {
  var props = PropertiesService.getScriptProperties();
  props.setProperties({
    'MAIL_COUNTER_PIECES':      '0',
    'MAIL_COUNTER_PACKAGES':    '0',
    'MAIL_COUNTER_LAST_RESET':  new Date().toISOString(),
  });
  Logger.log('📬 Mail counter reset to 0.');
}
