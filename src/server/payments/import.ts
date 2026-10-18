/**
 * Importing a customer payment sheet into the Payment Tracking tables.
 *
 * Writes to `pt_customers`, `pt_invoices`, `pt_receipts`, `pt_notes` and
 * `pt_imports` and nothing else. It never touches the Accounts Register, so a
 * sheet can be imported on a database where no commercial invoice has ever been
 * uploaded — which is the whole point of the section.
 *
 * What it does with what the reader found:
 *
 *   - **the customer** is matched by name, case- and spacing-insensitively, so
 *     "Fair Deal Marble" and "fair  deal marble" are one customer rather than
 *     two. A new name creates a customer; an existing one is filled in where it
 *     was blank and never overwritten where it was not.
 *
 *   - **each invoice** is matched on invoice number *within that customer*, so
 *     two customers may use the same numbering without colliding. A re-import
 *     updates rather than duplicates, and reports what moved.
 *
 *   - **the received figure** becomes one receipt. A sheet gives a cumulative
 *     total, not a list of payments — only one of the reference sheets dates it
 *     at all — so it is stored as a single receipt, labelled as coming from a
 *     sheet. Receipts a person entered are never touched: they are the better
 *     record, and where they disagree with the sheet the difference is
 *     reported rather than resolved.
 *
 *   - **a second block** of the customer's own figures is read for comparison
 *     and reported, not merged.
 *
 * Nothing is invented: no due date is calculated here, no payment term is
 * inferred, no currency is assumed, and no printed total is trusted.
 */
import "server-only";

import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import { readPaymentSheet, type SheetBlock, type SheetRead, type SheetRow } from "@/lib/payments/sheetReader";
import { readTerm, type TermRule } from "@/lib/payments/terms";
import { loadRules } from "@/server/payments/settings";

const SHEET_SOURCE = "customer payment sheet";

export interface RowChange {
  invoiceNo: string;
  field: string;
  from: string | null;
  to: string | null;
}

export interface BlockDifference {
  invoiceNo: string;
  what: string;
  ours: string | null;
  theirs: string | null;
}

export interface Duplicate {
  invoiceNo: string;
  where: string;
}

export interface ImportResult {
  ok: boolean;
  message: string;
  importId?: string;
  customer: string | null;
  customerSource: string;
  asOn: string | null;
  asOnSource: string;
  currency: string | null;
  currencySource: string;
  rowsRead: number;
  /** Which sheet column each field was taken from. */
  mapping: Record<string, string>;
  unmapped: Array<{ column: string; heading: string }>;
  created: string[];
  updated: string[];
  unchanged: string[];
  skipped: Array<{ invoiceNo: string; why: string }>;
  duplicates: Duplicate[];
  changes: RowChange[];
  /** Where a second block of the customer's own figures disagrees with ours. */
  comparison: BlockDifference[];
  /** The payment-term wordings found, and what each was understood to mean. */
  terms: Array<{ raw: string; understood: string; count: number; unknown: boolean }>;
  warnings: string[];
  totals: { value: number; received: number; balance: number } | null;
}

function blank(over: Partial<ImportResult>): ImportResult {
  return {
    ok: false,
    message: "",
    customer: null,
    customerSource: "",
    asOn: null,
    asOnSource: "not stated",
    currency: null,
    currencySource: "",
    rowsRead: 0,
    mapping: {},
    unmapped: [],
    created: [],
    updated: [],
    unchanged: [],
    skipped: [],
    duplicates: [],
    changes: [],
    comparison: [],
    terms: [],
    warnings: [],
    totals: null,
    ...over,
  };
}

const key = (name: string | null | undefined) =>
  (name ?? "").toLowerCase().replace(/\s+/g, " ").trim();

