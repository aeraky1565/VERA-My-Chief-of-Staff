// ============================================================
// MorningEmail.js — the morning email's layout (docs/mockups/notifications.html, #250)
// ============================================================
//
//   Subject: ☀️ Tuesday, Nov 17: 2 things need you today
//   [weather ticker, as before]
//   Good morning, Ahmed.
//   NEEDS YOU TODAY   High · Car registration expires Friday · Vehicles
//                     Due  · Electric bill, $142, due today · Bills
//   📆 YOUR DAY, SEQUENCED   (as before)
//   THIS WEEK         Water bill $48 · Thu · Bills
//   HELD OVERNIGHT    🎟️ Coupon ends tomorrow (arrived in quiet hours) · 9:40 PM
//   ALSO              📬 2 pieces of mail arriving today · USPS
//   [Open Needs you in VERA]
//   Everything in this email stays quiet in Slack today. …
//
// morningNudge (Code.js) gathers the facts; everything here is pure, so the layout is
// tested and previewed without sending anything.

var ME_FLAG_AREAS_ = [
  ['Finances', /financ|budget|bill|tax|card|perk|coupon|contract|net worth|subscri|hsa|fsa|bank|purchase|money/i],
  ['Vehicles', /vehicle/i], ['Home', /chore|warrant|meal|pantry|hoa|home|kitchen|neighbo|guest/i],
  ['Travel', /travel|trip|aria|flight|pto/i], ['Health', /health|fitness|gym|family planning|prescri|medic|appoint/i],
  ['Career', /career|job/i], ['Projects', /project/i], ['People', /gift|important date|birthday|people|wish/i],
  ['Life', /experiment|pattern|monthly review|pacing|memory|summar|goal|habit|growth/i], ['System', /system|watchdog|agent|api/i]];

/** Pure: a flag's area from its Source, as the dashboard groups them. */
function meArea_(source) {
  for (var i = 0; i < ME_FLAG_AREAS_.length; i++) if (ME_FLAG_AREAS_[i][1].test(String(source || ''))) return ME_FLAG_AREAS_[i][0];
  return 'Other';
}
/** Pure: "Thu" for a date. */
function meWeekday_(d) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d).getDay()]; }
/** Pure: "Tuesday, Nov 17". */
function meDateLabel_(d) {
  d = new Date(d);
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()] + ', ' +
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getDate();
}
/** Pure: the subject line. */
function meSubject_(dateLabel, needCount) {
  return '☀️ ' + dateLabel + ': ' + (needCount ? needCount + ' thing' + (needCount === 1 ? ' needs' : 's need') + ' you today' : 'nothing needs you today');
}

/**
 * Pure: the flags, sorted into the email's sections. rows: Flags rows (FLAG_HEADERS) already
 * filtered to active. High flags and anything Due today lead (Needs you today); a flag due in
 * the next 7 days goes in This week; the rest are counted for a line under Also.
 * → {needs:[], week:[], more:n}
 */
function meFlagItems_(rows, todayIso) {
  var out = { needs: [], week: [], more: 0 };
  var t0 = new Date(todayIso + 'T12:00:00').getTime();
  (rows || []).forEach(function(r) {
    var text = String(r[3] || '').trim(); if (!text) return;
    var due = r[11] instanceof Date ? r[11].toISOString().slice(0, 10) : String(r[11] || '').slice(0, 10);
    var days = /^\d{4}-\d{2}-\d{2}$/.test(due) ? Math.round((new Date(due + 'T12:00:00').getTime() - t0) / 86400000) : null;
    var area = meArea_(r[2]);
    if (r[5] === 'High') out.needs.push({ chip: 'High', text: text, area: area });
    else if (days !== null && days <= 0) out.needs.push({ chip: days < 0 ? 'Overdue' : 'Due', text: text, area: area });
    else if (days !== null && days <= 7) out.week.push({ text: text, when: meWeekday_(due + 'T12:00:00'), area: area, days: days });
    else out.more++;
  });
  return out;
}

