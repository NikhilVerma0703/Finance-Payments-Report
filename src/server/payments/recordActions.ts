/**
 * Saving the full record form — New Record and EDIT OR ADD EXTRA INFORMATIONS.
 *
 * One action for both, so a record typed by hand and a record brought in from a
 * sheet are completed, corrected and recalculated the same way. Every change
 * goes into the correction history, an imported record keeps its source and its
 * receipts, and nothing is calculated here: the figures are worked out from the
 * stored fields whenever any screen reads them.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { INVOICE_LABELS } from "@/lib/payments/form";
import { nameKey, parseRecordForm, type FieldValue, type ParsedLine } from "@/lib/payments/recordForm";
import { ROUTES } from "@/lib/routes";
import { diffFields, recordCreation, recordEdits } from "@/server/payments/audit";

export interface RecordSaveState {
  ok: boolean;
  message: string;
  errors: string[];
}

/** Dates travel as YYYY-MM-DD and are stored at UTC midnight. */
function forDb(values: Record<string, FieldValue>, dateKeys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = dateKeys.includes(k) && typeof v === "string" ? new Date(`${v}T00:00:00.000Z`) : v;
  }
  return out;
}

const INVOICE_DATES = [
  "invoiceDate",
  "enteredDueDate",
  "docsPresentedDate",
  "shippingBillDate",
  "blDate",
  "eta",
] as const;

