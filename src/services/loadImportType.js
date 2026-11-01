const importTypes = { BOL: 'bol', POD: 'pod', INVOICE: 'invoice', DRIVER_SHEET: 'driver_sheet', OTHER: 'other', UNKNOWN: 'unknown' };
export function rejectedLoadImportType(error) {
  const code = `${error?.code || ''} ${error?.message || ''}`.match(/\bLOAD_IMPORT_TYPE_(DRIVER_SHEET|BOL|POD|INVOICE|OTHER|UNKNOWN)\b/);
  return code ? importTypes[code[1]] : null;
}
