// ============================================================
// VERA — Watchdog.js
// Detecting silence: jobs that stopped running, feeds that stopped producing
// ============================================================
//
// THE PROBLEM THIS SOLVES:
//   ApiHealth.js models "it failed" very well. It cannot model "it never ran."
//   getDegradedSources_ only returns sources with consecutiveFailures > 0, and a
//   trigger that Apps Script has disabled — after repeated failures, or an auth
//   expiry — records nothing at all. Its entry just sits there getting older,
//   invisible. An empty morning email looks the same whether it was a quiet
//   Tuesday or the collector died three weeks ago.
//
//   So this file adds the missing concept: EXPECTED CADENCE. Everything else —
//   the state map pattern, formatAge_, freshnessOf_ — is reused from ApiHealth.
//
// TWO KINDS OF SILENCE, DELIBERATELY NOT MERGED:
//
//   JOBS   — a trigger that should have fired. Silence means broken. Reported as
//            a failure, with tight windows.
//
//   FEEDS  — a source that should have produced something. Silence usually means
//            quiet: an empty inbox is not a bug. Reported as an observation,
//            with generous windows and softer wording.
//
//   Collapsing these would produce a surface that cries wolf about a working
//   system, and a warning nobody believes is worth less than no warning at all.
//
// A JOB HEARTBEAT MEANS "THE TRIGGER FIRED", NOT "IT DID WORK":
//   runEmailScan_ early-returns when email_parser_enabled is false (its default)
//   and checkFlightStatuses_ no-ops with no flights booked. Both still record.
//   Otherwise the watchdog would alarm permanently about correct behaviour.
// ============================================================

var HEARTBEAT_KEY_ = 'SYSTEM_HEARTBEATS';

// When setupTriggers last registered each handler. ONE property holding a map, the
// same shape as the heartbeats above, rather than eight properties — a trigger list
// that grows should not grow the property count with it.
var TRIGGER_REGISTRY_KEY_ = 'TRIGGER_REGISTRATIONS';

// Per-execution read cache, mirroring ApiHealth's _apiHealthCache_.
var _heartbeatCache_ = null;

/**
 * Jobs with an expected cadence, taken from the real trigger definitions in
 * setupTriggers() (Code.js). Windows carry headroom so a single missed or
 * slow run is not an incident.
 */
var HEARTBEAT_REGISTRY = [
  { job: 'nightlyRun',            label: 'Nightly run',          maxAgeHours: 26, startProp: 'LAST_NIGHTLY_START', stepProp: 'NIGHTLY_STEP' },
  // The night runs in two halves on two triggers, and each needs its own entry.
  // One shared heartbeat would let the first half's success report the whole night
  // healthy while the second died every night unseen — which is the failure the
  // split exists to fix, rebuilt one level up.
  { job: 'nightlyRunTail',        label: 'Nightly run (part 2)', maxAgeHours: 26, startProp: 'LAST_NIGHTLY_TAIL_START', stepProp: 'NIGHTLY_TAIL_STEP' },
  // The morning email was killed at the six-minute ceiling and this entry could only
  // say "has not run in 1d 2h" — the same sentence as a trigger that never fired. It
  // now carries the same start marker and breadcrumb as the nightly run, so
  // jobStartedAndDied_ can name the phase instead.
  { job: 'morningNudge',          label: 'Morning email',        maxAgeHours: 26, startProp: 'LAST_MORNING_START', stepProp: 'MORNING_STEP' },
  { job: 'hourlyCheck',           label: 'Hourly check',         maxAgeHours: 3  },
  { job: 'checkFlightStatuses_',  label: 'Flight status poll',   maxAgeHours: 2  },
  { job: 'runEmailScan_',         label: 'Travel email scan',    maxAgeHours: 3  },
  { job: 'scanUSPSMail_',         label: 'USPS mail scan',       maxAgeHours: 26, startProp: 'USPS_SCAN_START' },
  { job: 'scanHoaWebsite_',       label: 'HOA website scan',     maxAgeHours: 8 * 24 },
  // Delivery, not execution. morningNudge's own heartbeat says the trigger
  // fired; this one says the briefing actually reached you, which is the part
  // you would notice missing.
  // enabledKey: a briefing you switched OFF has correctly not gone out, and saying so
  // every morning forever is the false alarm this file's own header warns about. The
  // job heartbeat above still reports, so a disabled briefing is visible as "ran, sent
  // nothing" rather than vanishing from the watchdog entirely.
  { job: 'delivery:morning_briefing', label: 'Morning briefing', maxAgeHours: 26, verb: 'has not gone out in', enabledKey: 'morning_briefing' },
];

