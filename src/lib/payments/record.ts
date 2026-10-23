/**
 * One tracked invoice, fully worked out.
 *
 * The single place the Payment Tracking section turns stored fields into the
 * figures its table, detail views, dashboard and export all show — so none of
 * them can disagree with another.
 *
 * It takes a plain object and returns a plain object: no database, no React, no
 * request. Everything the section claims about an invoice can therefore be
 * checked without either.
 */
import { formatMoney } from "../money";
import { addDays, daysBetween, round2, todayIso } from "../text";
import {
  ageingBucket,
  invoiceMoney,
  NO_DUE_DATE,
  SETTLED,
  PAYMENT_STATE_LABELS,
  type InvoiceMoney,
  type NoteInput,
  type PaymentState,
  type ReceiptInput,
} from "./money";
import { buildSchedule, type BasisDates, type Schedule, type TermRule } from "./terms";

/** Everything stored against one invoice. Every field is optional by design. */
export interface TrackedInvoiceInput {
  id: string;
  customerId: string | null;
  customerName: string | null;

  invoiceNo: string | null;
  invoiceDate: string | null;
  customerInvoiceValue: number | null;
  customsInvoiceValue: number | null;
  exchangeRate: number | null;
  currency: string | null;
  consignee: string | null;
  notifyParty: string | null;
  country: string | null;

  paymentTerms: string | null;
  enteredDueDate: string | null;

  piNo: string | null;
  poNo: string | null;
  shippingBillNo: string | null;
  shippingBillDate: string | null;
  blNo: string | null;
  blDate: string | null;
  containerNo: string | null;
  eta: string | null;
  docsPresentedDate: string | null;

  booksBalance: number | null;
  remarks: string | null;
  followUpNotes: string | null;

  source: string;
  sourceFile: string | null;
  sourceAsOn: string | null;

  receipts: ReceiptInput[];
  notes: NoteInput[];

  /**
   * Where `currency` came from: the invoice itself, its customer's record, or
   * the main ERP's client list (a default nobody here has confirmed). Absent
   * where the caller does not know.
   */
  currencySource?: CurrencySource | null;
}

export type CurrencySource = "invoice" | "customer" | "erp";

/**
 * The status one invoice reports.
 *
 * Deliberately a single list rather than two, because this section's table has
 * one Status column and an Accounts user reads it left to right. The order *is*
 * the business rule — the first test that matches wins:
 *
 *   1. no invoice value          → nothing can be judged
 *   2. nothing outstanding       → Paid, whatever any date says
 *   3. paid beyond the value     → Overpaid, which needs looking at
 *   4. no due date obtainable    → Requires verification
 *   5. a portion is past due     → Overdue
 *   6. due inside the window     → Due soon
 *   7. a residue under 2% left   → Nearly settled
 *   8. some money in             → Partially paid
 *   9. nothing in                → Unpaid
 *
 * Requires verification sits above Overdue on purpose: an invoice whose due
 * date could not be established must not be reported as late, because nobody
 * knows that it is.
 */
export const TRACKING_STATUS = {
  NO_VALUE: "NO_VALUE",
  PAID: "PAID",
  OVERPAID: "OVERPAID",
  REQUIRES_VERIFICATION: "REQUIRES_VERIFICATION",
  OVERDUE: "OVERDUE",
  DUE_SOON: "DUE_SOON",
  NEARLY_SETTLED: "NEARLY_SETTLED",
  PARTLY_PAID: "PARTLY_PAID",
  UNPAID: "UNPAID",
} as const;

export type TrackingStatus = (typeof TRACKING_STATUS)[keyof typeof TRACKING_STATUS];

export const STATUS_LABELS: Record<TrackingStatus, string> = {
  NO_VALUE: "No invoice value",
  PAID: "Paid",
  OVERPAID: "Overpaid",
  REQUIRES_VERIFICATION: "Requires verification",
  OVERDUE: "Overdue",
  DUE_SOON: "Due soon",
  NEARLY_SETTLED: "Nearly settled",
  PARTLY_PAID: "Partially paid",
  UNPAID: "Unpaid",
};

export const STATUS_TONE: Record<TrackingStatus, "ok" | "warn" | "bad" | "info" | "mute"> = {
  NO_VALUE: "mute",
  PAID: "ok",
  OVERPAID: "warn",
  REQUIRES_VERIFICATION: "warn",
  OVERDUE: "bad",
  DUE_SOON: "warn",
  NEARLY_SETTLED: "info",
  PARTLY_PAID: "warn",
  UNPAID: "bad",
};

export const STATUS_ORDER: TrackingStatus[] = [
  "OVERDUE",
  "DUE_SOON",
  "REQUIRES_VERIFICATION",
  "UNPAID",
  "PARTLY_PAID",
  "NEARLY_SETTLED",
  "PAID",
  "OVERPAID",
  "NO_VALUE",
];

export interface TrackedInvoice extends TrackedInvoiceInput {
  money: InvoiceMoney;
  schedule: Schedule;
  status: TrackingStatus;
  statusNote: string;

