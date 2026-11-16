import { supabase } from '../supabase';
import { t } from '@/lib/i18n';

/* ─────────────────────────────────────────────────────────────────────────
 * Gear / inventory (table `inventory`, migration 006).
 * Writes return their error and treat "0 rows touched" (RLS) as an error.
 * ───────────────────────────────────────────────────────────────────────── */

export type InventoryStatus = 'available' | 'in_use' | 'maintenance' | 'lost';

/** Figma order first (Instruments → Lighting, plus Speakers), then the extra DB categories.
 *  A band may also type its own category (127): stored as typed, max 40 characters. */
export const INVENTORY_CATEGORIES = ['Instruments', 'Cables', 'Microphones', 'Speakers', 'Stands', 'Lighting', 'Cases', 'Other'] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const CUSTOM_CATEGORY_MAX = 40;

export interface InventoryItem {
  id: string;
  band_id: string;
  name: string;
  category: string;
  quantity: number;
  status: InventoryStatus | string;
  location?: string | null;
  notes?: string | null;
  serial_number?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | string | null;
  /** Personal gear (110): the member it belongs to. Null = the band's gear (admins manage it). */
  owner_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  /**
   * serial_number, purchase_date and purchase_price were loaded (115): true
   * for every item an admin sees and a member's own gear. False = not
   * readable or not loaded: they are left out of a save, so they are never
   * wiped by mistake.
   */
  private_loaded?: boolean;
}

export interface InventoryInput {
  name: string;
  category: string;
  quantity: number;
  status: InventoryStatus | string;
  location?: string;
  notes?: string;
  serialNumber?: string;
  purchaseDate?: string;
  /** Free text from the field; parsed to a number (blank → null). */
  purchasePrice?: string;
  /** Who it belongs to: a user id (personal gear), null (the band's), undefined = unchanged. */
  ownerId?: string | null;
}

type Result<T> = { data: T | null; error: Error | null };

/**
 * inventory columns the app reads directly: every column except
 * serial_number, purchase_date and purchase_price, which come from
 * bw_inventory_private() (115) so step 2 (119) can revoke them.
 * New columns go here and in 119's GRANT.
 */
export const INVENTORY_COLUMNS = 'id, band_id, name, category, quantity, status, location, notes, owner_id, created_at, updated_at';

type InventoryPrivate = Pick<InventoryItem, 'serial_number' | 'purchase_date' | 'purchase_price'>;

/** Database before 115: read the columns directly, as before. */
const isMissingRpc = (err: { code?: string; message?: string } | null | undefined): boolean =>
  !!err && (err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(err.message || ''));

/**
 * Purchase data the caller may see for a band's items (115): every item for
 * an admin, a member's own personal gear only. Null when it could not be read.
 */
async function getInventoryPrivate(bandId: string): Promise<Map<string, InventoryPrivate> | null> {
  const { data, error } = await supabase.rpc('bw_inventory_private', { p_band_id: bandId });
  let rows: any[] | null = Array.isArray(data) ? data : null;
  if (error && isMissingRpc(error)) {
    const legacy = await supabase.from('inventory').select('id, serial_number, purchase_date, purchase_price').eq('band_id', bandId);
    if (legacy.error) return null;
    rows = (legacy.data || []).map((r: any) => ({ inventory_id: r.id, ...r }));
  } else if (error) {
    console.warn('Failed to load gear purchase details:', error);
    return null;
  }
  return new Map(
    (rows || []).map((r) => [
      String(r.inventory_id),
      { serial_number: r.serial_number ?? null, purchase_date: r.purchase_date ?? null, purchase_price: r.purchase_price ?? null },
    ]),
  );
}

/** The purchase fields of a row being written, for the item returned to the view. */
const privateOf = (row: Record<string, unknown>): InventoryPrivate => ({
  serial_number: (row.serial_number as string | null) ?? null,
  purchase_date: (row.purchase_date as string | null) ?? null,
  purchase_price: (row.purchase_price as number | null) ?? null,
});

const noRowsMessage = () => t("This change wasn't saved: band gear is managed by the admins, personal gear by its owner.");

const asError = (err: unknown, fallback: string) => {
  const e = err as { message?: string; code?: string } | null;
  // A database before 127 accepts only the original categories.
  if (e?.code === '23514' && /category/i.test(e.message || '')) return new Error(t("This category can't be saved yet. Pick another one."));
  return new Error(e?.message || fallback);
};

const blankToNull = (v?: string | null) => {
  const trimmed = (v ?? '').trim();
  return trimmed ? trimmed : null;
};

/** Who may change an item: admins any, a member only their own personal gear. */
export const canEditInventoryItem = (item: Pick<InventoryItem, 'owner_id'>, userId: string | null | undefined, isAdmin: boolean): boolean =>
  isAdmin || (!!userId && item.owner_id === userId);

/**
 * Matches a stored category to the canonical label (older rows may be
 * lowercase). Any other text is the band's own category (127) and is kept as
 * typed (trimmed); a blank one files under Other.
 */
export const canonicalCategory = (category: string | null | undefined): string => {
  const raw = (category ?? '').trim();
  const hit = INVENTORY_CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
  return hit ?? (raw || 'Other');
};

/** True for a category the band typed itself (not one of INVENTORY_CATEGORIES). */
export const isCustomCategory = (category: string | null | undefined): boolean =>
  !(INVENTORY_CATEGORIES as readonly string[]).includes(canonicalCategory(category));

