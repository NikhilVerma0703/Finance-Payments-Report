/**
 * The money arithmetic for the Payment Tracking section.
 *
 * ---------------------------------------------------------------------------
 * The exchange-rate convention, stated once
 * ---------------------------------------------------------------------------
 * Every rate in this section is **home currency per one unit of foreign
 * currency** — 83.25 means ₹83.25 to the dollar. It is written down here
 * because a forex figure whose direction is ambiguous is worse than no forex
 * figure: the sign flips, and a gain is reported as a loss.
 *
 * From that single convention everything else follows:
 *
 *     Home value of the invoice   = Invoice Value (FCY) × Invoice Rate
 *     Home value of a receipt     = Receipt FCY × Receipt Rate
 *     Exchange Rate Difference    = Receipt Rate − Invoice Rate
 *     Forex Gain / Loss           = Difference × Receipt FCY
 *
 * A positive difference means more home currency arrived per unit of foreign
 * currency than the invoice was booked at, so a positive figure is a **gain**.
 * The gain is per receipt, because each receipt arrives on its own day at its
 * own rate; the invoice-level figure is their sum and nothing more.
 *
 * ---------------------------------------------------------------------------
 * Outstanding, and not counting anything twice
 * ---------------------------------------------------------------------------
 *     Calculated Outstanding = Invoice Value − Σ Receipts − Σ CN + Σ DN
 *
 * All four terms are in the invoice's own currency. A credit note reduces what
 * the customer owes; a debit note increases it.
 *
 * **Balance as per Books is never part of that sum.** It is a figure entered
 * from the books, which already has its own receipts and notes applied inside
 * it — subtracting our receipts from it again would count them twice. So it is
 * held beside the calculated figure and the *difference* between them is
 * reported. That difference is the useful number: it is where the books and the
 * tracking disagree.
 */
import { round2 } from "../text";

export interface ReceiptInput {
  /** The stored row's id, where this came from the database. */
  id?: string;
  seq: number;
  receiptDate?: string | null;
  /** Amount received in the invoice's own currency. */
  amountFcy?: number | null;
  /** Home currency per one unit of foreign currency, on the day it arrived. */
  exchangeRate?: number | null;
  bankRef?: string | null;
  remarks?: string | null;
}

export interface NoteInput {
  id?: string;
  noteType: "CREDIT" | "DEBIT";
  amount?: number | null;
  noteNo?: string | null;
  noteDate?: string | null;
  reason?: string | null;
}

export interface ReceiptMaths {
  id?: string;
  seq: number;
  receiptDate: string | null;
  amountFcy: number | null;
  exchangeRate: number | null;
  /** Receipt rate − invoice rate. Null until both rates are known. */
  rateDifference: number | null;
  /** Difference × receipt FCY. Positive is a gain. */
  forexGainLoss: number | null;
  /** Receipt FCY × receipt rate. */
  homeValue: number | null;
  bankRef: string | null;
  remarks: string | null;
  /** Why a figure above is null, where one is. */
  note: string | null;
}

/**
 * The two derived figures for one receipt.
 *
 * Both are null until both rates are known, which is the honest answer: a
 * forex gain cannot be computed against an invoice that has no rate, and
 * reporting zero would read as "no gain" rather than "not knowable".
 */
export function receiptMaths(receipt: ReceiptInput, invoiceRate: number | null): ReceiptMaths {
  const amount = receipt.amountFcy ?? null;
  const rate = receipt.exchangeRate ?? null;

  const homeValue = amount !== null && rate !== null ? round2(amount * rate) : null;
  let rateDifference: number | null = null;
  let forexGainLoss: number | null = null;
  let note: string | null = null;

  if (rate === null && invoiceRate === null) {
    note = "Neither the invoice nor this receipt has an exchange rate, so there is no forex figure.";
  } else if (rate === null) {
    note = "This receipt has no exchange rate, so its forex gain or loss cannot be worked out.";
  } else if (invoiceRate === null) {
    note = "The invoice has no exchange rate to compare against.";
  } else {
    rateDifference = round2(rate - invoiceRate);
    forexGainLoss = amount === null ? null : round2(rateDifference * amount);
    if (amount === null) note = "No amount recorded for this receipt.";
  }

  return {
    id: receipt.id,
    seq: receipt.seq,
    receiptDate: receipt.receiptDate ?? null,
    amountFcy: amount,
    exchangeRate: rate,
    rateDifference,
    forexGainLoss,
    homeValue,
    bankRef: receipt.bankRef ?? null,
    remarks: receipt.remarks ?? null,
    note,
  };
}