  /** Days past the due date. Negative before it, null without one. */
  overdueDays: number | null;
  /** Days since the invoice was raised. Available even with no due date. */
  invoiceAge: number | null;
  ageing: string;
  /**
   * The day the invoice became overdue — the day after its due date — while
   * money is still owed past that date. Null when nothing is overdue. This is
   * the date the "Overdue Date" range filters on.
   */
  overdueSince: string | null;
  lastReceiptDate: string | null;

  /** True when something needed to judge this invoice is missing. */
  needsAttention: boolean;
  attentionReasons: string[];
  /** Sorts the attention list: higher is more pressing. */
  urgency: number;

  /** Which fields are empty, so a detail screen can say what to fill in. */
  missingFields: string[];
}

export interface TrackingParams {
  /** Due within this many days counts as due soon. */
  dueSoonDays: number;
  /** A residue under this share of the invoice value is "nearly settled". */
  nearlySettledPct: number;
  /** Ageing boundaries in days, ascending. */
  ageingBuckets: number[];
  /** An unpaid invoice older than this with no due date still needs attention. */
  attentionAfterDays: number;
}

export const TRACKING_DEFAULTS: TrackingParams = {
  dueSoonDays: 7,
  nearlySettledPct: 2,
  ageingBuckets: [30, 60, 90],
  attentionAfterDays: 90,
};

/** The fields whose absence stops something being calculated. */
const WANTED: Array<{ key: keyof TrackedInvoiceInput; label: string; why: string }> = [
  { key: "invoiceNo", label: "Invoice number", why: "nothing can be matched or searched without it" },
  { key: "invoiceDate", label: "Invoice date", why: "the invoice cannot be aged" },
  { key: "customerInvoiceValue", label: "Invoice value", why: "no balance or status can be worked out" },
  { key: "paymentTerms", label: "Payment terms", why: "no due date can be worked out" },
  { key: "blDate", label: "BL date", why: "terms counted from the BL date have nothing to count from" },
  { key: "exchangeRate", label: "Exchange rate", why: "no home-currency value or forex figure" },
  { key: "currency", label: "Currency", why: "amounts cannot be totalled safely" },
];

/**
 * Work out everything derivable about one invoice.
 *
 * @param today passed in rather than read, so a test can fix the date and the
 *              export can state the one it used.
 */
export function buildTrackedInvoice(
  input: TrackedInvoiceInput,
  opts: { today?: string; params?: TrackingParams; rules?: TermRule[] } = {},
): TrackedInvoice {
  const today = opts.today ?? todayIso();
  const params = opts.params ?? TRACKING_DEFAULTS;

  const money = invoiceMoney({
    invoiceValue: input.customerInvoiceValue,
    invoiceRate: input.exchangeRate,
    receipts: input.receipts,
    notes: input.notes,
    booksBalance: input.booksBalance,
    nearlySettledPct: params.nearlySettledPct,
  });

  const basisDates: BasisDates = {
    BL_DATE: input.blDate,
    INVOICE_DATE: input.invoiceDate,
    ETA: input.eta,
    DOCS_PRESENTED: input.docsPresentedDate,
    SHIPPING_BILL_DATE: input.shippingBillDate,
  };

  const schedule = buildSchedule({
    paymentTerms: input.paymentTerms,
    invoiceValue: input.customerInvoiceValue,
    basisDates,
    settled: money.settled,
    enteredDueDate: input.enteredDueDate,
    dueSoonDays: params.dueSoonDays,
    today,
    rules: opts.rules,
  });

  const overdueDays = schedule.overdueDays;
  const invoiceAge = input.invoiceDate ? daysBetween(input.invoiceDate, today) : null;
  const outstanding = money.calculatedOutstanding;

  const status = resolveStatus({ money, schedule, params, outstanding });

  const lastReceiptDate = input.receipts.reduce<string | null>(
    (latest, r) => (r.receiptDate && (!latest || r.receiptDate > latest) ? r.receiptDate : latest),
    null,
  );

  const missingFields = WANTED.filter((w) => {
    const v = input[w.key];
    return v === null || v === undefined || v === "";
  }).map((w) => `${w.label} — ${w.why}`);

  const { reasons, urgency } = attention({
    input,
    money,
    schedule,
    status,
    overdueDays,
    invoiceAge,
    params,
    today,
  });

  return {
    ...input,
    money,
    schedule,
    status,
    statusNote: statusNote(status, money, schedule, input.currency),
    overdueDays,
    invoiceAge,
    ageing:
      outstanding !== null && outstanding > 0.01
        ? schedule.dueDate
          ? ageingBucket(overdueDays, params.ageingBuckets)
          : NO_DUE_DATE
        : SETTLED,
    overdueSince:
      outstanding !== null &&
      outstanding > 0.01 &&
      schedule.dueDate &&
      overdueDays !== null &&
      overdueDays > 0
        ? addDays(schedule.dueDate, 1)
        : null,
    lastReceiptDate,
    needsAttention: reasons.length > 0,
    attentionReasons: reasons,
    urgency,
    missingFields,
  };
}

