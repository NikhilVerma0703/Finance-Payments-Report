/**
 * Money held on account: received from a customer, or a note raised to one,
 * before it has been attributed to an invoice.
 *
 * Pure: no database, no React. The rule this file holds is that the
 * unattributed part is never stored. An entry's attributions are the receipts
 * and notes on invoices that point back at it, so
 *
 *     Unattributed = Amount − Σ attributed
 *
 * is worked out every time it is read, and attributing, un-attributing (deleting
 * that receipt from its invoice) and correcting the amount all keep it right
 * without a second figure to update.
 *
 * What it does to the customer's position: a payment or a credit note held on
 * account reduces what the customer owes, a debit note increases it — exactly
 * as they would on an invoice — so
 *
 *     Net outstanding = Σ invoice outstanding − Σ unattributed credit
 *     Unattributed credit = payments + credit notes − debit notes
 */
import { round2 } from "../text";

export type OnAccountKind = "RECEIPT" | "CREDIT" | "DEBIT";

export const ON_ACCOUNT_KINDS: OnAccountKind[] = ["RECEIPT", "CREDIT", "DEBIT"];

export const ON_ACCOUNT_LABELS: Record<OnAccountKind, string> = {
  RECEIPT: "Payment received",
  CREDIT: "Credit note",
  DEBIT: "Debit note",
};

export function isOnAccountKind(v: unknown): v is OnAccountKind {
  return v === "RECEIPT" || v === "CREDIT" || v === "DEBIT";
}

export interface Attribution {
  /** The receipt's or note's own id, so it can be undone. */
  id: string;
  invoiceId: string;
  invoiceNo: string | null;
  amount: number;
}

export interface OnAccountInput {
  id: string;
  customerId: string;
  customerName: string | null;
  kind: OnAccountKind;
  entryDate: string | null;
  amount: number | null;
  /** The entry's own currency, or the customer's where it states none. */
  currency: string | null;
  exchangeRate: number | null;
  reference: string | null;
  remarks: string | null;
  attributions: Attribution[];
}

export interface OnAccountEntry extends OnAccountInput {
  attributed: number;
  /** What is still to be attributed. Never below zero. */
  unattributed: number;
  /** Over-attributed: more was attributed than the entry is for. */
  excess: number;
  /** The unattributed part's effect on what the customer owes, as a credit. */
  credit: number;
}

export function buildOnAccount(input: OnAccountInput): OnAccountEntry {
  const amount = input.amount ?? 0;
  const attributed = round2(input.attributions.reduce((s, a) => s + a.amount, 0));
  const left = round2(amount - attributed);
  const unattributed = left > 0.004 ? left : 0;
  return {
    ...input,
    attributed,
    unattributed,
    excess: left < -0.004 ? round2(-left) : 0,
    credit: input.kind === "DEBIT" ? -unattributed : unattributed,
  };
}

export interface OnAccountTotals {
  entries: number;
  /** Unattributed payments. */
  receipts: number;
  credits: number;
  debits: number;
  /** receipts + credits − debits: how much less the customer owes than its invoices say. */
  net: number;
}

/** The unattributed totals of a set of entries, all in one currency. */
export function onAccountTotals(entries: OnAccountEntry[]): OnAccountTotals {
  const t: OnAccountTotals = { entries: 0, receipts: 0, credits: 0, debits: 0, net: 0 };
  for (const e of entries) {
    if (e.unattributed <= 0) continue;
    t.entries += 1;
    if (e.kind === "RECEIPT") t.receipts = round2(t.receipts + e.unattributed);
    else if (e.kind === "CREDIT") t.credits = round2(t.credits + e.unattributed);
    else t.debits = round2(t.debits + e.unattributed);
  }
  t.net = round2(t.receipts + t.credits - t.debits);
  return t;
}

/**
 * How much of an entry goes to one invoice.
 *
 * A typed amount is used as typed, but never more than is left on the entry.
 * Left blank, a payment or a credit note takes as much as the invoice still
 * owes, up to what is left; a debit note takes all that is left, because it
 * adds to a balance rather than paying one off.
 */
export function attributionAmount(args: {
  kind: OnAccountKind;
  unattributed: number;
  invoiceOutstanding: number | null;
  typed: number | null;
}): { amount: number; capped: boolean } {
  const { kind, unattributed, invoiceOutstanding, typed } = args;
  if (unattributed <= 0) return { amount: 0, capped: false };
  if (typed !== null) {
    if (typed <= 0) return { amount: 0, capped: false };
    return typed > unattributed + 0.004
      ? { amount: unattributed, capped: true }
      : { amount: round2(typed), capped: false };
  }
  if (kind === "DEBIT") return { amount: unattributed, capped: false };
  const owing = invoiceOutstanding !== null && invoiceOutstanding > 0 ? invoiceOutstanding : unattributed;
  return { amount: round2(Math.min(unattributed, owing)), capped: false };
}

/**
 * Can an entry be attributed to an invoice in this currency?
 *
 * The same currency, or either side not yet knowing its own: money in dollars
 * cannot pay off a euro invoice, but an invoice with no currency recorded is
 * not refused for it.
 */
export function currenciesFit(entry: string | null, invoice: string | null): boolean {
  return !entry || !invoice || entry.toUpperCase() === invoice.toUpperCase();
}
