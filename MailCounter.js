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
//   MAIL_COUNTER_PACKAGES      — integer string, running total of packages that
//                                actually arrived (see parsePackagesArrivingToday_)
//   MAIL_COUNTER_LAST_SCAN     — ISO timestamp of newest email already processed
//   MAIL_COUNTER_LAST_SCAN_RUN — ISO timestamp of when scan last ran
//   MAIL_COUNTER_LAST_RESET    — ISO timestamp of last user reset
// ============================================================

/**
 * Pulls the "arriving today" package count out of a USPS Daily Digest body.
 *
 * The digest's headline figure — "You have 1 mailpiece(s) and 2 inbound
 * package(s) arriving soon" — counts every package USPS knows about, including
 * ones the sender has only just printed a label for. Those keep reappearing in
 * every digest until they actually turn up, so adding the headline number each
 * day counts the same package over and over and the counter balloons.
 *
 * The body breaks packages into buckets, e.g.:
 *
 *   PACKAGES
 *     Expected Today        1 item(s)   FROM: WACOAL AMERICA INC
 *     Expected 1-2 Days     0 item(s)
 *     Awaiting From Sender  1 item(s)   FROM: SHIPPO
 *     Outbound              0 item(s)
 *
 * Only "Expected Today" is actually landing in the mailbox today, so that is
 * the only bucket that should be added to the running total. (Above, the
 * headline says 2 but only 1 is really arriving.)
 *
 * The MAIL section has its own "Expected Today" bucket, so this anchors to the
 * PACKAGES heading first to avoid picking up the mailpiece count.
 *
 * @param {string} body  Digest body with HTML tags already stripped.
 * @return {number} Packages arriving today; 0 if the section isn't present.
 */
function parsePackagesArrivingToday_(body) {
  var idx = (body || '').search(/\bPACKAGES\b/i);
  if (idx === -1) return 0;
  var match = body.slice(idx).match(/Expected\s+Today\s+(\d+)\s+item/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Scans Gmail for USPS Informed Delivery emails and increments counters.
 * Both counters accumulate until the user hits "Got the mail!" — packages
 * count only what arrives each day, not everything in transit.
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

        // HTML body has the actual counts; plain text is just a stub with no numbers
        var body = msg.getBody().replace(/<[^>]+>/g, ' ') || msg.getPlainBody();
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
        // Only the ones actually landing today; see parsePackagesArrivingToday_
        // for why the headline "N inbound package(s)" figure can't be used.
        pkgDelta += parsePackagesArrivingToday_(body);

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
