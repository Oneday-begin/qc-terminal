/**
 * QC Terminal — Google Apps Script backend (Option B)
 *
 * SETUP
 * 1. Create a Google Sheet. Add a header row (row 1) with these
 *    exact columns, in this order:
 *    timestamp | serial_number | test_station | overall_status |
 *    is_retest | notes | plug_socket_mating | resistance_value |
 *    seal_cycle | visual_appearance | moulding_color |
 *    golden_coating | insert_glue | rotation_smoothness |
 *    labelling_clear | serial_legibility
 * 2. Extensions > Apps Script, paste this file in as Code.gs.
 * 3. Deploy > New deployment > type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 4. Copy the deployment URL into the QC Terminal app's Settings
 *    panel as the "Apps Script Web App URL".
 *
 * This script rejects duplicate serial+station combinations
 * unless is_retest is true, and always returns a JSON body with
 * a "status" field so the frontend can confirm success before
 * showing the "Logged to Database" toast.
 */

const SHEET_NAME = 'Sheet1'; // change if your tab is named differently
const COLUMNS = [
  'timestamp', 'serial_number', 'batch_number', 'uid_number', 'test_station', 'overall_status',
  'is_retest', 'notes', 'plug_socket_mating', 'resistance_value',
  'seal_cycle', 'visual_appearance', 'moulding_color', 'golden_coating',
  'insert_glue', 'rotation_smoothness', 'labelling_clear', 'serial_legibility',
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // serialize concurrent submissions to avoid race conditions on the duplicate check

  try {
    const payload = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    if (!payload.serial_number || !payload.test_station) {
      return jsonResponse({ status: 'error', message: 'Missing serial_number or test_station' });
    }

    if (!payload.is_retest && isDuplicate(sheet, payload.serial_number, payload.test_station)) {
      return jsonResponse({ status: 'duplicate', message: 'Serial already tested at this station' });
    }

    const row = COLUMNS.map(col => {
      const val = payload[col];
      return (val === undefined || val === null) ? '' : val;
    });
    sheet.appendRow(row);

    return jsonResponse({ status: 'ok' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  } finally {
    lock.releaseLock();
  }
}

function isDuplicate(sheet, serial, station) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false; // only header row exists

  const serialCol = COLUMNS.indexOf('serial_number') + 1;
  const stationCol = COLUMNS.indexOf('test_station') + 1;
  const retestCol = COLUMNS.indexOf('is_retest') + 1;

  const serials = sheet.getRange(2, serialCol, lastRow - 1, 1).getValues();
  const stations = sheet.getRange(2, stationCol, lastRow - 1, 1).getValues();
  const retests = sheet.getRange(2, retestCol, lastRow - 1, 1).getValues();

  for (let i = 0; i < serials.length; i++) {
    const sameSerial = String(serials[i][0]) === String(serial);
    const sameStation = String(stations[i][0]) === String(station);
    const wasRetest = retests[i][0] === true || retests[i][0] === 'true';
    if (sameSerial && sameStation && !wasRetest) return true;
  }
  return false;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