const iso = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00.000Z`) : null);

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

/**
 * Read a sheet and bring it in.
 *
 * @param replace accept a file that has been imported before, byte for byte.
 *                A *refreshed* sheet for the same customer is always accepted —
 *                that is the normal monthly case — so this only guards against
 *                importing the identical file twice by accident.
 * @param dryRun  report what would change and write nothing.
 */
export async function importPaymentSheet(
  buffer: Buffer,
  fileName: string,
  opts: { replace?: boolean; dryRun?: boolean } = {},
): Promise<ImportResult> {
  const hash = createHash("sha256").update(buffer).digest("hex");

  if (!opts.replace && !opts.dryRun) {
    const already = await prisma.ptImport.findFirst({ where: { sha256: hash } });
    if (already) {
      return blank({
        message:
          `This exact file was already imported on ${already.createdAt.toISOString().slice(0, 10)}` +
          `${already.customerName ? ` for ${already.customerName}` : ""}. Send a refreshed sheet, ` +
          'or tick "import it again" to re-run this one.',
        customer: already.customerName,
      });
    }
  }

  let reads: SheetRead[];
  try {
    reads = await readPaymentSheet(buffer, fileName);
  } catch (error) {
    return blank({ message: `That file could not be read: ${(error as Error).message}` });
  }

  const usable = reads.filter((r) => r.blocks.length > 0);
  if (!usable.length) {
    return blank({
      message:
        "No invoice table was found. A payment sheet needs a header row naming an invoice number " +
        "or date, and at least one of invoice value, received or balance.",
      warnings: reads.flatMap((r) => r.warnings),
    });
  }

  const read = usable[0];
  const ours = read.blocks.find((b) => b.kind === "OURS") ?? read.blocks[0];
  const theirs = read.blocks.find((b) => b.kind === "CUSTOMER") ?? null;

  const result = blank({
    ok: true,
    customer: read.customerName,
    customerSource: read.customerSource,
    asOn: read.asOn,
    asOnSource: read.asOnSource,
    currency: read.currency,
    currencySource: read.currencySource,
    rowsRead: ours.rows.length,
    mapping: ours.mapping,
    unmapped: ours.unmapped,
    warnings: [...read.warnings],
    totals: ours.totals,
  });

  if (usable.length > 1) {
    result.warnings.push(
      `This workbook has ${usable.length} sheets with invoice tables. Only '${read.sheetName}' was imported.`,
    );
  }
  if (!read.currency) {
    result.warnings.push(
      "No currency could be established, so these invoices are imported without one. Set it on " +
        "the customer, or on each invoice, before relying on any total.",
    );
  }

  result.terms = termInventory(ours.rows, read.headerPaymentTerms, await loadRules());
  result.comparison = theirs ? compareBlocks(ours, theirs) : [];
  result.duplicates = duplicatesIn(ours.rows);

  if (opts.dryRun) {
    const existing = await findInvoices(read.customerName, ours.rows);
    for (const row of ours.rows) {
      const id = row.invoiceNo ?? "";
      if (!id) {
        result.skipped.push({
          invoiceNo: `row ${row.sourceRow}`,
          why: "No invoice number, so it cannot be matched on a re-import. It would be added as a new record.",
        });
        continue;
      }
      (existing.has(key(id)) ? result.updated : result.created).push(id);
    }
    result.message = summarise(result, true);
    return result;
  }

  // ---- the customer
  const customerId = await upsertCustomer(read, result);

  // ---- the invoices
  const seen = new Set<string>();
  for (const row of ours.rows) {
    const label = row.invoiceNo ?? `row ${row.sourceRow}`;

    if (row.invoiceNo && seen.has(key(row.invoiceNo))) {
      result.skipped.push({
        invoiceNo: label,
        why: `Appears more than once in this sheet (row ${row.sourceRow}); the first one was used.`,
      });
      continue;
    }
    if (row.invoiceNo) seen.add(key(row.invoiceNo));
    for (const note of row.notes) result.warnings.push(`${label}: ${note}`);

    const outcome = await upsertInvoice(row, read, customerId, result);
    result[outcome].push(label);
  }

  // ---- the customer's own block, for comparison
  if (theirs) await recordTheirFigures(theirs, read, customerId, result);

  const saved = await prisma.ptImport.create({
    data: {
      fileName,
      sheetName: read.sheetName,
      sha256: hash,
      customerName: read.customerName,
      asOn: iso(read.asOn),
      asOnSource: read.asOnSource,
      currency: read.currency,
      currencySource: read.currencySource,
      rowsRead: ours.rows.length,
      created: result.created.length,
      updated: result.updated.length,
      skipped: result.skipped.length,
      report: toJson({
        mapping: ours.mapping,
        unmapped: ours.unmapped,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        skipped: result.skipped,
        duplicates: result.duplicates,
        changes: result.changes,
        comparison: result.comparison,
        terms: result.terms,
        totals: ours.totals,
        statedTotals: ours.statedTotals,
      }),
      warnings: toJson(result.warnings),
      content: new Uint8Array(buffer),
    },
  });
  result.importId = saved.id;
  result.message = summarise(result, false);
  return result;
}

// ---------------------------------------------------------------------------

async function findInvoices(
  customerName: string | null,
  rows: SheetRow[],
): Promise<Map<string, { id: string }>> {
  const numbers = rows.map((r) => r.invoiceNo).filter((n): n is string => Boolean(n));
  if (!numbers.length) return new Map();

  const customer = customerName
    ? await prisma.ptCustomer.findFirst({ where: { name: customerName } })
    : null;

  const found = await prisma.ptInvoice.findMany({
    where: {
      invoiceNo: { in: numbers },
      ...(customer ? { customerId: customer.id } : {}),
    },
    select: { id: true, invoiceNo: true },
  });
  return new Map(found.map((f) => [key(f.invoiceNo), { id: f.id }]));
}

/**
 * Find or create the customer.
 *
 * Matched on a squashed name so spacing and capitalisation do not create
 * duplicates. An existing customer is only filled in where a field is empty —
 * a sheet must not overwrite something somebody typed.
 */
async function upsertCustomer(read: SheetRead, result: ImportResult): Promise<string | null> {
  if (!read.customerName) {
    result.warnings.push(
      "No customer name could be found in this sheet, so these invoices are stored without a " +
        "customer. They appear under 'No customer recorded' and can be assigned later.",
    );
    return null;
  }

  const all = await prisma.ptCustomer.findMany();
  const match = all.find((c) => key(c.name) === key(read.customerName));

  if (match) {
    const fill: Record<string, string> = {};
    if (!match.currency && read.currency) fill.currency = read.currency;
    if (!match.defaultPaymentTerms && read.headerPaymentTerms) {
      fill.defaultPaymentTerms = read.headerPaymentTerms;
    }
    if (Object.keys(fill).length) {
      await prisma.ptCustomer.update({ where: { id: match.id }, data: fill });
    }
    return match.id;
  }

  const created = await prisma.ptCustomer.create({
    data: {
      name: read.customerName,
      currency: read.currency,
      defaultPaymentTerms: read.headerPaymentTerms,
      notes: `Created from ${read.fileName} (customer name taken from ${read.customerSource}).`,
    },
  });
  return created.id;
}

/** The fields a sheet can speak about. Everything else it leaves alone. */
const SHEET_FIELDS = [
  "invoiceNo",
  "invoiceDate",
  "customerInvoiceValue",
  "customsInvoiceValue",
  "exchangeRate",
  "currency",
  "paymentTerms",
  "containerNo",
  "poNo",
  "piNo",
  "shippingBillNo",
  "shippingBillDate",
  "blNo",
  "blDate",
  "consignee",
  "notifyParty",
  "country",
  "remarks",
  "enteredDueDate",
] as const;

async function upsertInvoice(
  row: SheetRow,
  read: SheetRead,
  customerId: string | null,
  result: ImportResult,
): Promise<"created" | "updated" | "unchanged"> {
  const existing = row.invoiceNo
    ? await prisma.ptInvoice.findFirst({
        where: { invoiceNo: row.invoiceNo, ...(customerId ? { customerId } : {}) },
      })
    : null;

  const incoming: Record<string, unknown> = {
    invoiceNo: row.invoiceNo,
    invoiceDate: iso(row.invoiceDate),
    customerInvoiceValue: row.customerInvoiceValue,
    customsInvoiceValue: row.customsInvoiceValue,
    exchangeRate: row.exchangeRate,
    currency: row.currency ?? read.currency,
    paymentTerms: row.paymentTerms,
    containerNo: row.containerNo,
    poNo: row.poNo,
    piNo: row.piNo,
    shippingBillNo: row.shippingBillNo,
    shippingBillDate: iso(row.shippingBillDate),
    blNo: row.blNo,
    blDate: iso(row.blDate),
    consignee: row.consignee,
    notifyParty: row.notifyParty,
    country: row.country,
    remarks: row.remarks,
    // the date in an "ETA / Due Date" column is kept as the entered due date,
    // because it cannot be recomputed — the basis behind it is in no sheet
    enteredDueDate: iso(row.statedDueDate),
  };

  const label = row.invoiceNo ?? `row ${row.sourceRow}`;

  if (!existing) {
    const invoice = await prisma.ptInvoice.create({
      data: {
        customerId,
        ...incoming,
        source: "EXCEL",
        sourceFile: read.fileName,
        sourceRow: row.sourceRow,
        sourceAsOn: iso(read.asOn),
      } as never,
    });
    await syncSheetReceipt(invoice.id, row, read, result, label);
    await syncSheetNotes(invoice.id, row);
    return "created";
  }

  // only fill what is empty, or update what a sheet supplied before
  const patch: Record<string, unknown> = {};
  const record = existing as unknown as Record<string, unknown>;
  for (const field of SHEET_FIELDS) {
    const value = incoming[field];
    if (value === null || value === undefined) continue;
    const before = record[field];
    const fromSheet = existing.source === "EXCEL";
    if (before !== null && before !== undefined && !fromSheet) continue;

    const same =
      before instanceof Date && value instanceof Date
        ? before.getTime() === value.getTime()
        : String(before ?? "") === String(value);
    if (same) continue;

    patch[field] = value;
    result.changes.push({
      invoiceNo: label,
      field,
      from: str(before instanceof Date ? before.toISOString().slice(0, 10) : before),
      to: str(value instanceof Date ? value.toISOString().slice(0, 10) : value),
    });
  }

  if (Object.keys(patch).length) {
    await prisma.ptInvoice.update({
      where: { id: existing.id },
      data: { ...patch, sourceFile: read.fileName, sourceAsOn: iso(read.asOn) } as never,
    });
  }

  const receiptChanged = await syncSheetReceipt(existing.id, row, read, result, label);
  await syncSheetNotes(existing.id, row);

  return Object.keys(patch).length || receiptChanged ? "updated" : "unchanged";
}

/**
 * The sheet's cumulative "Received" figure, as one receipt.
 *
 * Receipts somebody entered by hand are the better record and are left alone;
 * where they disagree with the sheet, the difference is reported so a person
 * can decide. Only the receipt this importer created before is updated.
 */
async function syncSheetReceipt(
  invoiceId: string,
  row: SheetRow,
  read: SheetRead,
  result: ImportResult,
  label: string,
): Promise<boolean> {
  const existing = await prisma.ptReceipt.findMany({
    where: { invoiceId },
    orderBy: { seq: "asc" },
  });
  const mine = existing.filter((r) => (r.bankRef ?? "").startsWith(SHEET_SOURCE));
  const typed = existing.filter((r) => !(r.bankRef ?? "").startsWith(SHEET_SOURCE));

  if (typed.length) {
    const total = round2(typed.reduce((s, r) => s + Number(r.amountFcy ?? 0), 0));
    if (Math.abs(total - (row.received ?? 0)) > 0.01) {
      result.warnings.push(
        `${label}: the sheet says ${(row.received ?? 0).toFixed(2)} received, but ${typed.length} ` +
          `receipt(s) entered here total ${total.toFixed(2)}. The entered receipts were kept — ` +
          "they are the more detailed record.",
      );
    }
    return false;
  }

  if ((row.received ?? 0) <= 0.01) {
    if (mine.length) {
      await prisma.ptReceipt.deleteMany({ where: { id: { in: mine.map((r) => r.id) } } });
      return true;
    }
    return false;
  }

  const data = {
    receiptDate: iso(row.receiptDate),
    amountFcy: row.received,
    exchangeRate: row.receiptExchangeRate,
    bankRef: `${SHEET_SOURCE}${read.asOn ? ` as on ${read.asOn}` : ""}`,
    remarks: row.receiptDate
      ? null
      : "The sheet gives a cumulative figure with no payment date, so this stands for every " +
        "payment received up to the sheet's own date.",
  };

  if (mine[0]) {
    const same =
      Math.abs(Number(mine[0].amountFcy ?? 0) - (row.received ?? 0)) <= 0.01 &&
      (mine[0].receiptDate?.toISOString().slice(0, 10) ?? null) === row.receiptDate;
    if (same) return false;
    await prisma.ptReceipt.update({ where: { id: mine[0].id }, data });
    result.changes.push({
      invoiceNo: label,
      field: "received",
      from: Number(mine[0].amountFcy ?? 0).toFixed(2),
      to: (row.received ?? 0).toFixed(2),
    });
    return true;
  }

  await prisma.ptReceipt.create({ data: { invoiceId, seq: 1, ...data } });
  return true;
}

/** CN and DN columns, where a sheet has them. None of the four reference sheets does. */
async function syncSheetNotes(invoiceId: string, row: SheetRow): Promise<void> {
  for (const [type, amount] of [
    ["CREDIT", row.creditNote],
    ["DEBIT", row.debitNote],
  ] as const) {
    if (amount === null || amount <= 0.01) continue;
    const existing = await prisma.ptNote.findFirst({
      where: { invoiceId, noteType: type, reason: { startsWith: SHEET_SOURCE } },
    });
    const data = { amount, reason: `${SHEET_SOURCE} — from the sheet's ${type.toLowerCase()} note column` };
    if (existing) await prisma.ptNote.update({ where: { id: existing.id }, data });
    else await prisma.ptNote.create({ data: { invoiceId, noteType: type, ...data } });
  }
}