export async function saveRecordAction(
  _prev: RecordSaveState | null,
  form: FormData,
): Promise<RecordSaveState> {
  const parsed = parseRecordForm(form);
  if (parsed.errors.length) {
    return {
      ok: false,
      message: "Nothing was saved. Correct the entries below and save again.",
      errors: parsed.errors,
    };
  }

  const invoiceId = (form.get("invoiceId") as string | null)?.trim() || null;
  const existing = invoiceId
    ? await prisma.ptInvoice.findUnique({
        where: { id: invoiceId },
        include: { receipts: true, notes: true },
      })
    : null;
  if (invoiceId && !existing) {
    return { ok: false, message: "This invoice no longer exists — it may have been deleted.", errors: [] };
  }

  // ---- which customer: picked, matched by name, or new
  let customerId: string | null = existing?.customerId ?? null;
  let newCustomerName: string | null = null;
  if (parsed.customer.offered) {
    if (parsed.customer.pickedId) {
      const found = await prisma.ptCustomer.findUnique({ where: { id: parsed.customer.pickedId } });
      customerId = found?.id ?? null;
    } else if (parsed.customer.typedName) {
      const all = await prisma.ptCustomer.findMany({ select: { id: true, name: true } });
      const match = all.find((c) => nameKey(c.name) === nameKey(parsed.customer.typedName));
      customerId = match?.id ?? null;
      if (!match) newCustomerName = parsed.customer.typedName;
    } else {
      customerId = null;
    }
  }

  // ---- no duplicate invoice numbers within one customer (a new customer has none)
  const number = (parsed.invoice.invoiceNo as string | null | undefined) ?? existing?.invoiceNo ?? null;
  if (number && !newCustomerName) {
    const clash = await prisma.ptInvoice.findFirst({
      where: {
        invoiceNo: number,
        customerId,
        ...(invoiceId ? { NOT: { id: invoiceId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      return {
        ok: false,
        message: `Invoice ${number} already exists for this customer. Open that record to edit it instead of creating a second one.`,
        errors: [`Duplicate invoice number ${number}.`],
      };
    }
  }

  let createdCustomer = false;
  if (newCustomerName) {
    const created = await prisma.ptCustomer.create({
      data: {
        ...(parsed.customer.fields as Record<string, string | null>),
        name: newCustomerName,
        currency:
          (parsed.customer.fields.currency as string | null | undefined) ??
          (parsed.invoice.currency as string | null | undefined) ??
          null,
      },
    });
    customerId = created.id;
    createdCustomer = true;
    await recordCreation({
      entity: "CUSTOMER",
      entityId: created.id,
      customerId: created.id,
      values: { name: created.name, ...parsed.customer.fields },
      labels: INVOICE_LABELS,
    });
  }

  // ---- the customer's own fields
  if (customerId && !createdCustomer && Object.keys(parsed.customer.fields).length) {
    const before = await prisma.ptCustomer.findUnique({ where: { id: customerId } });
    if (before) {
      const changes = diffFields(
        before as unknown as Record<string, unknown>,
        parsed.customer.fields,
        INVOICE_LABELS,
      );
      if (changes.length) {
        await prisma.ptCustomer.update({ where: { id: customerId }, data: parsed.customer.fields as never });
        await recordEdits({ entity: "CUSTOMER", entityId: customerId, customerId, changes });
      }
    }
  }

  // ---- the invoice
  const invoiceData = forDb(parsed.invoice, INVOICE_DATES);
  let id: string;
  let source: string;

  if (existing) {
    id = existing.id;
    source = existing.source;
    const next = parsed.customer.offered ? { ...invoiceData, customerId } : invoiceData;
    const changes = diffFields(existing as unknown as Record<string, unknown>, next, INVOICE_LABELS);
    if (changes.length) {
      await prisma.ptInvoice.update({ where: { id }, data: next as never });
      await recordEdits({ entity: "INVOICE", entityId: id, invoiceId: id, recordSource: source, changes });
    }
  } else {
    const created = await prisma.ptInvoice.create({
      data: { ...invoiceData, customerId, source: "MANUAL" } as never,
    });
    id = created.id;
    source = "MANUAL";
    await recordCreation({
      entity: "INVOICE",
      entityId: id,
      invoiceId: id,
      recordSource: "MANUAL",
      values: invoiceData,
      labels: INVOICE_LABELS,
    });
  }

  // ---- receipts and notes
  const counts = { added: 0, updated: 0, removed: 0 };
  await saveLines({
    kind: "RECEIPT",
    lines: parsed.receipts,
    stored: existing?.receipts ?? [],
    invoiceId: id,
    source,
    counts,
  });
  await saveLines({
    kind: "NOTE",
    lines: parsed.notes,
    stored: existing?.notes ?? [],
    invoiceId: id,
    source,
    counts,
  });

  revalidatePath("/", "layout");
  redirect(`${ROUTES.invoice(id)}?saved=${existing ? "updated" : "created"}`);
}

async function saveLines(args: {
  kind: "RECEIPT" | "NOTE";
  lines: ParsedLine[];
  stored: Array<{ id: string; seq?: number } & Record<string, unknown>>;
  invoiceId: string;
  source: string;
  counts: { added: number; updated: number; removed: number };
}): Promise<void> {
  const { kind, lines, stored, invoiceId, source, counts } = args;
  const dates = kind === "RECEIPT" ? ["receiptDate"] : ["noteDate"];
  let nextSeq = Math.max(0, ...stored.map((s) => Number(s.seq ?? 0)));

  for (const line of lines) {
    const before = line.id ? stored.find((s) => s.id === line.id) : undefined;
    if (line.id && !before) continue; // not this invoice's line

    if (before && line.remove) {
      if (kind === "RECEIPT") await prisma.ptReceipt.delete({ where: { id: before.id } });
      else await prisma.ptNote.delete({ where: { id: before.id } });
      await recordEdits({
        entity: kind,
        entityId: before.id,
        invoiceId,
        recordSource: source,
        changes: [
          {
            fieldKey: kind === "RECEIPT" ? "receipt" : "note",
            label: kind === "RECEIPT" ? `Receipt ${before.seq ?? ""}`.trim() : "Credit/debit note",
            from: `${before.amountFcy ?? before.amount ?? "no amount"}`,
            to: null,
          },
        ],
      });
      counts.removed += 1;
      continue;
    }

    const data = forDb(line.values, dates);

    if (before) {
      const changes = diffFields(before, data, INVOICE_LABELS);
      if (!changes.length) continue;
      if (kind === "RECEIPT") await prisma.ptReceipt.update({ where: { id: before.id }, data: data as never });
      else await prisma.ptNote.update({ where: { id: before.id }, data: data as never });
      await recordEdits({
        entity: kind,
        entityId: before.id,
        invoiceId,
        recordSource: source,
        changes: changes.map((c) => ({
          ...c,
          label: kind === "RECEIPT" ? `Receipt ${before.seq} ${c.label.toLowerCase()}` : c.label,
        })),
      });
      counts.updated += 1;
      continue;
    }

    // a new line: only if something was typed into it
    if (!line.hasContent) continue;
    if (kind === "RECEIPT") {
      nextSeq += 1;
      const created = await prisma.ptReceipt.create({
        data: { invoiceId, seq: nextSeq, ...data } as never,
      });
      await recordCreation({
        entity: kind,
        entityId: created.id,
        invoiceId,
        recordSource: "MANUAL",
        values: { seq: nextSeq, ...data },
        labels: INVOICE_LABELS,
      });
    } else {
      const created = await prisma.ptNote.create({
        data: { invoiceId, noteType: "CREDIT", ...data } as never,
      });
      await recordCreation({
        entity: kind,
        entityId: created.id,
        invoiceId,
        recordSource: "MANUAL",
        values: data,
        labels: INVOICE_LABELS,
      });
    }
    counts.added += 1;
  }
}
