import * as XLSX from 'xlsx';
import { normalize, type ImportSourceRow } from '@/lib/availability';
import { getSite } from '@/lib/sites';

function headerKey(value: unknown): string {
  return normalize(value).toLowerCase().replace(/[\s_-]+/g, '');
}

function siteColumn(header: unknown[]): number {
  return header.findIndex(value => ['siteid', 'storeid', 'deliveroositeid'].includes(headerKey(value)));
}

// Parse in memory on the server. Neither the workbook nor its rows are persisted.
export function parseAvailabilityWorkbook(data: ArrayBuffer, siteId: string): ImportSourceRow[] {
  if (!getSite(siteId)) throw new Error('Select an allowlisted store.');
  const workbook = XLSX.read(data, { type: 'array', cellText: true, raw: false });

  // The export also carries a Store sheet. Check it even if all row IDs were edited.
  if (workbook.Sheets.Store) {
    const metadata = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Store, { header: 1, defval: '', raw: false });
    const index = siteColumn(metadata[0] ?? []);
    const stores = metadata.slice(1).filter(row => row.some(value => normalize(value)));
    if (index < 0 || stores.length !== 1 || normalize(stores[0][index]) !== siteId) {
      throw new Error('The workbook Store sheet does not match the selected store. Import cancelled.');
    }
  }

  const sheet = workbook.Sheets.Availability ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('Workbook has no sheet.');
  const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
  if (values.length < 2) throw new Error('No data rows found.');
  const header = values[0].map(headerKey);
  const siteIndex = siteColumn(values[0]);
  const barcodeIndex = header.findIndex(value => ['barcode', 'ean', 'ean13', 'gtin', 'plu', 'sku'].includes(value));
  const statusIndex = header.findIndex(value => ['status', 'availability', 'stockstatus'].includes(value));
  if (siteIndex < 0 || barcodeIndex < 0 || statusIndex < 0) {
    throw new Error('Headers required: Site ID, Barcode and Status.');
  }
  const source = values.slice(1).map((row, index) => ({
    line: index + 2,
    siteId: normalize(row[siteIndex]),
    barcode: normalize(row[barcodeIndex]),
    rawStatus: normalize(row[statusIndex]),
  })).filter(row => row.siteId || row.barcode || row.rawStatus);
  if (!source.length) throw new Error('No product data found.');
  if (source.length > 10000) throw new Error('Maximum 10,000 data rows.');
  for (const row of source) {
    if (!row.siteId) throw new Error(`Site ID is missing on Excel row ${row.line}.`);
    if (row.siteId !== siteId) {
      throw new Error(`Excel row ${row.line} is for Site ID ${row.siteId}, not selected Site ID ${siteId}. Import cancelled.`);
    }
  }
  return source;
}