/**
 * The customer's own figures from a second block.
 *
 * Stored as the invoice's `booksBalance` — the "as per customer" side — because
 * that is the one column this section has for "a balance somebody else says".
 * Never merged into our own figures: the gap between the two is the point.
 */
async function recordTheirFigures(
  block: SheetBlock,
  read: SheetRead,
  customerId: string | null,
  result: ImportResult,
): Promise<void> {
  for (const row of block.rows) {
    if (!row.invoiceNo) continue;
    const invoice = await prisma.ptInvoice.findFirst({
      where: { invoiceNo: row.invoiceNo, ...(customerId ? { customerId } : {}) },
    });
    if (!invoice) {
      result.warnings.push(
        `${row.invoiceNo} appears in '${block.label}' but not in our own block, so the customer's ` +
          "figure could not be attached to an invoice.",
      );
      continue;
    }
    const theirBalance =
      row.customerInvoiceValue === null
        ? row.statedBalance
        : round2(row.customerInvoiceValue - (row.received ?? 0));
    if (theirBalance === null) continue;

    await prisma.ptInvoice.update({
      where: { id: invoice.id },
      data: { booksBalance: theirBalance },
    });
  }
  result.warnings.push(
    `'${block.label}' was read as the customer's own position and stored against each invoice as ` +
      "the balance per their records. It is never merged into ours — the difference is reported.",
  );
}

