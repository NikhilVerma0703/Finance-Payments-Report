/**
 * Money held on account: booking it against a customer, and attributing it to
 * invoices afterwards.
 *
 * An attribution is an ordinary receipt (or credit/debit note) on the invoice,
 * carrying `onAccountId`, so every figure the invoice already shows — balance,
 * forex, status, ageing — takes it in without knowing it came from here. Taking
 * one back is deleting that receipt or note, and the amount is on account again,
 * because what is left to attribute is never stored, only worked out.
 *
 * Every change is recorded: on the customer's history for the entry itself, and
 * on the invoice's history for what was attributed to it.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { round2, toIsoDate, toNumber } from "@/lib/text";
import { ROUTES } from "@/lib/routes";
import { INVOICE_LABELS } from "@/lib/payments/form";
import {
  attributionAmount,
  buildOnAccount,
  currenciesFit,
  isOnAccountKind,
  ON_ACCOUNT_LABELS,
  type OnAccountKind,
} from "@/lib/payments/onAccount";
import { diffFields, offeredIn, onlyOffered, recordCreation, recordEdits } from "@/server/payments/audit";
import { loadTracking } from "@/server/payments/query";

/** The entry's editable fields, as its forms name them. */
const ENTRY_FIELDS = ["kind", "entryDate", "amount", "currency", "exchangeRate", "reference", "remarks"] as const;

const LABELS: Record<string, string> = {
  kind: "Type",
  entryDate: "Date",
  amount: "Amount",
  currency: "Currency",
  exchangeRate: "Exchange rate",
  reference: "Reference",
  remarks: "Remarks",
};

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
  const iso = raw === null ? null : toIsoDate(raw);
  return iso ? new Date(`${iso}T00:00:00.000Z`) : null;
}

/** Back to the screen the form was on, with a message for it to show. */
function back(form: FormData, fallback: string, message?: string): never {
  revalidatePath("/", "layout");
  const raw = text(form, "returnTo");
  const to = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
  if (!message) redirect(to);
  const [path, hash] = to.split("#");
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}onAccount=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`);
}

const where = (customerId: string) => `${ROUTES.customer(customerId)}#on-account`;

/** Add an entry, or correct one. */
export async function saveOnAccountAction(form: FormData): Promise<void> {
  const customerId = text(form, "customerId");
  if (!customerId) return;
  const id = text(form, "onAccountId");

  const values: Record<string, unknown> = {
    kind: isOnAccountKind(text(form, "kind")) ? text(form, "kind") : "RECEIPT",
    entryDate: date(form, "entryDate"),
    amount: num(form, "amount"),
    currency: text(form, "currency")?.toUpperCase() ?? null,
    exchangeRate: num(form, "exchangeRate"),
    reference: text(form, "reference"),
    remarks: text(form, "remarks"),
  };
  const data = onlyOffered(values, offeredIn(form, ENTRY_FIELDS));

  if (id) {
    const before = await prisma.ptOnAccount.findUnique({ where: { id } });
    if (!before) back(form, where(customerId));
    await prisma.ptOnAccount.update({ where: { id }, data: data as never });
    await recordEdits({
      entity: "ON_ACCOUNT",
      entityId: id,
      customerId,
      changes: diffFields(before as unknown as Record<string, unknown>, data, LABELS),
    });
    back(form, where(customerId), "Entry saved.");
  }

  if (data.amount === null || data.amount === undefined) {
    back(form, where(customerId), "Nothing added: an amount is needed to hold money on account.");
  }

  const created = await prisma.ptOnAccount.create({ data: { customerId, ...data } as never });
  await recordCreation({
    entity: "ON_ACCOUNT",
    entityId: created.id,
    customerId,
    values: data,
    labels: LABELS,
  });
  back(form, where(customerId), `${ON_ACCOUNT_LABELS[created.kind as OnAccountKind] ?? "Entry"} added on account.`);
}

/**
 * Delete an entry, and take back everything attributed from it.
 *
 * Its receipts and notes on invoices go with it — they are the same money, and
 * leaving them would keep a payment on an invoice that nobody can trace to a
 * remittance any more. The screen says so before the second click.
 */
export async function deleteOnAccountAction(form: FormData): Promise<void> {
  const id = text(form, "onAccountId");
  if (!id) return;
  const entry = await prisma.ptOnAccount.findUnique({
    where: { id },
    include: { receipts: true, notes: true },
  });
  if (!entry) return;

  for (const r of entry.receipts) {
    await prisma.ptReceipt.delete({ where: { id: r.id } });
    await recordEdits({
      entity: "RECEIPT",
      entityId: r.id,
      invoiceId: r.invoiceId,
      changes: [{ fieldKey: "receipt", label: `Receipt ${r.seq} (on account)`, from: String(r.amountFcy ?? ""), to: null }],
    });
  }
  for (const n of entry.notes) {
    await prisma.ptNote.delete({ where: { id: n.id } });
    await recordEdits({
      entity: "NOTE",
      entityId: n.id,
      invoiceId: n.invoiceId,
      changes: [{ fieldKey: "note", label: `${n.noteType === "DEBIT" ? "Debit" : "Credit"} note (on account)`, from: String(n.amount ?? ""), to: null }],
    });
  }

  await prisma.ptOnAccount.delete({ where: { id } });
  await recordEdits({
    entity: "ON_ACCOUNT",
    entityId: id,
    customerId: entry.customerId,
    changes: [
      {
        fieldKey: "entry",
        label: ON_ACCOUNT_LABELS[entry.kind as OnAccountKind] ?? "Entry on account",
        from: `${entry.amount ?? "no amount"}${entry.reference ? ` · ${entry.reference}` : ""}`,
        to: null,
      },
    ],
  });
  back(form, where(entry.customerId), "Entry deleted, with what had been attributed from it.");
}