/**
 * Feeds that should produce something occasionally. Thresholds are intentionally
 * generous — these are "worth a look", not "broken".
 */
var FEED_REGISTRY = [
  { feed: 'gmail:travel-parser', label: 'Travel email parser', droughtDays: 21,
    hint: 'check the Gmail search query in EmailParser.js' },
  { feed: 'gmail:email-admin',   label: 'Email admin scan',    droughtDays: 14,
    hint: 'check the Gmail labels it reads' },
  { feed: 'gmail:usps',          label: 'USPS Informed Delivery', droughtDays: 7,
    hint: 'USPS may have changed their email format' },
  { feed: 'web:hoa',             label: 'HOA website scan',    droughtDays: 45,
    hint: 'the HOA page layout may have changed' },
];

// ---- State access -----------------------------------------------------------

/** Reads the heartbeat map, parsing the Script Property once per execution. */
function getHeartbeatState_() {
  if (_heartbeatCache_) return _heartbeatCache_;
  var raw = PropertiesService.getScriptProperties().getProperty(HEARTBEAT_KEY_) || '{}';
  try { _heartbeatCache_ = JSON.parse(raw); } catch (e) { _heartbeatCache_ = {}; }
  return _heartbeatCache_;
}

/** Persists the heartbeat map and refreshes the per-execution cache. */
function setHeartbeatState_(state) {
  _heartbeatCache_ = state;
  PropertiesService.getScriptProperties().setProperty(HEARTBEAT_KEY_, JSON.stringify(state));
}

/**
 * When each trigger handler was last registered by setupTriggers, as { job: ms }.
 *
 * Deliberately NOT cached per execution like the heartbeats: it is read once, by the
 * watchdog, and a cache would only add a way for it to be stale.
 *
 * @returns {Object} handler name → epoch ms. {} when nothing has been registered.
 */
function getTriggerRegistrations_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(TRIGGER_REGISTRY_KEY_) || '{}';
    var map = JSON.parse(raw);
    return (map && typeof map === 'object') ? map : {};
  } catch (e) {
    // Unparseable means "we do not know when these were registered", which has to read
    // as "not registered" — the alternative is treating corrupt state as evidence.
    Logger.log('getTriggerRegistrations_ failed, treating as empty: ' + e.message);
    return {};
  }
}

// ---- Recording --------------------------------------------------------------

/**
 * Records that a scheduled job ran. Call once at the end of every trigger entry
 * point, including the paths where the job deliberately did nothing.
 *
 * Never throws — instrumentation must not be able to break the thing it measures.
 *
 * @param {string} job  Entry point name, e.g. 'nightlyRun'
 */
function recordHeartbeat_(job) {
  try {
    var state = getHeartbeatState_();
    var entry = state[job] || {};
    entry.lastRun = Date.now();
    entry.runs    = (entry.runs || 0) + 1;
    state[job] = entry;
    setHeartbeatState_(state);
  } catch (e) {
    Logger.log('recordHeartbeat_ failed silently for "' + job + '": ' + e.message);
  }
}

/**
 * Records that setupTriggers registered these handlers, now.
 *
 * WHY THIS EXISTS. getOverdueJobs_ skips any job with no heartbeat, for a good reason
 * — on a fresh deploy nothing has recorded, and alarming on all eight would teach you
 * to ignore the alarm before it ever said anything true. But it left a job that has
 * NEVER run indistinguishable from a job that does not exist, so a trigger that
 * silently failed to register would go unreported every morning, forever. That is the
 * failure the two-half nightly split exists to end, rebuilt inside the watching.
 *
 * A registration timestamp is the missing evidence: past its own window with no
 * heartbeat, a registered job is overdue, while an unregistered one stays quiet.
 *
 * The whole map is REPLACED, not merged. setupTriggers deletes and recreates every
 * handler it owns, so a handler no longer in the list is no longer registered, and
 * carrying its old timestamp forward would have the watchdog waiting on a trigger that
 * is gone.
 *
 * @param {Array<string>} handlers  Handler names just registered
 */
function recordTriggerRegistrations_(handlers) {
  var now = Date.now();
  var map = {};
  (handlers || []).forEach(function(h) { map[h] = now; });
  PropertiesService.getScriptProperties()
    .setProperty(TRIGGER_REGISTRY_KEY_, JSON.stringify(map));
}

/**
 * Records that a feed ran and how much it produced.
 *
 * lastRun advances every time; lastProduced only when something was actually
 * found. That separation is the whole point — it is what distinguishes "the
 * scanner is broken" from "the inbox is empty", which today look identical
 * because both are logged as Success.
 *
 * @param {string} feed   Feed name from FEED_REGISTRY
 * @param {number} count  Items found this run (0 is meaningful, not a failure)
 */
