/**
 * QC Terminal - Google Apps Script backend
 *
 * Sheet columns must match COLUMNS exactly, in this order.
 * Deploy as a Web App with access set to Anyone.
 */

const SHEET_NAME = 'Sheet1';
const COLUMNS = [
  'timestamp', 'serial_number', 'batch_number', 'uid_number', 'test_station', 'overall_status',
  'is_retest', 'notes', 'plug_socket', 'seal', 'visual', 'insert_glue', 'rotation',
  'labelling', 'serial_number_check', 'resistance', 'resistance_verified', 'moulding',
  'golden_coating'
];

function doGet(e) {
  try {
    const action = (e.parameter.action || '').toLowerCase();
    if (action === 'recent') {
      return jsonResponse({ status: 'ok', rows: getRecentRows() });
    }
    return jsonResponse({ status: 'ok', message: 'QC Terminal Apps Script is running' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const payload = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const action = payload.action || 'insert';

    if (!sheet) {
      return jsonResponse({ status: 'error', message: `Sheet "${SHEET_NAME}" not found` });
    }

    if (action === 'update') {
      return updateRow(sheet, payload);
    }

    return insertRow(sheet, payload);
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  } finally {
    lock.releaseLock();
  }
}

function insertRow(sheet, payload) {
  if (!payload.serial_number || !payload.test_station) {
    return jsonResponse({ status: 'error', message: 'Missing serial_number or test_station' });
  }

  if (!payload.is_retest && isDuplicate(sheet, payload.serial_number, payload.test_station)) {
    return jsonResponse({ status: 'duplicate', message: 'Serial already tested at this station' });
  }

  const row = COLUMNS.map(col => payload[col] === undefined || payload[col] === null ? '' : payload[col]);
  sheet.appendRow(row);
  const rowIndex = sheet.getLastRow();
  return jsonResponse({ status: 'ok', row: mapRow(sheet.getRange(rowIndex, 1, 1, COLUMNS.length).getValues()[0], rowIndex) });
}

function updateRow(sheet, payload) {
  const rowIndex = Number(payload.row_index || 0);
  let targetRow = rowIndex;

  if (!targetRow) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) === String(payload.serial_number)) {
        targetRow = i + 1;
        break;
      }
    }
  }

  if (!targetRow || targetRow < 2) {
    return jsonResponse({ status: 'error', message: 'Serial not found for update' });
  }

  COLUMNS.forEach((col, idx) => {
    if (payload[col] !== undefined) {
      sheet.getRange(targetRow, idx + 1).setValue(payload[col]);
    }
  });

  return jsonResponse({ status: 'ok', row: mapRow(sheet.getRange(targetRow, 1, 1, COLUMNS.length).getValues()[0], targetRow) });
}

function getRecentRows() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();
  return data
    .map((row, idx) => mapRow(row, idx + 2))
    .reverse()
    .slice(0, 8);
}

function mapRow(row, rowIndex) {
  const obj = { row_index: rowIndex };
  COLUMNS.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return obj;
}

function isDuplicate(sheet, serial, station) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

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