/**
 * The band's own categories in use, once each (case-insensitive, first
 * spelling wins), sorted for the chips.
 */
export const customCategories = (items: Pick<InventoryItem, 'category'>[]): string[] => {
  const seen = new Map<string, string>();
  for (const item of items) {
    const c = canonicalCategory(item.category);
    if (isCustomCategory(c) && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

/** A built-in category typed in the app language ("Altavoces" → Speakers), so it isn't stored as a custom one. */
const builtInByLabel = (typed: string): string | undefined =>
  INVENTORY_CATEGORIES.find((c) => t(c).toLocaleLowerCase() === typed.toLocaleLowerCase());

/** Same category, ignoring case ("keys" files with "Keys"). */
export const sameCategory = (a: string | null | undefined, b: string | null | undefined): boolean =>
  canonicalCategory(a).toLowerCase() === canonicalCategory(b).toLowerCase();

export const parsePrice = (raw?: string): { value: number | null; error: string | null } => {
  const cleaned = (raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return { value: null, error: null };
  const v = Number(cleaned);
  if (!Number.isFinite(v) || v < 0) return { value: null, error: t('Enter a valid purchase price.') };
  return { value: Math.round(v * 100) / 100, error: null };
};

/**
 * `includePrivate` false leaves serial number, purchase date and price out
 * of the row (an item whose purchase data was not loaded), so a save keeps
 * what is stored.
 */
export const toInventoryRow = (
  input: InventoryInput,
  includePrivate = true,
): { row: Record<string, unknown> | null; error: string | null } => {
  const name = input.name.trim();
  if (!name) return { row: null, error: t('Give the item a name.') };
  const qty = Math.floor(Number(input.quantity));
  if (!Number.isFinite(qty) || qty < 0) return { row: null, error: t('Quantity must be 0 or more.') };
  const rawCategory = (input.category ?? '').trim();
  if (!rawCategory) return { row: null, error: t('Give the category a name.') };
  if (rawCategory.length > CUSTOM_CATEGORY_MAX) return { row: null, error: t('Use {count} characters or fewer for the category.', { count: CUSTOM_CATEGORY_MAX }) };
  const price = includePrivate ? parsePrice(input.purchasePrice) : { value: null, error: null };
  if (price.error) return { row: null, error: price.error };
  return {
    row: {
      name,
      category: builtInByLabel(rawCategory) ?? canonicalCategory(rawCategory),
      quantity: qty,
      status: input.status,
      location: blankToNull(input.location),
      notes: blankToNull(input.notes),
      ...(includePrivate
        ? {
            serial_number: blankToNull(input.serialNumber),
            purchase_date: blankToNull(input.purchaseDate),
            purchase_price: price.value,
          }
        : {}),
      ...(input.ownerId !== undefined ? { owner_id: input.ownerId } : {}),
    },
    error: null,
  };
};

export async function listInventory(bandId: string): Promise<Result<InventoryItem[]>> {
  const [{ data, error }, priv] = await Promise.all([
    supabase.from('inventory').select(INVENTORY_COLUMNS).eq('band_id', bandId).order('name', { ascending: true }),
    getInventoryPrivate(bandId),
  ]);
  if (error) return { data: null, error: asError(error, t('Could not load the gear list.')) };
  const items = ((data || []) as InventoryItem[]).map((item) => {
    const p = priv?.get(item.id);
    return p ? { ...item, ...p, private_loaded: true } : { ...item, private_loaded: false };
  });
  return { data: items, error: null };
}

export async function createInventoryItem(bandId: string, input: InventoryInput): Promise<Result<InventoryItem>> {
  const { row, error: invalid } = toInventoryRow(input);
  if (!row) return { data: null, error: new Error(invalid || t('Check the item details.')) };
  const { data, error } = await supabase
    .from('inventory')
    .insert({ band_id: bandId, ...row })
    .select(INVENTORY_COLUMNS)
    .single();
  if (error) return { data: null, error: asError(error, t('Could not add the item.')) };
  if (!data) return { data: null, error: new Error(noRowsMessage()) };
  // Whoever adds an item may read its purchase data (admin, or its owner).
  return { data: { ...(data as InventoryItem), ...privateOf(row), private_loaded: true }, error: null };
}

/**
 * `includePrivate` false: the item's purchase data was not loaded, so it is
 * not written (it stays as stored).
 */
export async function updateInventoryItem(id: string, input: InventoryInput, includePrivate = true): Promise<Result<InventoryItem>> {
  const { row, error: invalid } = toInventoryRow(input, includePrivate);
  if (!row) return { data: null, error: new Error(invalid || t('Check the item details.')) };
  const { data, error } = await supabase.from('inventory').update(row).eq('id', id).select(INVENTORY_COLUMNS);
  if (error) return { data: null, error: asError(error, t('Could not save the item.')) };
  const updated = Array.isArray(data) ? data[0] : data;
  if (!updated) return { data: null, error: new Error(noRowsMessage()) };
  return {
    data: includePrivate
      ? { ...(updated as InventoryItem), ...privateOf(row), private_loaded: true }
      : { ...(updated as InventoryItem), private_loaded: false },
    error: null,
  };
}

export async function deleteInventoryItem(id: string): Promise<{ error: Error | null }> {
  const { data, error } = await supabase.from('inventory').delete().eq('id', id).select('id');
  if (error) return { error: asError(error, t('Could not delete the item.')) };
  if (!data || (Array.isArray(data) && data.length === 0)) return { error: new Error(noRowsMessage()) };
  return { error: null };
}