function recordFeedResult_(feed, count) {
  try {
    var state = getHeartbeatState_();
    var entry = state[feed] || {};
    var now   = Date.now();
    entry.lastRun = now;
    if (count > 0) {
      entry.lastProduced = now;
      entry.lastCount    = count;
    }
    state[feed] = entry;
    setHeartbeatState_(state);
  } catch (e) {
    Logger.log('recordFeedResult_ failed silently for "' + feed + '": ' + e.message);
  }
}

// ---- Reads ------------------------------------------------------------------

/**
 * Did this job FIRE and die, rather than never fire at all?
 *
 * Those need different answers from you — one is a trigger problem, the other is the
 * code — and saying "has not run" for both sent an hour of one investigation down the
 * wrong path. A start marker later than the last heartbeat (or any start marker, when
 * there has never been a heartbeat) means the trigger IS firing and the run is being
 * killed partway.
 *
 * Extracted because the never-ran case needs the identical reasoning: a job registered
 * a week ago with a start marker and no heartbeat has been dying on its first run every
 * time, which is worth saying in those words.
 *
 * @param {Object} r            HEARTBEAT_REGISTRY entry — startProp/stepProp
 * @param {number} lastRunMs    last heartbeat, or 0 when there has never been one
 * @returns {?{diedAt: string}} null when it did not start, or we cannot tell
 */
function jobStartedAndDied_(r, lastRunMs) {
  if (!r.startProp) return null;
  try {
    var props      = PropertiesService.getScriptProperties();
    var startedRaw = props.getProperty(r.startProp);
    var startedAt  = startedRaw ? new Date(startedRaw).getTime() : 0;
    if (!startedAt || isNaN(startedAt)) return null;
    if (startedAt <= lastRunMs) return null;

    // WHERE it stopped, if the run left a breadcrumb. Telling you the run died was
    // already better than "has not run", but it still left the actual question open,
    // and a killed run takes its own log with it — this property is the only thing
    // that survives. Written as '<step>|<seconds elapsed>' by nightlyStep_ (Code.js).
    var diedAt = '';
    if (r.stepProp) {
      var crumb = props.getProperty(r.stepProp);
      if (crumb) {
        var bits = String(crumb).split('|');
        var secs = parseInt(bits[1], 10);
        diedAt = bits[0] + (isFinite(secs) ? ' (' + formatAge_(secs * 1000) + ' in)' : '');
      }
    }
    return { diedAt: diedAt };
  } catch (spErr) {
    return null;        // fall back to the plain wording
  }
}

/**
 * Jobs that have not run inside their expected window, worst first.
 *
 * A job with no heartbeat AND no registration is NOT overdue: on a fresh deploy
 * nothing has recorded yet, and alarming on all eight would teach you to ignore the
 * alarm before it ever said anything true.
 *
 * But "no heartbeat" alone used to be enough to skip a job, and that left a job which
 * has NEVER run indistinguishable from one that does not exist. nightlyRunTail sat in
 * exactly that state: no heartbeat, no start marker, and so nothing said each morning
 * whether its trigger had registered at all. A registration timestamp
 * (recordTriggerRegistrations_, written by setupTriggers) is the missing evidence —
 * past its own window with no heartbeat, a REGISTERED job is overdue.
 *
 * A JOB CANNOT REPORT ON ITSELF FROM INSIDE ITS OWN RUN, which is what `exclude` is
 * for. morningNudge runs the watchdog as one of its phases, roughly 250 lines before it
 * records either of its own heartbeats — so the watchdog looked at the morning email
 * mid-flight, saw a start marker seconds old against a heartbeat from the last
 * SUCCESSFUL run, and reported it exactly as designed:
 *
 *   Morning briefing has not gone out in 1d 23h
 *   Morning email started but did not finish — died during runWatchdog_
 *
 * …inside the morning email, naming the phase that was asking. Both true of the past
 * and absurd where they were printed. It surfaces only on the morning after a failure,
 * because on a normal day the delivery marker is ~24h old and inside its 26h window —
 * so it appears on precisely the morning the banner most needs to be readable.
 *
 * Excluding here rather than at the renderer covers all three surfaces at once: the
 * same notices object feeds the email lines, syncWatchdogFlags_ (which was opening a
 * High flag saying this) and announceWatchdogToSlack_.
 *
 * No coverage is lost. hourlyCheck runs the watchdog every hour WITHOUT an exclusion,
 * so these jobs stay watched — just not by themselves. The same reasoning as the
 * comment at its call site: if a job is the thing that died, it cannot be the thing
 * that notices.
 *
 * @param {Array<string>=} exclude  job names to skip — the caller's own, when it is a
 *                                  tracked job running the watchdog as part of itself
 * @returns {Array<Object>} { job, label, verb, diedAt, lastRun, ageMs, ageText, … }
 */
