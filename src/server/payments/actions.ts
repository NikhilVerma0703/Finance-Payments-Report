/**
 * Every write the Payment Tracking section makes.
 *
 * Three rules run through all of them.
 *
 * **Nothing is ever refused for being incomplete.** There is no required field,
 * not even the invoice number. An Accounts user can save what they know, walk
 * away, and come back to the rest, and what cannot be calculated from what is
 * present is reported as *requiring verification* rather than blocking the save.
 *
 * **A field is editable whether it was typed or imported.** An invoice that came
 * from an uploaded sheet with 13 of its fields filled is the same record as one
 * typed by hand; the other 12 are filled in later through the same form, and any
 * of the 13 can be corrected. Nothing is read-only for having come from Excel.
 *
 * **A form can only change what it showed.** A blank box clears its value — that
 * is deliberate, because a payment term that has been withdrawn must not linger.
 * But a field whose input was not on the form is left exactly as it is. The two
 * used to be indistinguishable in a `FormData`, and the cost was real: the inline
 * receipt row showed four fields of five, so saving it wiped the remittance note
 * the importer had stored in the fifth. `offeredIn` tells them apart now.
 *
 * Writes touch `pt_*` tables only, and each one records what it changed — see
 * `audit.ts`.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { toIsoDate, toNumber } from "@/lib/text";
import { ROUTES } from "@/lib/routes";
import {
  CUSTOMER_FIELDS,
  DATE_FIELDS,
  INVOICE_FIELDS,
  INVOICE_LABELS,
  NOTE_FIELDS,
  NUMBER_FIELDS,
  RECEIPT_FIELDS,
} from "@/lib/payments/form";
import {
  diffFields,
  offeredIn,
  onlyOffered,
  recordCreation,
  recordEdits,
} from "@/server/payments/audit";

/**
 * Every screen reads the same records — dashboard, search, upload, reports,
 * the invoice and customer screens — so a change refreshes all of them.
 *
 * Every action here then redirects, so the screen is rendered afresh from the
 * saved records rather than patched from the action's own response.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function refresh(_ids: { invoiceId?: string | null; customerId?: string | null } = {}): void {
  revalidatePath("/", "layout");
}

/** Where to go after a save: the form's own `returnTo`, if it is a local path. */
function backTo(form: FormData, fallback: string): string {
  const back = text(form, "returnTo");
  return back && back.startsWith("/") && !back.startsWith("//") ? back : fallback;
}

// ---------------------------------------------------------------------------
// Reading form fields
// ---------------------------------------------------------------------------

