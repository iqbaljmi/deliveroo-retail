import type { Product, Status } from '@/lib/deliveroo';

export type { Product, Status };
export type ImportSourceRow = { line: number; siteId: string; barcode: string; rawStatus: string };
export type ImportRow = ImportSourceRow & { status: Status | null; product: Product | null; error: string };

export function normalize(value: unknown): string {
  return String(value ?? '').trim();
}

function statusValue(value: unknown): Status | null {
  const status = normalize(value).toLowerCase().replace(/[\s_-]+/g, '');
  if (['available', 'instock', 'yes', 'true'].includes(status)) return 'available';
  if (['unavailable', 'outofstock', 'soldout', 'no', 'false'].includes(status)) return 'unavailable';
  return status === 'hidden' ? 'hidden' : null;
}

export function validateImportRows(source: ImportSourceRow[], products: Product[], siteId: string): ImportRow[] {
  const catalogue = new Map<string, Product[]>();
  for (const product of products) {
    for (const code of new Set([...product.barcodes, product.plu].map(normalize).filter(Boolean))) {
      catalogue.set(code, [...(catalogue.get(code) ?? []), product]);
    }
  }

  const barcodes = new Set<string>();
  const productIds = new Set<string>();
  return source.map(row => {
    const status = statusValue(row.rawStatus);
    const matches = catalogue.get(row.barcode) ?? [];
    const product = matches.length === 1 ? matches[0] : null;
    let error = '';
    if (row.siteId !== siteId) error = 'Excel Site ID does not match selected store';
    else if (!row.barcode) error = 'Barcode missing';
    else if (!status) error = 'Invalid status';
    else if (barcodes.has(row.barcode)) error = 'Duplicate Excel barcode';
    else if (!matches.length) error = 'Barcode not found in this store';
    else if (matches.length > 1) error = 'Barcode matches multiple products';
    else if (productIds.has(product!.id)) error = 'Multiple Excel rows update the same product';
    barcodes.add(row.barcode);
    if (product) productIds.add(product.id);
    return { ...row, status, product, error };
  });
}

export type Availability = { unavailable_ids: string[]; hidden_ids: string[] };
export type AvailabilityUpdate = { item_id: string; status: Status };

// Compare with the live site snapshot, rather than a locally stored last upload.
export function planAvailabilityUpdates(updates: AvailabilityUpdate[], availability: Availability, allowUnhide = false) {
  const unavailable = new Set(availability.unavailable_ids);
  const hidden = new Set(availability.hidden_ids);
  const comparisons = updates.map(update => {
    const currentStatus: Status = hidden.has(update.item_id) ? 'hidden' : unavailable.has(update.item_id) ? 'unavailable' : 'available';
    const action = currentStatus === update.status ? 'unchanged' : currentStatus === 'hidden' && update.status !== 'hidden' && !allowUnhide ? 'protected' : 'changed';
    return { ...update, currentStatus, action };
  });
  return {
    comparisons,
    changed: comparisons.filter(row => row.action === 'changed').map(({ item_id, status }) => ({ item_id, status })),
    unchanged: comparisons.filter(row => row.action === 'unchanged').length,
    protected: comparisons.filter(row => row.action === 'protected').length,
  };
}