function getOverdueJobs_(exclude) {
  var state         = getHeartbeatState_();
  var registrations = getTriggerRegistrations_();
  var now           = Date.now();
  var out           = [];
  var skip          = {};
  (exclude || []).forEach(function(j) { skip[j] = true; });

  HEARTBEAT_REGISTRY.forEach(function(r) {
    // Running right now, and asking about itself. Its heartbeat is written at the end.
    if (skip[r.job]) return;

    // A feature deliberately switched off is not an outage. Checked before anything
    // else so a disabled notification cannot alarm at all, however old its marker.
    if (r.enabledKey) {
      try {
        if (!isNotifEnabled_(r.enabledKey)) return;
      } catch (enErr) {
        // Cannot tell whether it is enabled — report rather than assume silence.
        Logger.log('getOverdueJobs_: enabledKey check failed for ' + r.job + ' — ' + enErr.message);
      }
    }

    var entry    = state[r.job];
    var windowMs = r.maxAgeHours * 3600000;
    var lastRun  = (entry && entry.lastRun) ? entry.lastRun : 0;

    // verb goes BEFORE the age and suffix after it, so every wording reads as one
    // sentence once the consumer joins them: "<label> <verb> <ageText> <suffix>".
    var verb, suffix = '', ageMs, died;

    if (!lastRun) {
      // NEVER RECORDED. Only a registration makes this reportable — without one we
      // genuinely do not know the job was ever meant to run, and that is the
      // fresh-deploy case this stays quiet for.
      var registeredAt = registrations[r.job];
      if (!registeredAt) return;
      ageMs = now - registeredAt;
      if (ageMs <= windowMs) return;          // registered, but not due yet

      died = jobStartedAndDied_(r, 0);
      if (died) {
        verb   = 'has started but never finished in the';
        suffix = 'since it was registered';
      } else {
        verb   = 'has not run in the';
        // The actionable half: no heartbeat and no start marker since registration
        // means the trigger itself is the suspect, not the code inside it.
        suffix = 'since it was registered — the trigger may not exist';
      }
    } else {
      ageMs = now - lastRun;
      if (ageMs <= windowMs) return;
      died = jobStartedAndDied_(r, lastRun);
      verb = died ? 'started but did not finish; last completed run was'
                  : (r.verb || 'has not run in');
    }

    out.push({
      job:         r.job,
      label:       r.label,
      verb:        verb,
      suffix:      suffix,
      diedAt:      died ? died.diedAt : '',
      lastRun:     lastRun,
      neverRan:    !lastRun,
      ageMs:       ageMs,
      ageText:     formatAge_(ageMs),
      maxAgeHours: r.maxAgeHours,
      overdueBy:   ageMs / windowMs,
    });
  });

  // Ranked by how far past its OWN window each job is, not by raw age. Sorting
  // on age alone would put a daily job above a 15-minute one almost every time
  // purely because its window is bigger — a flight poller three hours into a
  // two-hour window is plainly dead, while a nightly run an hour past 26 hours
  // may just have been slow.
  out.sort(function(a, b) { return b.overdueBy - a.overdueBy; });
  return out;
}

/**
 * Feeds that are running but have found nothing for longer than their drought
 * window, driest first.
 *
 * Reported only when the feed IS running. A feed that has stopped running
 * altogether is a job failure and getOverdueJobs_ already says so — saying it
 * twice, in two different vocabularies, is how a warning surface loses its
 * credibility.
 *
 * @returns {Array<Object>} { feed, label, hint, ageText, droughtDays, everProduced }
 */
function getSilentFeeds_() {
  var state = getHeartbeatState_();
  var now   = Date.now();
  var out   = [];

  FEED_REGISTRY.forEach(function(r) {
    var entry = state[r.feed];
    if (!entry || !entry.lastRun) return;                    // never recorded

    // Only speak up about feeds that are actually running. "Ran recently" means
    // within its own drought window — a feed idle longer than that is the job
    // watchdog's story, not this one's.
    var runAge = now - entry.lastRun;
    if (runAge > r.droughtDays * 86400000) return;

    var since = entry.lastProduced || entry.firstSeen || entry.lastRun;
    var dryMs = now - since;
    if (dryMs <= r.droughtDays * 86400000) return;

    out.push({
      feed:         r.feed,
      label:        r.label,
      hint:         r.hint || '',
      ageText:      formatAge_(dryMs),
      ageMs:        dryMs,
      droughtDays:  r.droughtDays,
      everProduced: !!entry.lastProduced,
    });
  });

  out.sort(function(a, b) { return b.ageMs - a.ageMs; });
  return out;
}