/**
 * Attribute part or all of an entry to one invoice.
 *
 * Checked against the records as they are now, not as the screen last showed
 * them: the invoice must be the same customer's and in a currency the entry
 * can pay, and no more can be attributed than is left. A typed amount above
 * that is cut down to it, and the screen says so.
 */
export async function attributeOnAccountAction(form: FormData): Promise<void> {
  const id = text(form, "onAccountId");
  const invoiceId = text(form, "invoiceId");
  const fallback = text(form, "customerId");
  if (!id) return;

  const view = await loadTracking();
  const stored = view.onAccount.find((e) => e.id === id);
  if (!stored) back(form, fallback ? where(fallback) : ROUTES.dashboard, "That entry no longer exists.");
  // rebuilt from the database, not the request's cached view of it
  const fresh = await prisma.ptOnAccount.findUnique({
    where: { id },
    include: { receipts: true, notes: true },
  });
  if (!fresh) back(form, where(stored.customerId), "That entry no longer exists.");
  const entry = buildOnAccount({
    ...stored,
    amount: fresh.amount,
    attributions: [
      ...fresh.receipts.map((r) => ({ id: r.id, invoiceId: r.invoiceId, invoiceNo: null, amount: r.amountFcy ?? 0 })),
      ...fresh.notes.map((n) => ({ id: n.id, invoiceId: n.invoiceId, invoiceNo: null, amount: n.amount ?? 0 })),
    ],
  });

  if (!invoiceId) back(form, where(entry.customerId), "Choose the invoice to attribute it to.");
  const invoice = view.invoices.find((i) => i.id === invoiceId);
  if (!invoice || invoice.customerId !== entry.customerId) {
    back(form, where(entry.customerId), "That invoice is not this customer's.");
  }
  if (!currenciesFit(entry.currency, invoice.currency)) {
    back(
      form,
      where(entry.customerId),
      `The entry is in ${entry.currency} and invoice ${invoice.invoiceNo ?? ""} is in ${invoice.currency}; it cannot be attributed there.`,
    );
  }

  const { amount, capped } = attributionAmount({
    kind: entry.kind,
    unattributed: entry.unattributed,
    invoiceOutstanding: invoice.money.calculatedOutstanding,
    typed: num(form, "amount"),
  });
  if (amount <= 0) {
    back(
      form,
      where(entry.customerId),
      entry.unattributed <= 0 ? "Nothing is left on that entry to attribute." : "Nothing attributed: the amount must be above zero.",
    );
  }

  const remark = `On account${entry.reference ? ` · ${entry.reference}` : ""}${entry.entryDate ? ` · ${entry.entryDate}` : ""}`;
  const when = entry.entryDate ? new Date(`${entry.entryDate}T00:00:00.000Z`) : null;

  if (entry.kind === "RECEIPT") {
    const last = await prisma.ptReceipt.findFirst({ where: { invoiceId }, orderBy: { seq: "desc" } });
    const values = {
      receiptDate: when,
      amountFcy: amount,
      exchangeRate: entry.exchangeRate,
      bankRef: entry.reference,
      remarks: entry.remarks ? `${remark} · ${entry.remarks}` : remark,
    };
    const receipt = await prisma.ptReceipt.create({
      data: { invoiceId, seq: (last?.seq ?? 0) + 1, onAccountId: id, ...values },
    });
    await recordCreation({
      entity: "RECEIPT",
      entityId: receipt.id,
      invoiceId,
      recordSource: "MANUAL",
      values: { seq: receipt.seq, ...values },
      labels: INVOICE_LABELS,
    });
  } else {
    const values = {
      noteType: entry.kind,
      noteNo: entry.reference,
      noteDate: when,
      amount,
      reason: entry.remarks ? `${remark} · ${entry.remarks}` : remark,
    };
    const note = await prisma.ptNote.create({ data: { invoiceId, onAccountId: id, ...values } });
    await recordCreation({
      entity: "NOTE",
      entityId: note.id,
      invoiceId,
      recordSource: "MANUAL",
      values,
      labels: INVOICE_LABELS,
    });
  }

  await recordEdits({
    entity: "ON_ACCOUNT",
    entityId: id,
    customerId: entry.customerId,
    changes: [
      {
        fieldKey: "attributed",
        label: `Attributed to invoice ${invoice.invoiceNo ?? "(no number)"}`,
        from: null,
        to: String(amount),
      },
    ],
  });

  const left = round2(entry.unattributed - amount);
  back(
    form,
    where(entry.customerId),
    `${formatMoney(amount, entry.currency)} attributed to ${invoice.invoiceNo ?? "the invoice"}` +
      (capped ? " — the amount typed was more than was left, so it was cut down to that" : "") +
      `. ${left > 0 ? `${formatMoney(left, entry.currency)} is still on account.` : "Nothing is left on account from that entry."}`,
  );
}