// ---------------------------------------------------------------------------

function duplicatesIn(rows: SheetRow[]): Duplicate[] {
  const seen = new Map<string, number>();
  const out: Duplicate[] = [];
  for (const r of rows) {
    if (!r.invoiceNo) continue;
    const k = key(r.invoiceNo);
    const first = seen.get(k);
    if (first !== undefined) {
      out.push({ invoiceNo: r.invoiceNo, where: `rows ${first} and ${r.sourceRow}` });
    } else seen.set(k, r.sourceRow);
  }
  return out;
}

function compareBlocks(ours: SheetBlock, theirs: SheetBlock): BlockDifference[] {
  const out: BlockDifference[] = [];
  const mine = new Map(ours.rows.filter((r) => r.invoiceNo).map((r) => [key(r.invoiceNo), r]));
  const yours = new Map(theirs.rows.filter((r) => r.invoiceNo).map((r) => [key(r.invoiceNo), r]));

  for (const k of [...new Set([...mine.keys(), ...yours.keys()])].sort()) {
    const a = mine.get(k);
    const b = yours.get(k);
    const no = a?.invoiceNo ?? b?.invoiceNo ?? k;
    if (!a || !b) {
      out.push({
        invoiceNo: no,
        what: "appears in only one of the two blocks",
        ours: a ? "present" : null,
        theirs: b ? "present" : null,
      });
      continue;
    }
    if (Math.abs((a.customerInvoiceValue ?? 0) - (b.customerInvoiceValue ?? 0)) > 0.01) {
      out.push({
        invoiceNo: no,
        what: "invoice value",
        ours: (a.customerInvoiceValue ?? 0).toFixed(2),
        theirs: (b.customerInvoiceValue ?? 0).toFixed(2),
      });
    }
    if (Math.abs((a.received ?? 0) - (b.received ?? 0)) > 0.01) {
      out.push({
        invoiceNo: no,
        what: "received",
        ours: (a.received ?? 0).toFixed(2),
        theirs: (b.received ?? 0).toFixed(2),
      });
    }
    if ((a.receiptDate ?? null) !== (b.receiptDate ?? null)) {
      out.push({ invoiceNo: no, what: "receipt date", ours: a.receiptDate, theirs: b.receiptDate });
    }
  }
  return out;
}