/**
 * Everything the watchdog currently has to say, as plain lines.
 * Shared by all three delivery channels so they cannot drift apart.
 *
 * @returns {Object} { jobs: [...], feeds: [...], lines: [...], hasAlerts: boolean }
 */
function getWatchdogNotices_(exclude) {
  var jobs  = getOverdueJobs_(exclude);
  var feeds = getSilentFeeds_();
  var lines = [];

  jobs.forEach(function(j) {
    lines.push(j.label + ' ' + j.verb + ' ' + j.ageText +
               (j.suffix ? ' ' + j.suffix : '') +
               (j.diedAt ? ' \u2014 died during ' + j.diedAt : '') +
               ' (expected every ' + describeHours_(j.maxAgeHours) + ')');
  });

  feeds.forEach(function(f) {
    lines.push(f.label + ' has found nothing in ' + f.ageText +
               (f.hint ? ' — ' + f.hint : ''));
  });

  return { jobs: jobs, feeds: feeds, lines: lines, hasAlerts: lines.length > 0 };
}

/** '26 hours' / '8 days' — for the "expected every X" clause. */
function describeHours_(hours) {
  if (hours < 48) return hours + ' hour' + (hours === 1 ? '' : 's');
  var days = Math.round(hours / 24);
  return days + ' day' + (days === 1 ? '' : 's');
}

// ---- Delivery ---------------------------------------------------------------
//
// Three independent channels, each its own NOTIF_REGISTRY toggle, so the modal
// gives all three, any one, or none. Redundancy is the point: the failure being
// reported may well be the channel that would report it.

var WATCHDOG_FLAG_SOURCE_ = 'System';
var WATCHDOG_FLAG_PREFIX_ = 'watchdog_';

// Slack is checked hourly but must not repeat itself hourly. Post when the set
// of problems CHANGES, or once every 12 hours while it persists — the same
// transition-plus-cooldown shape ApiHealth uses, and for the same reason: an
// alert that repeats every hour stops being read by the second day.
var WATCHDOG_SLACK_STATE_KEY_ = 'WATCHDOG_LAST_SLACK';
var WATCHDOG_SLACK_COOLDOWN_MS_ = 12 * 60 * 60 * 1000;

/**
 * Runs the checks and delivers whatever they found.
 * Called from morningNudge and hourlyCheck — deliberately different triggers
 * from nightlyRun, which is the one most likely to be the thing that died.
 *
 * @param {Array<string>=} exclude  jobs the CALLER is, when the caller is itself
 *                                  tracked. morningNudge runs this as one of its own
 *                                  phases and must pass its own names, or it reports
 *                                  itself dead in the email it is in the middle of
 *                                  sending. See getOverdueJobs_.
 * @returns {Object} the notices, so callers can render them inline too
 */
function runWatchdog_(exclude) {
  var notices = getWatchdogNotices_(exclude);

  // A job overdue because its trigger is gone gets the trigger back. Done before the
  // flag and Slack so both can say so.
  try {
    var put = repairMissingTriggers_(notices.jobs);
    notices.jobs.forEach(function(j, i) {
      if (put.indexOf(j.job) !== -1) notices.lines[i] += ' \u2014 its trigger was missing, so VERA put it back';
    });
  } catch (e) { Logger.log('runWatchdog_: trigger repair error — ' + e.message); }

  try { syncWatchdogFlags_(notices); }
  catch (e) { Logger.log('runWatchdog_: flag sync error — ' + e.message); }

  try { announceWatchdogToSlack_(notices); }
  catch (e) { Logger.log('runWatchdog_: slack error — ' + e.message); }

  return notices;
}

/** Posts to #vera-logs on change, or after the cooldown while still broken. */
function announceWatchdogToSlack_(notices) {
  if (!isNotifEnabled_('watchdog_slack')) return;

  var props     = PropertiesService.getScriptProperties();
  var signature = notices.lines.join('|');
  var prev      = {};
  try { prev = JSON.parse(props.getProperty(WATCHDOG_SLACK_STATE_KEY_) || '{}'); } catch (e) {}

  if (!notices.hasAlerts) {
    // Recovered — say so once, then go quiet.
    if (prev.signature) {
      sendSlackLog_('✅ *Watchdog* — everything is back inside its expected window.');
      props.deleteProperty(WATCHDOG_SLACK_STATE_KEY_);
    }
    return;
  }

  var changed = prev.signature !== signature;
  var stale   = !prev.at || (Date.now() - prev.at) > WATCHDOG_SLACK_COOLDOWN_MS_;
  if (!changed && !stale) return;

  sendSlackLog_('🔕 *Watchdog* — VERA has gone quiet somewhere:\n' +
    notices.lines.map(function(l) { return '• ' + l; }).join('\n'));

  props.setProperty(WATCHDOG_SLACK_STATE_KEY_,
    JSON.stringify({ signature: signature, at: Date.now() }));
}