/** A text field, or null when it is blank. Never undefined, so blanks clear. */
function text(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * A number field, accepting what a person types.
 *
 * "1,23,456.78", "$ 26,351.56" and "26351.56" all mean the same amount, and
 * refusing the first two would be refusing the way these figures are actually
 * written down.
 */
function num(form: FormData, key: string): number | null {
  const raw = text(form, key);
  return raw === null ? null : toNumber(raw);
}

/**
 * A date field, as a `Date` at UTC midnight.
 *
 * Midnight UTC keeps a date-only value from drifting a day when it is read
 * back, and the parser accepts "30-05-2026", "2026-05-30" and "30/05/2026" —
 * day first, as the reference sheets write them.
 */
function date(form: FormData, key: string): Date | null {
  const raw = text(form, key);
  if (raw === null) return null;
  const iso = toIsoDate(raw);
  return iso ? new Date(`${iso}T00:00:00.000Z`) : null;
}

/** Read one named field the way its type says to. */
function valueOf(form: FormData, key: string): string | number | Date | null {
  if (NUMBER_FIELDS.has(key)) return num(form, key);
  if (DATE_FIELDS.has(key)) return date(form, key);
  return text(form, key);
}

/**
 * Read a known set of fields, keeping only those the form actually carried.
 *
 * This is the one place the "a form can only change what it showed" rule is
 * implemented, so every action inherits it rather than remembering it.
 */
function fieldsFrom(form: FormData, keys: readonly string[]): Record<string, unknown> {
  const all: Record<string, unknown> = {};
  for (const key of keys) all[key] = valueOf(form, key);
  return onlyOffered(all, offeredIn(form, keys));
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function saveCustomerAction(form: FormData): Promise<void> {
  const id = text(form, "customerId");
  const data = fieldsFrom(form, CUSTOMER_FIELDS);

  if (id) {
    const before = await prisma.ptCustomer.findUnique({ where: { id } });
    if (!before) return;
    const changes = diffFields(before as unknown as Record<string, unknown>, data, INVOICE_LABELS);
    await prisma.ptCustomer.update({ where: { id }, data: data as never });
    await recordEdits({ entity: "CUSTOMER", entityId: id, customerId: id, changes });
    refresh({ customerId: id });
    redirect(backTo(form, ROUTES.customer(id)));
  }

  const created = await prisma.ptCustomer.create({ data: data as never });
  await recordCreation({
    entity: "CUSTOMER",
    entityId: created.id,
    customerId: created.id,
    values: data,
    labels: INVOICE_LABELS,
  });
  refresh({ customerId: created.id });
  redirect(ROUTES.customer(created.id));
}

/**
 * Remove a customer.
 *
 * Its invoices are kept and detached — they become "No customer recorded"
 * rather than disappearing, because deleting a name must not silently delete
 * the money. The schema's `onDelete: SetNull` does that; this only says so out
 * loud.
 */
export async function deleteCustomerAction(form: FormData): Promise<void> {
  const id = text(form, "customerId");
  if (!id) return;
  await prisma.ptCustomer.delete({ where: { id } });
  refresh();
  redirect(ROUTES.dashboard);
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------


/**
 * Create or update one invoice.
 *
 * A new customer name typed into the form creates that customer, so a record
 * can be entered in one pass without visiting a separate screen first.
 */
export async function saveInvoiceAction(form: FormData): Promise<void> {
  const id = text(form, "invoiceId");
  const customerId = await resolveCustomer(form);
  const data = fieldsFrom(form, INVOICE_FIELDS);

  if (id) {
    const before = await prisma.ptInvoice.findUnique({ where: { id } });
    if (!before) return;

    const changes = diffFields(
      before as unknown as Record<string, unknown>,
      form.has("customerId") || form.has("customerName")
        ? { ...data, customerId }
        : data,
      INVOICE_LABELS,
    );

    await prisma.ptInvoice.update({
      where: { id },
      data: (form.has("customerId") || form.has("customerName")
        ? { ...data, customerId }
        : data) as never,
    });
    await recordEdits({
      entity: "INVOICE",
      entityId: id,
      invoiceId: id,
      recordSource: before.source,
      changes,
    });
    refresh({ invoiceId: id, customerId });
    redirect(backTo(form, ROUTES.invoice(id)));
  }

  const created = await prisma.ptInvoice.create({
    data: { ...data, customerId, source: "MANUAL" } as never,
  });
  await recordCreation({
    entity: "INVOICE",
    entityId: created.id,
    invoiceId: created.id,
    recordSource: "MANUAL",
    values: data,
    labels: INVOICE_LABELS,
  });

  // receipts typed on the create form, before the invoice existed to hold them
  const receipts = Number(form.get("receiptCount") ?? 0);
  for (let i = 1; i <= receipts; i += 1) {
    const amount = num(form, `receipt${i}Amount`);
    const when = date(form, `receipt${i}Date`);
    const rate = num(form, `receipt${i}Rate`);
    const ref = text(form, `receipt${i}Ref`);
    if (amount === null && when === null && rate === null && ref === null) continue;
    const receipt = await prisma.ptReceipt.create({
      data: {
        invoiceId: created.id,
        seq: i,
        amountFcy: amount,
        receiptDate: when,
        exchangeRate: rate,
        bankRef: ref,
      },
    });
    await recordCreation({
      entity: "RECEIPT",
      entityId: receipt.id,
      invoiceId: created.id,
      recordSource: "MANUAL",
      values: { receiptDate: when, amountFcy: amount, exchangeRate: rate, bankRef: ref },
      labels: INVOICE_LABELS,
    });
  }

  refresh({ invoiceId: created.id, customerId });
  redirect(ROUTES.invoice(created.id));
}

/**
 * Which customer an invoice belongs to.
 *
 * A picked id wins; a typed name is matched case- and spacing-insensitively and
 * created if new; neither leaves the invoice unattached, which is allowed.
 */
async function resolveCustomer(form: FormData): Promise<string | null> {
  const picked = text(form, "customerId");
  if (picked) return picked;

  const typed = text(form, "customerName");
  if (!typed) return null;

  const key = typed.toLowerCase().replace(/\s+/g, " ").trim();
  const all = await prisma.ptCustomer.findMany();
  const match = all.find((c) => (c.name ?? "").toLowerCase().replace(/\s+/g, " ").trim() === key);
  if (match) return match.id;

  const created = await prisma.ptCustomer.create({
    data: { name: typed, currency: text(form, "currency") },
  });
  return created.id;
}

/**
 * Delete one invoice — its receipts, notes and history with it.
 *
 * Removed from the database, so it is gone from the dashboard, Search, the
 * customer screen and every report at once, and every total is recalculated.
 * `returnTo` brings the person back to the screen they deleted it from.
 */
export async function deleteInvoiceAction(form: FormData): Promise<void> {
  const id = text(form, "invoiceId");
  if (!id) return;
  const invoice = await prisma.ptInvoice.findUnique({ where: { id } });
  if (invoice) await prisma.ptInvoice.delete({ where: { id } });
  refresh({ customerId: invoice?.customerId });

  redirect(backTo(form, invoice?.customerId ? ROUTES.customer(invoice.customerId) : ROUTES.dashboard));
}

// ---------------------------------------------------------------------------
// Receipts — Add Receipt, with no limit
// ---------------------------------------------------------------------------

/**
 * Add or update one receipt.
 *
 * The sequence number is simply one past the highest, so Add Receipt can always
 * add another — Receipt 1, 2, 3 and on — and there is no unique constraint to
 * collide with. Deleting one leaves the others' numbers alone, because a
 * receipt's number appears in the exports people have already sent out.
 */
export async function saveReceiptAction(form: FormData): Promise<void> {
  const invoiceId = text(form, "invoiceId");
  if (!invoiceId) return;

  const id = text(form, "receiptId");
  const data = fieldsFrom(form, RECEIPT_FIELDS);

  if (id) {
    const before = await prisma.ptReceipt.findUnique({ where: { id } });
    if (!before) return;
    const changes = diffFields(before as unknown as Record<string, unknown>, data, INVOICE_LABELS);
    await prisma.ptReceipt.update({ where: { id }, data: data as never });
    await recordEdits({
      entity: "RECEIPT",
      entityId: id,
      invoiceId,
      recordSource: await sourceOf(invoiceId),
      changes,
    });
  } else {
    const last = await prisma.ptReceipt.findFirst({
      where: { invoiceId },
      orderBy: { seq: "desc" },
    });
    const created = await prisma.ptReceipt.create({
      data: { invoiceId, seq: (last?.seq ?? 0) + 1, ...data } as never,
    });
    await recordCreation({
      entity: "RECEIPT",
      entityId: created.id,
      invoiceId,
      recordSource: "MANUAL",
      values: { seq: created.seq, ...data },
      labels: INVOICE_LABELS,
    });
  }

  refresh({ invoiceId });
  redirect(backTo(form, ROUTES.invoice(invoiceId)));
}

export async function deleteReceiptAction(form: FormData): Promise<void> {
  const invoiceId = text(form, "invoiceId");
  const id = text(form, "receiptId");
  if (!invoiceId || !id) return;

  const before = await prisma.ptReceipt.findUnique({ where: { id } });
  await prisma.ptReceipt.deleteMany({ where: { id, invoiceId } });
  if (before) {
    await recordEdits({
      entity: "RECEIPT",
      entityId: id,
      invoiceId,
      recordSource: await sourceOf(invoiceId),
      changes: [
        {
          fieldKey: "receipt",
          label: `Receipt ${before.seq}`,
          from: `${before.amountFcy ?? "no amount"}${before.receiptDate ? ` on ${before.receiptDate.toISOString().slice(0, 10)}` : ""}`,
          to: null,
        },
      ],
    });
  }
  refresh({ invoiceId });
  redirect(backTo(form, ROUTES.invoice(invoiceId)));
}

// ---------------------------------------------------------------------------
// Credit and debit notes
// ---------------------------------------------------------------------------

export async function saveNoteAction(form: FormData): Promise<void> {
  const invoiceId = text(form, "invoiceId");
  if (!invoiceId) return;

  const id = text(form, "noteId");
  const data = fieldsFrom(form, NOTE_FIELDS);
  // the one field with a fixed vocabulary, so it is normalised rather than trusted
  if ("noteType" in data) data.noteType = data.noteType === "DEBIT" ? "DEBIT" : "CREDIT";

  if (id) {
    const before = await prisma.ptNote.findUnique({ where: { id } });
    if (!before) return;
    const changes = diffFields(before as unknown as Record<string, unknown>, data, INVOICE_LABELS);
    await prisma.ptNote.update({ where: { id }, data: data as never });
    await recordEdits({
      entity: "NOTE",
      entityId: id,
      invoiceId,
      recordSource: await sourceOf(invoiceId),
      changes,
    });
  } else {
    const created = await prisma.ptNote.create({ data: { invoiceId, ...data } as never });
    await recordCreation({
      entity: "NOTE",
      entityId: created.id,
      invoiceId,
      recordSource: "MANUAL",
      values: data,
      labels: INVOICE_LABELS,
    });
  }

  refresh({ invoiceId });
  redirect(backTo(form, ROUTES.invoice(invoiceId)));
}

export async function deleteNoteAction(form: FormData): Promise<void> {
  const invoiceId = text(form, "invoiceId");
  const id = text(form, "noteId");
  if (!invoiceId || !id) return;

  const before = await prisma.ptNote.findUnique({ where: { id } });
  await prisma.ptNote.deleteMany({ where: { id, invoiceId } });
  if (before) {
    await recordEdits({
      entity: "NOTE",
      entityId: id,
      invoiceId,
      recordSource: await sourceOf(invoiceId),
      changes: [
        {
          fieldKey: "note",
          label: before.noteType === "DEBIT" ? "Debit note" : "Credit note",
          from: `${before.noteNo ?? "no number"} · ${before.amount ?? "no amount"}`,
          to: null,
        },
      ],
    });
  }
  refresh({ invoiceId });
  redirect(backTo(form, ROUTES.invoice(invoiceId)));
}

/** Where an invoice's record came from, for the history entry. */
async function sourceOf(invoiceId: string): Promise<string | null> {
  const invoice = await prisma.ptInvoice.findUnique({
    where: { id: invoiceId },
    select: { source: true },
  });
  return invoice?.source ?? null;
}
