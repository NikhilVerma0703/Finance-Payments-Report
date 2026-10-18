/**
 * Saving a whole customer register in one go.
 *
 * This is the screen that replaces the Excel sheet, so it behaves like one: a
 * grid of every invoice for one customer with its receipts laid out in columns,
 * edited wherever the cursor lands, saved once. The alternative — a separate
 * form per row — would mean a round trip for every cell corrected, which is
 * exactly the friction that keeps people in Excel.
 *
 * Field names carry their own address, because a grid has no other way to say
 * which cell a value came from:
 *
 *     inv.<invoiceId>.<field>                 an invoice's own field
 *     rcpt.<invoiceId>.<seq>.<field>          one receipt, by its number
 *     note.<invoiceId>.<CREDIT|DEBIT>.amount  the single CN or DN adjustment
 *
 * Three rules it keeps, each learned from a specific way this goes wrong:
 *
 * **Only what the form carried is written.** The same rule as every other write
 * in this section: a cell the register did not render cannot be blanked by a
 * save. In a grid this matters more, not less — an invoice with four receipts
 * shown in three columns must not lose the fourth.
 *
 * **An id must belong to this customer.** Every invoice id in the posted form
 * is checked against the customer's own invoices before anything is written.
 * A grid posts dozens of ids, and a form is editable by whoever has the page.
 *
 * **An empty new receipt is not a receipt.** The register always offers one
 * blank receipt column so a payment can be entered without visiting another
 * screen. Rows where nobody typed anything are skipped, not saved as a receipt
 * of nothing.
 */
"use server";


import { prisma } from "@/lib/db";
import { toIsoDate, toNumber } from "@/lib/text";
import { DATE_FIELDS, INVOICE_LABELS, NUMBER_FIELDS } from "@/lib/payments/form";
import { diffFields, recordCreation, recordEdits } from "@/server/payments/audit";

/** The invoice fields the register itself may change. */
const REGISTER_INVOICE_FIELDS = [
  "invoiceNo",
  "invoiceDate",
  "customerInvoiceValue",
  "customsInvoiceValue",
  "exchangeRate",
  "currency",
  "paymentTerms",
  "enteredDueDate",
  "docsPresentedDate",
  "blNo",
  "blDate",
  "eta",
  "poNo",
  "containerNo",
  "booksBalance",
  "remarks",
] as const;

/** One receipt's fields, as the register's five columns. */
const REGISTER_RECEIPT_FIELDS = ["receiptDate", "amountFcy", "exchangeRate", "bankRef"] as const;