/**
 * Brings the Flags tab in line with what is currently wrong: opens a flag for
 * each new problem, refreshes the ones still true, resolves the ones that have
 * recovered.
 *
 * This writes rows directly rather than going through writeFlags() on purpose.
 * writeFlags dedups against every flag ever written INCLUDING resolved ones
 * (getExistingFlagFingerprints_), and keysAreSimilar_ strips digits, so any
 * stable or dated key would fire exactly once in VERA's lifetime and stay silent
 * the next time the same job died. "Never tell me the same thing twice" is right
 * for a bill reminder and wrong for a health check.
 */
function syncWatchdogFlags_(notices) {
  if (!isNotifEnabled_('watchdog_flag')) return;

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.FLAGS);
  if (!sheet) return;

  var tz      = Session.getScriptTimeZone();
  var now     = new Date();
  var dateStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  var lastRow = sheet.getLastRow();
  var rows    = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, FLAG_HEADERS.length).getValues()
    : [];
  var rowOf = function(key) {
    for (var i = 0; i < rows.length; i++) if (String(rows[i][9] || '').trim() === key) return i;
    return -1;
  };
  var isResolved = function(i) { return String(rows[i][8] || '').trim().toLowerCase() === 'yes'; };
  var appended = 0;
  var append = function(key, flag, reason, urgency) {
    var rand2 = String(Math.floor(Math.random() * 90) + 10);
    var row = ['FLAG-' + dateStr.replace(/-/g, '') + '-' + rand2, dateStr, WATCHDOG_FLAG_SOURCE_,
               flag, reason, urgency, 'No', '', 'No', key, ''];
    sheet.appendRow(row);
    rows.push(row);
    appended++;
  };

  // ---- JOBS: one flag per incident, and one "restored" on the first good run ----
  //
  // A job that goes overdue opens an INCIDENT with its own key, stamped with when it
  // was first seen. The flag is kept up to date while the job stays down. On the
  // first check after it is back inside its window, that flag is resolved and ONE
  // Low "restored" flag plus one System Log row record the recovery; the incident is
  // then closed, so every later good run says nothing. A new failure opens a new
  // incident — Monday's flag is never rewritten by Thursday's.
  var incidents = getWatchdogIncidents_();
  var jobsDown  = {};
  notices.jobs.forEach(function(j) { jobsDown[j.job] = j; });

  // Flags raised before incidents existed carry the bare key watchdog_<job>. An open
  // one is adopted as that job's incident, so its recovery is still logged.
  HEARTBEAT_REGISTRY.forEach(function(r) {
    if (incidents[r.job]) return;
    var i = rowOf(WATCHDOG_FLAG_PREFIX_ + watchdogSlug_(r.job));
    if (i !== -1 && !isResolved(i)) {
      var opened = rows[i][1] instanceof Date ? rows[i][1] : new Date(String(rows[i][1]) + 'T12:00:00');
      incidents[r.job] = { key: String(rows[i][9]).trim(), openedAt: isNaN(opened) ? now.getTime() : opened.getTime() };
    }
  });

  notices.jobs.forEach(function(j) {
    var flag = j.label + ' ' + j.verb + ' ' + j.ageText +
               (j.suffix ? ' ' + j.suffix : '') +
               (j.diedAt ? ' \u2014 died during ' + j.diedAt : '');
    var reason = 'Expected every ' + describeHours_(j.maxAgeHours) + '. ' +
               // lastRun is 0 for a job that has NEVER run, and formatting that gives
               // "Dec 31, 7:00 PM" — 1969, stated as fact. The flag has to say it has
               // never run, which is also the more useful thing to read.
               (j.neverRan
                 ? 'It has never run since being registered.'
                 : 'Last run ' + Utilities.formatDate(new Date(j.lastRun), tz, 'MMM d, h:mm a') + '.') +
               (j.repaired
                 ? ' Its trigger was missing, so VERA put it back; it should run at its next time.'
                 : ' Check the Apps Script trigger — Google disables triggers after repeated failures.');
    var inc = incidents[j.job];
    if (!inc) {
      // A new incident never reuses an earlier one's key, even within the same minute.
      var base = WATCHDOG_FLAG_PREFIX_ + watchdogSlug_(j.job) + '__' + Utilities.formatDate(now, tz, 'yyyyMMddHHmm');
      var key = base, n = 1;
      while (rowOf(key) !== -1) key = base + '-' + (++n);
      inc = incidents[j.job] = { key: key, openedAt: now.getTime() };
    }
    var i = rowOf(inc.key);
    if (i === -1) { append(inc.key, flag, reason, 'High'); return; }
    // Only rewrite when the wording actually moved on. This runs hourly. A flag you
    // resolved yourself while the job was still down stays resolved.
    if (String(rows[i][3]) !== flag) sheet.getRange(i + 2, 4).setValue(flag);
    if (String(rows[i][4]) !== reason) sheet.getRange(i + 2, 5).setValue(reason);
  });

  Object.keys(incidents).forEach(function(job) {
    if (jobsDown[job]) return;
    var inc = incidents[job];
    var reg = HEARTBEAT_REGISTRY.filter(function(r) { return r.job === job; })[0];
    var label = reg ? reg.label : job;
    var i = rowOf(inc.key);
    if (i !== -1 && !isResolved(i)) sheet.getRange(i + 2, 9).setValue('Yes');
    var hb = getHeartbeatState_()[job] || {};
    var text = watchdogRestoredText_(label, hb.lastRun || now.getTime(), inc.openedAt, tz);
    var stamp = inc.key.indexOf('__') !== -1 ? inc.key.slice(inc.key.indexOf('__') + 2)
                                              : Utilities.formatDate(new Date(inc.openedAt), tz, 'yyyyMMddHHmm');
    var restoredKey = WATCHDOG_RESTORED_PREFIX_ + watchdogSlug_(job) + '__' + stamp;
    if (rowOf(restoredKey) === -1) {
      append(restoredKey, text, 'Logged once, on the first good run after the failure. Later good runs add nothing.', 'Low');
      try { veraLog_('watchdog', 'System', 'Success', text); } catch (e) {}
    }
    delete incidents[job];
  });
  setWatchdogIncidents_(incidents);

  // ---- FEEDS: unchanged — one flag per feed, reopened if the drought returns ----
  var feedKeys = {};
  FEED_REGISTRY.forEach(function(r) { feedKeys[WATCHDOG_FLAG_PREFIX_ + watchdogSlug_(r.feed)] = true; });
  var wanted = {};
  notices.feeds.forEach(function(f) {
    wanted[WATCHDOG_FLAG_PREFIX_ + watchdogSlug_(f.feed)] = {
      flag:    f.label + ' has found nothing in ' + f.ageText,
      reason:  'It is still running, so this may simply be quiet — but ' + f.droughtDays +
               ' days is long enough to be worth checking' + (f.hint ? ': ' + f.hint : '') + '.',
      urgency: 'Medium',
    };
  });
  Object.keys(feedKeys).forEach(function(key) {
    var i = rowOf(key);
    if (i === -1) {
      if (wanted[key]) append(key, wanted[key].flag, wanted[key].reason, wanted[key].urgency);
      return;
    }
    var rowNum = i + 2;
    if (wanted[key]) {
      if (isResolved(i)) {
        // Recurrence of a drought that was previously over — reopen it.
        sheet.getRange(rowNum, 9).setValue('No');
        sheet.getRange(rowNum, 7).setValue('No');
        sheet.getRange(rowNum, 2).setValue(dateStr);
        sheet.getRange(rowNum, 11).setValue('');
      }
      if (String(rows[i][3]) !== wanted[key].flag) sheet.getRange(rowNum, 4).setValue(wanted[key].flag);
      if (String(rows[i][4]) !== wanted[key].reason) sheet.getRange(rowNum, 5).setValue(wanted[key].reason);
    } else if (!isResolved(i)) {
      sheet.getRange(rowNum, 9).setValue('Yes');
      Logger.log('syncWatchdogFlags_: auto-resolved ' + key + ' (recovered)');
    }
  });

  if (appended > 0) {
    try { colorCodeFlags(sheet); } catch (e) {}
    Logger.log('syncWatchdogFlags_: wrote ' + appended + ' watchdog flag(s)');
  }
}