/** Pure: what waited for this email, split: pushed-but-held (quiet hours, the cap) vs. its home is the email. */
function meHeldSplit_(list) {
  var out = { overnight: [], also: [] };
  (list || []).forEach(function(x) { (x.why === 'quiet' || x.why === 'cap' ? out.overnight : out.also).push(x); });
  return out;
}

var ME_CHIP_ = { High: ['#fdecea', '#c62828'], Due: ['#fff4e0', '#b25e00'], Overdue: ['#fdecea', '#c62828'] };

/**
 * Pure: the email. d: {name, dateLabel, weatherHtml, welcomeHtml, welcomeText, needs:[{chip,text,area}],
 * dayPlanHtml, todayEvents:[{time,title}], week:[{text,when,area}], overnight:[{label,text,at,why}],
 * also:[{label,text}], moreFlags, ptoHtml, ptoText, staleHtml, staleText, dashboardUrl}
 * → {subject, html, text}
 */
function meRender_(d) {
  var esc = function(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var head = function(t) { return '<p style="margin:26px 0 10px;font-size:11px;font-weight:700;color:#0d1b3e;letter-spacing:1px;text-transform:uppercase;">' + t + '</p>'; };
  var right = function(t) { return '<td style="padding:7px 0 7px 10px;border-top:1px solid #f0f0f5;font-size:12px;color:#8a93a6;text-align:right;white-space:nowrap;vertical-align:top;">' + (t ? esc(t) : '') + '</td>'; };
  var cell = 'padding:7px 0;border-top:1px solid #f0f0f5;font-size:14px;color:#333333;line-height:1.45;vertical-align:top;';
  // A chip or a time gets its own column, so a long item wraps beside it, not under it.
  var row = function(lead, body, tail) {
    return '<tr>' + (lead ? '<td style="' + cell + 'width:1%;white-space:nowrap;padding-right:10px;">' + lead + '</td>' : '') +
      '<td style="' + cell + '"' + (lead ? '' : ' colspan="2"') + '>' + body + '</td>' + right(tail) + '</tr>';
  };
  var table = function(rows) { return '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' + rows.join('') + '</table>'; };
  var chip = function(c) {
    var k = ME_CHIP_[c] || ['#eef1f7', '#3d4a66'];
    return '<span style="display:inline-block;min-width:52px;text-align:center;background:' + k[0] + ';color:' + k[1] + ';font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">' + esc(c) + '</span>';
  };
  var needs = d.needs || [], week = (d.week || []).slice().sort(function(a, b) { return (a.days == null ? 99 : a.days) - (b.days == null ? 99 : b.days); });
  var overnight = d.overnight || [], also = (d.also || []).slice();
  if (d.moreFlags) also.push({ label: '🚩', text: d.moreFlags + ' more flag' + (d.moreFlags === 1 ? '' : 's') + ' on the Flags screen' });
  var subject = meSubject_(d.dateLabel, needs.length);

  var body = '<p style="margin:0 0 4px;font-size:17px;font-weight:600;color:#0d1b3e;">Good morning, ' + esc(d.name || 'Ahmed') + '.</p>' +
    '<p style="margin:0;font-size:15px;color:#555555;">' + (needs.length ? needs.length + ' thing' + (needs.length === 1 ? ' needs' : 's need') + ' you today.' : 'Nothing needs you today.') + '</p>';
  if (d.welcomeHtml) body += '<p style="margin:16px 0 8px;font-size:15px;color:#555555;">Welcome home. Here’s what piled up.</p>' + d.welcomeHtml;
  if (needs.length) body += head('Needs you today') + table(needs.map(function(x) { return row(chip(x.chip), esc(x.text), x.area); }));
  if (d.dayPlanHtml) body += d.dayPlanHtml;
  else if ((d.todayEvents || []).length) body += head('📆 Today') + table(d.todayEvents.map(function(e) { return row('<span style="color:#8a93a6;font-size:13px;">' + esc(e.time) + '</span>', esc(e.title), ''); }));
  if (week.length) body += head('This week') + table(week.map(function(x) { return row('', esc(x.text) + (x.when ? ' <span style="color:#8a93a6;">· ' + esc(x.when) + '</span>' : ''), x.area); }));
  if (d.ptoHtml) body += d.ptoHtml;
  if (overnight.length) body += head('Held overnight') + table(overnight.map(function(x) {
    return row('', esc((x.label ? x.label + ' ' : '') + x.text) + ' <span style="color:#8a93a6;">(' + (x.why === 'cap' ? 'past today’s ' + 'push limit' : 'arrived in quiet hours') + ')</span>', x.at || '');
  }));
  if (also.length) body += head('Also') + table(also.map(function(x) { return row('', esc((x.label ? x.label + ' ' : '') + x.text), x.area || ''); }));
  if (d.staleHtml) body += d.staleHtml;
  if (d.dashboardUrl) body += '<p style="margin:28px 0 0;"><a href="' + esc(d.dashboardUrl) + '" style="display:inline-block;background:#0d1b3e;color:#c9a84c;font-size:14px;font-weight:700;letter-spacing:0.5px;padding:12px 26px;border-radius:6px;text-decoration:none;border:2px solid #c9a84c;">Open Needs you in VERA &rarr;</a></p>';
  body += '<p style="margin:22px 0 0;font-size:12px;color:#8a93a6;line-height:1.5;">Everything in this email stays quiet in Slack today. High flags found overnight lead the email; only a high flag raised during the day is pushed.</p>';

  var html = '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f0f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f5;padding:24px 0;"><tr><td align="center" style="padding:0 8px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);">' +
    (d.logoTag ? '<tr><td style="padding:0;background:#0d1b3e;">' + d.logoTag + '</td></tr>'
      : '<tr><td style="padding:20px 40px;background:#0d1b3e;text-align:center;"><span style="color:#ffffff;font-size:26px;font-weight:bold;letter-spacing:4px;">VERA</span></td></tr>') +
    (d.weatherHtml || '') +
    '<tr><td style="padding:28px 24px 26px;">' + body + '</td></tr>' +
    '<tr><td style="padding:14px 40px;background:#f7f7fa;border-top:1px solid #eeeeee;"><p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">Sent by VERA &mdash; Virtual Executive &amp; Reminder Assistant</p></td></tr>' +
    '</table></td></tr></table></body></html>';

  var lines = ['Good morning, ' + (d.name || 'Ahmed') + '.', needs.length ? needs.length + ' thing' + (needs.length === 1 ? ' needs' : 's need') + ' you today.' : 'Nothing needs you today.'];
  if (d.welcomeText) lines.push('', d.welcomeText);
  var sect = function(t, items, fmt) { if (items.length) { lines.push('', t.toUpperCase()); items.forEach(function(x) { lines.push('  ' + fmt(x)); }); } };
  sect('Needs you today', needs, function(x) { return x.chip + ' · ' + x.text + (x.area ? ' · ' + x.area : ''); });
  sect('Today', d.dayPlanHtml ? [] : (d.todayEvents || []), function(e) { return e.time + '  ' + e.title; });
  sect('This week', week, function(x) { return x.text + (x.when ? ' · ' + x.when : '') + (x.area ? ' · ' + x.area : ''); });
  if (d.ptoText) lines.push('', d.ptoText);
  sect('Held overnight', overnight, function(x) { return (x.label ? x.label + ' ' : '') + x.text + (x.at ? ' · ' + x.at : ''); });
  sect('Also', also, function(x) { return (x.label ? x.label + ' ' : '') + x.text; });
  if (d.staleText) lines.push(d.staleText);
  if (d.dashboardUrl) lines.push('', 'Open VERA: ' + d.dashboardUrl);
  lines.push('', '— VERA');
  return { subject: subject, html: html, text: lines.join('\n') };
}