function resolveStatus(args: {
  money: InvoiceMoney;
  schedule: Schedule;
  params: TrackingParams;
  outstanding: number | null;
}): TrackingStatus {
  const { money, schedule, outstanding } = args;

  if (money.invoiceValue === null || outstanding === null) return "NO_VALUE";
  if (outstanding < -0.01) return "OVERPAID";
  if (outstanding <= 0.01) return "PAID";

  // an invoice whose due date could not be established is not reported as late
  if (schedule.dueDate === null) return "REQUIRES_VERIFICATION";

  if (schedule.overdueAmount > 0.01) return "OVERDUE";
  if (schedule.overdueDays !== null && Math.abs(schedule.overdueDays) <= args.params.dueSoonDays) {
    return "DUE_SOON";
  }
  if (money.paymentState === "NEARLY_SETTLED") return "NEARLY_SETTLED";
  if (money.paymentState === "PARTLY_PAID") return "PARTLY_PAID";
  return "UNPAID";
}

/** Why the status says what it says — shown on hover. */
function statusNote(
  status: TrackingStatus,
  money: InvoiceMoney,
  schedule: Schedule,
  currency: string | null,
): string {
  const f = (n: number) => formatMoney(n, currency);
  if (status === "NO_VALUE") {
    return "No invoice value is recorded, so there is nothing to measure a payment against.";
  }
  if (status === "REQUIRES_VERIFICATION") {
    return (
      "No due date could be worked out, so this invoice is not reported as late. " +
      (schedule.verificationReasons[0] ?? schedule.dueDateNote)
    );
  }

  const bits: string[] = [];
  bits.push(
    money.receiptCount
      ? `${f(money.settled)} of ${f(money.invoiceValue ?? 0)} settled across ${money.receiptCount} receipt(s)`
      : `Nothing received against ${f(money.invoiceValue ?? 0)}`,
  );
  if (money.creditNotes > 0.01 || money.debitNotes > 0.01) {
    bits.push(`including ${f(money.creditNotes)} CN and ${f(money.debitNotes)} DN`);
  }
  if ((money.calculatedOutstanding ?? 0) > 0.01) {
    bits.push(`${f(money.calculatedOutstanding ?? 0)} outstanding`);
  }
  if (status === "OVERDUE") {
    bits.push(`${f(schedule.overdueAmount)} of it is past due`);
  }
  bits.push(schedule.dueDate ? `due ${schedule.dueDate}` : "no due date");
  if (status === "OVERPAID") {
    bits.push("more has been received than the invoice was raised for — worth checking");
  }
  if (status === "NEARLY_SETTLED") {
    bits.push("close enough to settled to be a filing job rather than a collection job");
  }
  return `${bits.join(", ")}.`;
}

/**
 * Whether an invoice needs looking at, and how urgently.
 *
 * Five reasons, none of which requires a date nobody has given us:
 *
 *   1. money is past a due date that actually exists
 *   2. no due date could be worked out at all
 *   3. nothing received against an invoice older than the Settings threshold
 *   4. the payment terms were not understood
 *   5. more was received than the invoice was raised for
 *
 * A paid invoice never qualifies, except through reason 5.
 */
function attention(args: {
  input: TrackedInvoiceInput;
  money: InvoiceMoney;
  schedule: Schedule;
  status: TrackingStatus;
  overdueDays: number | null;
  invoiceAge: number | null;
  params: TrackingParams;
  today: string;
}): { reasons: string[]; urgency: number } {
  const { money, schedule, status, overdueDays, invoiceAge, params } = args;
  const reasons: string[] = [];
  const outstanding = money.calculatedOutstanding ?? 0;
  const amount = (n: number) => formatMoney(n, args.input.currency);

  if (status === "OVERPAID") {
    reasons.push(
      `${amount(Math.abs(outstanding))} more has been received than the invoice was raised for`,
    );
  }

  if (outstanding > 0.01) {
    if (status === "OVERDUE") {
      reasons.push(`${amount(schedule.overdueAmount)} is ${overdueDays} day(s) past due`);
    }
    if (schedule.term.unknown && args.input.paymentTerms) {
      reasons.push(`The payment term "${args.input.paymentTerms}" was not recognised`);
    }
    if (schedule.dueDate === null) {
      reasons.push(
        schedule.verificationReasons[0] ??
          "No due date could be worked out, so this invoice cannot be assessed",
      );
    }
    if (
      money.totalReceived <= 0.01 &&
      schedule.dueDate === null &&
      (invoiceAge ?? 0) >= params.attentionAfterDays
    ) {
      reasons.push(
        `Nothing received against an invoice raised ${invoiceAge} day(s) ago, and it has no due date`,
      );
    }
  }

  // urgency: amount × days late, falling back to invoice age where there is no
  // due date, so an undated invoice is not parked at the bottom of the list
  const late = overdueDays !== null && overdueDays > 0 ? overdueDays : (invoiceAge ?? 0);
  let urgency = outstanding > 0.01 ? (outstanding * Math.max(0, late)) / 1000 : 0;
  if (status === "NEARLY_SETTLED") urgency *= 0.05;
  if (status === "REQUIRES_VERIFICATION") urgency *= 0.6;

  return { reasons, urgency: round2(urgency) };
}

export { PAYMENT_STATE_LABELS, type PaymentState };