/**
 * Recreates the trigger of each overdue job that VERA schedules (veraTriggerSpecs_,
 * Code.js) and that has no trigger at all, exactly as setupTriggers would. It never
 * deletes a trigger and never adds a second one; a job whose trigger exists but does
 * not fire is left to the flag. Marks each repaired job `repaired: true` and adds it to
 * the registrations, keeping the others.
 *
 * @param {Array<Object>} jobs  getOverdueJobs_ output
 * @returns {Array<string>} the handlers it recreated
 */
function repairMissingTriggers_(jobs) {
  if (!jobs || !jobs.length) return [];
  var specs = veraTriggerSpecs_(), have = {}, made = [];
  ScriptApp.getProjectTriggers().forEach(function(t) { have[t.getHandlerFunction()] = true; });
  jobs.forEach(function(j) {
    if (have[j.job]) return;
    var s = specs.filter(function(x) { return x.handler === j.job; })[0];
    if (!s) return;
    try {
      s.build(ScriptApp.newTrigger(s.handler).timeBased()).create();
      have[j.job] = true;
      j.repaired = true;
      made.push(j.job);
    } catch (e) {
      Logger.log('repairMissingTriggers_: could not recreate ' + j.job + ' — ' + e.message);
    }
  });
  if (made.length) {
    var map = getTriggerRegistrations_(), now = Date.now();
    made.forEach(function(h) { map[h] = now; });
    PropertiesService.getScriptProperties().setProperty(TRIGGER_REGISTRY_KEY_, JSON.stringify(map));
    try { veraLog_('watchdog', 'System', 'Success', 'Recreated missing trigger(s): ' + made.join(', ')); } catch (lgErr) {}
  }
  return made;
}

