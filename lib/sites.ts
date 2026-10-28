// Shared browser/server allowlist. The Brand ID comes only from server environment configuration.
export const SITES = [
  { id: '718446', name: 'K-Secret - Al Zahia' },
  { id: '793664', name: 'K-Secret - Burjuman' },
  { id: '718436', name: 'K-Secret - Tecom' },
  { id: '718443', name: 'K-Secret - Festival City' },
  { id: '718448', name: 'K-Secret - Dubai Production City' },
  { id: '718434', name: 'K-Secret - Al Wahda' },
  { id: '718445', name: 'K-Secret - Al Rigga' },
  { id: '718444', name: 'K-Secret - Deira' },
  { id: '818607', name: 'K-secret Warehouse' },
  { id: '733160', name: 'K-Secret - Wafi Mall' },
  { id: '778414', name: 'K- Secret | MOE' },
  { id: '718437', name: 'K-Secret - Ibn Battuta' },
  { id: '809104', name: 'K-Secret - Yas Mall' },
  { id: '718447', name: 'K-Secret - Al Mizharr' },
  { id: '718433', name: 'K-Secret - JVC' },
] as const;

export type Site = (typeof SITES)[number];

export function getSite(siteId: unknown): Site | null {
  if (typeof siteId !== 'string') return null;
  return SITES.find(site => site.id === siteId) ?? null;
}