export function totalReceipts(receipts: ReceiptInput[]): number {
  return round2(receipts.reduce((s, r) => s + (r.amountFcy ?? 0), 0));
}

export function totalNotes(notes: NoteInput[], type: NoteInput["noteType"]): number {
  return round2(
    notes.filter((n) => n.noteType === type).reduce((s, n) => s + (n.amount ?? 0), 0),
  );
}

/** Receipts + credit notes − debit notes: what the customer no longer owes. */
export function settledAmount(receipts: ReceiptInput[], notes: NoteInput[]): number {
  return round2(
    totalReceipts(receipts) + totalNotes(notes, "CREDIT") - totalNotes(notes, "DEBIT"),
  );
}

export type PaymentState =
  | "NO_VALUE"
  | "UNPAID"
  | "PARTLY_PAID"
  | "NEARLY_SETTLED"
  | "PAID"
  | "OVERPAID";

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  NO_VALUE: "No invoice value",
  UNPAID: "Unpaid",
  PARTLY_PAID: "Partially paid",
  NEARLY_SETTLED: "Nearly settled",
  PAID: "Paid",
  OVERPAID: "Overpaid",
};

export const PAYMENT_STATE_TONE: Record<PaymentState, "ok" | "warn" | "bad" | "info" | "mute"> = {
  NO_VALUE: "mute",
  UNPAID: "bad",
  PARTLY_PAID: "warn",
  NEARLY_SETTLED: "info",
  PAID: "ok",
  OVERPAID: "warn",
};

export interface InvoiceMoney {
  invoiceValue: number | null;
  invoiceRate: number | null;
  /** Invoice Value × Invoice Rate. */
  homeInvoiceValue: number | null;

  receiptCount: number;
  totalReceived: number;
  creditNotes: number;
  debitNotes: number;
  /** What the customer no longer owes: receipts + CN − DN. */
  settled: number;

  /** Invoice Value − Receipts − CN + DN, in the invoice's currency. */
  calculatedOutstanding: number | null;
  /** Received as a share of the invoice value, 0–100. */
  collectedPct: number | null;
  /** Outstanding as a share of the invoice value, 0–100. */
  outstandingPct: number | null;

  /** Entered from the books. Never used in the sum above. */
  booksBalance: number | null;
  /** Calculated − books. Where the two disagree, and by how much. */
  booksDifference: number | null;

  /** Σ of the per-receipt home values. */
  homeReceived: number | null;
  /** Σ of the per-receipt forex gains and losses. */
  totalForexGainLoss: number | null;

  receipts: ReceiptMaths[];
  paymentState: PaymentState;
  /** Set when one or more receipts could not produce a forex figure. */
  forexNote: string | null;
}

/**
 * Everything derived from one invoice's own figures.
 *
 * `nearlySettledPct` exists because of a pattern in the reference data: a
 * customer paying a flat amount per container against invoices a few hundred
 * higher leaves a residue of about 1.5% on seventeen invoices. Calling those
 * *partially paid* puts them in a chasing queue that nobody will then trust;
 * calling them *paid* hides the residue. They get a state of their own.
 */