// ---- Incidents ---------------------------------------------------------------

var WATCHDOG_INCIDENTS_KEY_    = 'WATCHDOG_INCIDENTS';
var WATCHDOG_RESTORED_PREFIX_  = 'watchdog_restored_';

/** 'checkFlightStatuses_' → 'checkflightstatuses' — the key fragment for a job or feed. */
function watchdogSlug_(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The open incident per job, { job: { key, openedAt } }. */
function getWatchdogIncidents_() {
  try {
    var map = JSON.parse(PropertiesService.getScriptProperties().getProperty(WATCHDOG_INCIDENTS_KEY_) || '{}');
    return map && typeof map === 'object' ? map : {};
  } catch (e) { return {}; }
}

function setWatchdogIncidents_(map) {
  PropertiesService.getScriptProperties().setProperty(WATCHDOG_INCIDENTS_KEY_, JSON.stringify(map || {}));
}

/** "Nightly run restored — first good run Wed Oct 22, 11:31 PM, after the failure flagged Tue Oct 21." */
function watchdogRestoredText_(label, lastRunMs, openedAtMs, tz) {
  return label + ' restored \u2014 first good run ' +
    Utilities.formatDate(new Date(lastRunMs), tz, 'EEE MMM d, h:mm a') +
    ', after the failure flagged ' + Utilities.formatDate(new Date(openedAtMs), tz, 'EEE MMM d') + '.';
}

// ---- Debug helper (run manually from the Apps Script editor) ----------------

/** Prints heartbeats, droughts and degraded API sources side by side. */
function debugSystemHealth() {
  var state = getHeartbeatState_();
  var tz    = Session.getScriptTimeZone();

  function stamp(ms) {
    return ms ? Utilities.formatDate(new Date(ms), tz, 'MM/dd HH:mm') + ' (' + formatAge_(Date.now() - ms) + ' ago)'
              : 'never';
  }

  Logger.log('=== VERA System Health ===');

  Logger.log('\n-- Jobs --');
  HEARTBEAT_REGISTRY.forEach(function(r) {
    var e = state[r.job] || {};
    var overdue = e.lastRun && (Date.now() - e.lastRun) > r.maxAgeHours * 3600000;
    Logger.log((overdue ? '  OVERDUE  ' : '  ok       ') + r.job +
               ' — last run ' + stamp(e.lastRun) +
               ' — expected every ' + describeHours_(r.maxAgeHours));
  });

  Logger.log('\n-- Feeds --');
  FEED_REGISTRY.forEach(function(r) {
    var e = state[r.feed] || {};
    Logger.log('  ' + r.feed +
               ' — last run ' + stamp(e.lastRun) +
               ' — last produced ' + stamp(e.lastProduced) +
               ' — drought window ' + r.droughtDays + 'd');
  });

  Logger.log('\n-- Degraded API sources --');
  var degraded = getDegradedSources_();
  if (!degraded.length) Logger.log('  (none)');
  degraded.forEach(function(d) {
    Logger.log('  ' + d.source + ' — ' + d.consecutiveFailures + ' consecutive failure(s), last good ' + d.staleForText);
  });

  Logger.log('\n-- Watchdog would report --');
  var notices = getWatchdogNotices_();
  if (!notices.hasAlerts) Logger.log('  (nothing — everything inside its window)');
  notices.lines.forEach(function(l) { Logger.log('  • ' + l); });
}
