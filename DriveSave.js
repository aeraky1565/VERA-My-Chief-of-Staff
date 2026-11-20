// ============================================================
// VERA — DriveSave.js
// Saving a file VERA makes (a prescription photo, a note's picture) into a folder of its own in
// Drive. VERA can otherwise only read Drive (drive.readonly), so this uses the Drive service with
// the narrow "files this app creates" permission (drive.file): VERA sees and writes only the files
// and folders it made itself, never the rest of your Drive.
// ============================================================

var VERA_DRIVE_FOLDER_MIME_ = 'application/vnd.google-apps.folder';

/** The id of VERA's own folder by that name, made the first time. */
function veraDriveFolderId_(name) {
  var safe = String(name).replace(/'/g, "\\'");
  var found = Drive.Files.list({ q: "name = '" + safe + "' and mimeType = '" + VERA_DRIVE_FOLDER_MIME_ + "' and trashed = false", fields: 'files(id)', pageSize: 1 });
  if (found && found.files && found.files.length) return found.files[0].id;
  return Drive.Files.create({ name: name, mimeType: VERA_DRIVE_FOLDER_MIME_ }, null, { fields: 'id' }).id;
}

/** Saves a blob into VERA's folder by that name → the new file's id. */
function veraDriveSave_(folderName, blob) {
  return Drive.Files.create({ name: blob.getName(), parents: [veraDriveFolderId_(folderName)] }, blob, { fields: 'id' }).id;
}