function termInventory(
  rows: SheetRow[],
  headerTerm: string | null,
  rules: TermRule[] = [],
): ImportResult["terms"] {
  const seen = new Map<string, { raw: string; understood: string; count: number; unknown: boolean }>();
  const add = (raw: string | null) => {
    const text = (raw ?? "").trim();
    if (!text) return;
    const entry = seen.get(text);
    if (entry) entry.count += 1;
    else {
      const t = readTerm(text, rules);
      seen.set(text, { raw: text, understood: t.description, count: 1, unknown: t.unknown });
    }
  };
  for (const r of rows) add(r.paymentTerms);
  if (!seen.size) add(headerTerm);
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

function summarise(r: ImportResult, dryRun: boolean): string {
  const parts: string[] = [];
  if (r.created.length) parts.push(`${r.created.length} invoice(s) ${dryRun ? "would be added" : "added"}`);
  if (r.updated.length) parts.push(`${r.updated.length} ${dryRun ? "would be updated" : "updated"}`);
  if (r.unchanged.length) parts.push(`${r.unchanged.length} unchanged`);
  if (r.skipped.length) parts.push(`${r.skipped.length} skipped`);
  if (!parts.length) parts.push("nothing to import");

  const t = r.totals;
  return (
    `${r.customer ?? "No customer named"}: ${parts.join(", ")}.` +
    (t
      ? ` Invoiced ${t.value.toFixed(2)}, received ${t.received.toFixed(2)}, outstanding ` +
        `${t.balance.toFixed(2)}${r.currency ? ` ${r.currency}` : ""}.`
      : "") +
    ` As on ${r.asOn ?? "not stated"} (${r.asOnSource}).` +
    (dryRun ? " Nothing was saved." : "")
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