function text(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function num(form: FormData, key: string): number | null {
  const raw = text(form, key);
  return raw === null ? null : toNumber(raw);
}

function date(form: FormData, key: string): Date | null {
  const raw = text(form, key);
  if (raw === null) return null;
  const iso = toIsoDate(raw);
  return iso ? new Date(`${iso}T00:00:00.000Z`) : null;
}

function valueOf(form: FormData, key: string, field: string): string | number | Date | null {
  if (NUMBER_FIELDS.has(field)) return num(form, key);
  if (DATE_FIELDS.has(field)) return date(form, key);
  return text(form, key);
}

export interface RegisterSaveState {
  ok: boolean;
  message: string;
}

/**
 * Apply every change made in one customer's register.
 *
 * Returns a sentence saying what moved, because a grid save that reports
 * nothing leaves a person unsure whether the figure they typed went in.
 */
export async function saveCustomerRegisterAction(
  _prev: RegisterSaveState | null,
  form: FormData,
): Promise<RegisterSaveState> {
  const customerId = text(form, "customerId");
  if (!customerId) return { ok: false, message: "No customer on the form." };

  // the invoices this customer actually owns — the only ones this save may touch
  const owned = await prisma.ptInvoice.findMany({
    where: { customerId },
    include: { receipts: true, notes: true },
  });
  const byId = new Map(owned.map((i) => [i.id, i]));

  let invoicesChanged = 0;
  let fieldsChanged = 0;
  let receiptsAdded = 0;
  let receiptsChanged = 0;
  let notesTouched = 0;

  // ---- invoice fields -----------------------------------------------------
  for (const invoice of owned) {
    const data: Record<string, unknown> = {};
    for (const field of REGISTER_INVOICE_FIELDS) {
      const key = `inv.${invoice.id}.${field}`;
      if (!form.has(key)) continue; // the register did not show this cell
      data[field] = valueOf(form, key, field);
    }
    if (Object.keys(data).length === 0) continue;

    const changes = diffFields(
      invoice as unknown as Record<string, unknown>,
      data,
      INVOICE_LABELS,
    );
    if (changes.length === 0) continue;

    await prisma.ptInvoice.update({ where: { id: invoice.id }, data: data as never });
    await recordEdits({
      entity: "INVOICE",
      entityId: invoice.id,
      invoiceId: invoice.id,
      recordSource: invoice.source,
      changes,
    });
    invoicesChanged += 1;
    fieldsChanged += changes.length;
  }

  // ---- receipts -----------------------------------------------------------
  // every rcpt.* key on the form, grouped by invoice and receipt number
  const receiptKeys = new Map<string, Set<number>>();
  for (const key of form.keys()) {
    const m = /^rcpt\.([^.]+)\.(\d+)\./.exec(key);
    if (!m) continue;
    const [, invoiceId, seqRaw] = m;
    if (!byId.has(invoiceId)) continue; // not this customer's invoice
    const set = receiptKeys.get(invoiceId) ?? new Set<number>();
    set.add(Number(seqRaw));
    receiptKeys.set(invoiceId, set);
  }

  for (const [invoiceId, seqs] of receiptKeys) {
    const invoice = byId.get(invoiceId)!;
    for (const seq of [...seqs].sort((a, b) => a - b)) {
      const prefix = `rcpt.${invoiceId}.${seq}.`;
      const data: Record<string, unknown> = {};
      for (const field of REGISTER_RECEIPT_FIELDS) {
        const key = prefix + field;
        if (!form.has(key)) continue;
        data[field] = valueOf(form, key, field);
      }
      if (Object.keys(data).length === 0) continue;

      const existing = invoice.receipts.find((r) => r.seq === seq);

      if (existing) {
        const changes = diffFields(
          existing as unknown as Record<string, unknown>,
          data,
          INVOICE_LABELS,
        );
        if (changes.length === 0) continue;
        await prisma.ptReceipt.update({ where: { id: existing.id }, data: data as never });
        await recordEdits({
          entity: "RECEIPT",
          entityId: existing.id,
          invoiceId,
          recordSource: invoice.source,
          changes: changes.map((c) => ({ ...c, label: `Receipt ${seq} ${c.label.toLowerCase()}` })),
        });
        receiptsChanged += 1;
        continue;
      }

      // a new receipt: only if somebody actually typed something into it
      if (Object.values(data).every((v) => v === null)) continue;

      const created = await prisma.ptReceipt.create({
        data: { invoiceId, seq, ...data } as never,
      });
      await recordCreation({
        entity: "RECEIPT",
        entityId: created.id,
        invoiceId,
        recordSource: "MANUAL",
        values: { seq, ...data },
        labels: INVOICE_LABELS,
      });
      receiptsAdded += 1;
    }
  }

  // ---- the single CN / DN adjustment -------------------------------------
  // The register offers one CN and one DN cell per invoice, which covers the
  // ordinary case. An invoice already carrying two or more notes of a type is
  // rendered read-only there, so its cell never reaches this loop and the notes
  // stay as they are — the invoice screen edits them individually.
  for (const invoice of owned) {
    for (const noteType of ["CREDIT", "DEBIT"] as const) {
      const key = `note.${invoice.id}.${noteType}.amount`;
      if (!form.has(key)) continue;

      const amount = num(form, key);
      const mine = invoice.notes.filter((n) => n.noteType === noteType);
      if (mine.length > 1) continue; // guarded in the UI; belt and braces here
      const existing = mine[0];
      const label = noteType === "CREDIT" ? "Credit note" : "Debit note";

      if (existing) {
        if ((existing.amount ?? null) === amount) continue;
        if (amount === null) {
          await prisma.ptNote.delete({ where: { id: existing.id } });
          await recordEdits({
            entity: "NOTE",
            entityId: existing.id,
            invoiceId: invoice.id,
            recordSource: invoice.source,
            changes: [
              { fieldKey: "amount", label, from: String(existing.amount ?? ""), to: null },
            ],
          });
        } else {
          await prisma.ptNote.update({ where: { id: existing.id }, data: { amount } });
          await recordEdits({
            entity: "NOTE",
            entityId: existing.id,
            invoiceId: invoice.id,
            recordSource: invoice.source,
            changes: [
              {
                fieldKey: "amount",
                label,
                from: existing.amount === null ? null : String(existing.amount),
                to: String(amount),
              },
            ],
          });
        }
        notesTouched += 1;
        continue;
      }

      if (amount === null) continue;
      const created = await prisma.ptNote.create({
        data: { invoiceId: invoice.id, noteType, amount },
      });
      await recordCreation({
        entity: "NOTE",
        entityId: created.id,
        invoiceId: invoice.id,
        recordSource: "MANUAL",
        values: { noteType, amount },
        labels: { ...INVOICE_LABELS, amount: label },
      });
      notesTouched += 1;
    }
  }

  // the register refreshes the screen itself once it has this result; every
  // other screen reads the records afresh when it is opened

  const parts: string[] = [];
  if (fieldsChanged) parts.push(`${fieldsChanged} field(s) on ${invoicesChanged} invoice(s)`);
  if (receiptsAdded) parts.push(`${receiptsAdded} receipt(s) added`);
  if (receiptsChanged) parts.push(`${receiptsChanged} receipt(s) updated`);
  if (notesTouched) parts.push(`${notesTouched} note(s) adjusted`);

  return parts.length
    ? {
        ok: true,
        message: `Saved: ${parts.join(", ")}. Totals, balances, forex and status recalculated.`,
      }
    : { ok: true, message: "Nothing had changed." };
}
