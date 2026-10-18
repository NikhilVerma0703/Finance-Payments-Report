/**
 * Which invoices belong to which uploaded sheet.
 *
 * Every upload stores a report of what it did — the invoices it added, updated
 * and found unchanged, by invoice number (or "row N" where the sheet had no
 * number). That report is the record of membership, so nothing extra needs to
 * be stored and uploads made before this screen existed are covered too.
 *
 * An invoice **belongs exclusively** to an upload when that upload created it
 * and no other upload has added, updated or confirmed it since. Only those are
 * removed when an upload is deleted; an invoice another sheet also carries is
 * kept, because deleting one sheet must never take away what another brought.
 */

export interface UploadRef {
  id: string;
  fileName: string;
  customerName: string | null;
  created: string[];
  updated: string[];
  unchanged: string[];
}

export interface InvoiceRef {
  id: string;
  customerName: string | null;
  invoiceNo: string | null;
  source: string;
  sourceFile: string | null;
  sourceRow: number | null;
}

export interface Membership {
  /** Invoices this upload created. */
  created: string[];
  /** Invoices this upload added, updated or confirmed unchanged. */
  touched: string[];
  /** Created here and carried by no other upload — what deleting it removes. */
  exclusive: string[];
  /** Created here but also in another upload — kept when this one is deleted. */
  shared: string[];
}

const key = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** The invoices a report label refers to. */
function resolve(label: string, upload: UploadRef, invoices: InvoiceRef[]): string[] {
  const row = /^row (\d+)$/.exec(label.trim());
  if (row) {
    const n = Number(row[1]);
    return invoices
      .filter((i) => !i.invoiceNo && i.sourceRow === n && i.sourceFile === upload.fileName)
      .map((i) => i.id);
  }
  const k = key(label);
  return invoices
    .filter(
      (i) =>
        key(i.invoiceNo) === k &&
        // the same customer the sheet named — or, if the customer was renamed
        // since, the same file it came from
        (key(i.customerName) === key(upload.customerName) || i.sourceFile === upload.fileName),
    )
    .map((i) => i.id);
}

export function uploadMembership(
  uploads: UploadRef[],
  invoices: InvoiceRef[],
): Map<string, Membership> {
  const raw = new Map<string, { created: Set<string>; touched: Set<string> }>();
  for (const u of uploads) {
    const created = new Set(u.created.flatMap((l) => resolve(l, u, invoices)));
    const touched = new Set(
      [...u.created, ...u.updated, ...u.unchanged].flatMap((l) => resolve(l, u, invoices)),
    );
    raw.set(u.id, { created, touched });
  }

  const out = new Map<string, Membership>();
  for (const u of uploads) {
    const mine = raw.get(u.id)!;
    const elsewhere = new Set<string>();
    for (const [id, other] of raw) {
      if (id === u.id) continue;
      for (const inv of other.touched) elsewhere.add(inv);
    }
    const created = [...mine.created];
    out.set(u.id, {
      created,
      touched: [...mine.touched],
      exclusive: created.filter((id) => !elsewhere.has(id)),
      shared: created.filter((id) => elsewhere.has(id)),
    });
  }
  return out;
}
