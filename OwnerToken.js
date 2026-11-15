// ============================================================
// VERA — OwnerToken.js  (temporary)
// Shows the owner's dashboard token, for getting a device back into the full
// dashboard when the token isn't to hand and the Script Properties list is too long
// to scroll on a phone.
//
// Run showOwnerToken from the Apps Script editor's function menu; the token appears
// in the Execution log. Only someone who can open this Apps Script project can run
// it, and that is already someone who can read every Script Property. Nothing here
// is reachable from the web app.
//
// Remove this file once the token is back on the device.
// ============================================================

function showOwnerToken() {
  var t = PropertiesService.getScriptProperties().getProperty('VERA_WEB_TOKEN') || '';
  Logger.log(t ? 'VERA_WEB_TOKEN: ' + t : 'VERA_WEB_TOKEN is not set. Set one in Project Settings › Script Properties.');
}