export function invoiceMoney(args: {
  invoiceValue: number | null;
  invoiceRate: number | null;
  receipts: ReceiptInput[];
  notes: NoteInput[];
  booksBalance?: number | null;
  nearlySettledPct?: number;
}): InvoiceMoney {
  const { invoiceValue, invoiceRate, receipts, notes } = args;
  const nearly = args.nearlySettledPct ?? 2;

  const lines = receipts.map((r) => receiptMaths(r, invoiceRate));
  const received = totalReceipts(receipts);
  const cn = totalNotes(notes, "CREDIT");
  const dn = totalNotes(notes, "DEBIT");
  const settled = round2(received + cn - dn);

  const calculatedOutstanding = invoiceValue === null ? null : round2(invoiceValue - settled);

  const homeValues = lines.map((l) => l.homeValue).filter((v): v is number => v !== null);
  const forexValues = lines.map((l) => l.forexGainLoss).filter((v): v is number => v !== null);

  const booksBalance = args.booksBalance ?? null;

  let paymentState: PaymentState;
  if (invoiceValue === null) paymentState = "NO_VALUE";
  else if (calculatedOutstanding === null) paymentState = "NO_VALUE";
  else if (calculatedOutstanding < -0.01) paymentState = "OVERPAID";
  else if (calculatedOutstanding <= 0.01) paymentState = "PAID";
  else if (received <= 0.01 && cn <= 0.01) paymentState = "UNPAID";
  else if (invoiceValue > 0 && (calculatedOutstanding / invoiceValue) * 100 <= nearly) {
    paymentState = "NEARLY_SETTLED";
  } else paymentState = "PARTLY_PAID";

  const missingForex = lines.filter((l) => l.forexGainLoss === null && l.amountFcy !== null);

  return {
    invoiceValue,
    invoiceRate,
    homeInvoiceValue:
      invoiceValue !== null && invoiceRate !== null ? round2(invoiceValue * invoiceRate) : null,

    receiptCount: receipts.length,
    totalReceived: received,
    creditNotes: cn,
    debitNotes: dn,
    settled,

    calculatedOutstanding,
    collectedPct:
      invoiceValue !== null && invoiceValue > 0
        ? Math.round((received / invoiceValue) * 1000) / 10
        : null,
    outstandingPct:
      invoiceValue !== null && invoiceValue > 0 && calculatedOutstanding !== null
        ? Math.round((calculatedOutstanding / invoiceValue) * 1000) / 10
        : null,

    booksBalance,
    booksDifference:
      booksBalance !== null && calculatedOutstanding !== null
        ? round2(calculatedOutstanding - booksBalance)
        : null,

    homeReceived: homeValues.length ? round2(homeValues.reduce((s, v) => s + v, 0)) : null,
    totalForexGainLoss: forexValues.length
      ? round2(forexValues.reduce((s, v) => s + v, 0))
      : null,

    receipts: lines,
    paymentState,
    forexNote: missingForex.length
      ? `${missingForex.length} receipt(s) have no exchange rate, so the forex figure covers only ` +
        `${forexValues.length} of ${lines.length}.`
      : null,
  };
}

// ---------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------

export const AGEING_BUCKETS = [30, 60, 90];

/** Outstanding, with a due date still ahead. */
export const NOT_YET_DUE = "Not yet due";
/** Outstanding, with no due date that can be established. */
export const NO_DUE_DATE = "No due date";
/** Nothing left to collect: paid, or paid beyond the value. */
export const SETTLED = "Settled";

export function ageingLabels(buckets: number[] = AGEING_BUCKETS): string[] {
  const b = sane(buckets);
  const out = [NOT_YET_DUE];
  let from = 1;
  for (const edge of b) {
    out.push(`${from}–${edge} days`);
    from = edge + 1;
  }
  out.push(`Over ${b[b.length - 1]} days`);
  return out;
}

/**
 * The bucket a number of days past due falls in.
 *
 * Zero or negative is "Not yet due". The reference sheets printed a negative number
 * of overdue days for an invoice that had not fallen due, which is
 * arithmetically correct and reads like a mistake.
 */
export function ageingBucket(days: number | null, buckets: number[] = AGEING_BUCKETS): string {
  if (days === null) return NO_DUE_DATE;
  if (days <= 0) return NOT_YET_DUE;
  const b = sane(buckets);
  let from = 1;
  for (const edge of b) {
    if (days <= edge) return `${from}–${edge} days`;
    from = edge + 1;
  }
  return `Over ${b[b.length - 1]} days`;
}

function sane(buckets: number[]): number[] {
  const out = [...new Set(buckets.map((b) => Math.floor(b)).filter((b) => b > 0))].sort(
    (a, b) => a - b,
  );
  return out.length ? out : AGEING_BUCKETS;
}
