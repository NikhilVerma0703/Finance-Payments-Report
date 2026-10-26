/**
 * The dashboard's working lists (owner, 26 Oct 2026): what falls due in the
 * next days, which customers to chase first and where to follow up, and what
 * the records are missing.
 *
 *   upcomingSchedule  every portion falling due from today to 30 days ahead,
 *                     portion by portion as the strips count it (owingParts);
 *   priorityFollowUps every customer with money past its due date, oldest
 *                     first, with the follow-up somebody recorded for it;
 *   dataQuality       the gaps and mismatches in the records, each a list of
 *                     the records that have it.
 *
 * Pure: no database and no React. Nothing here adds amounts across
 * currencies — a total is always per currency — and nothing is filled in: a
 * date that is not recorded is reported missing, never assumed. There is no
 * PO date on the records (only a PO number), so the PO check is on the number.
 */
import { daysBetween, round2 } from "../text";
import { clientKey } from "./erpClients";
import { owingParts } from "./overview";
import type { TrackedInvoice } from "./record";

// ---------------------------------------------------------------------------
// Upcoming payment schedule
// ---------------------------------------------------------------------------

/** The windows the schedule can show, in days from today. */
export const SCHEDULE_WINDOWS = [7, 15, 30] as const;
export type ScheduleWindow = (typeof SCHEDULE_WINDOWS)[number];

export function isScheduleWindow(v: unknown): v is ScheduleWindow {
  return SCHEDULE_WINDOWS.includes(Number(v) as ScheduleWindow);
}

export interface ScheduleRow {
  invoiceId: string;
  invoiceNo: string | null;
  customerId: string | null;
  customer: string | null;
  currency: string | null;
  due: string;
  /** Days from today; 0 is today. */
  inDays: number;
  /** What falls due on this date. */
  amount: number;
  /** What the whole invoice still owes. */
  outstanding: number;
  status: TrackedInvoice["status"];
  /** The date is the default credit period, not the terms. */
  assumed: boolean;
}

export interface UpcomingSchedule {
  rows: ScheduleRow[];
  /** Per window: how much falls due by currency, and on how many invoices. */
  windows: Array<{ days: ScheduleWindow; invoices: number; totals: Array<{ currency: string; amount: number }> }>;
}

/**
 * Every portion falling due from today to the longest window, soonest first.
 * An invoice whose terms split it in two shows each part on its own date; one
 * already overdue is not here — it is in the follow-ups.
 */
export function upcomingSchedule(invoices: TrackedInvoice[], today: string): UpcomingSchedule {
  const longest = SCHEDULE_WINDOWS[SCHEDULE_WINDOWS.length - 1];
  const rows: ScheduleRow[] = [];
  for (const i of invoices) {
    const owing = i.money.calculatedOutstanding ?? 0;
    // the default date stands in for a portion whose basis date is missing
    const assumedOn = new Set(i.schedule.milestones.filter((m) => m.assumed && m.dueDate).map((m) => m.dueDate));
    const byDate = new Map<string, number>();
    for (const p of owingParts(i)) {
      if (!p.due) continue;
      const inDays = daysBetween(today, p.due);
      if (inDays < 0 || inDays > longest) continue;
      byDate.set(p.due, (byDate.get(p.due) ?? 0) + p.amount);
    }
    for (const [due, amount] of byDate) {
      rows.push({
        invoiceId: i.id,
        invoiceNo: i.invoiceNo,
        customerId: i.customerId,
        customer: i.customerName,
        currency: i.currency,
        due,
        inDays: daysBetween(today, due),
        amount: round2(amount),
        outstanding: round2(owing),
        status: i.status,
        assumed: i.schedule.dueDateSource === "default" || assumedOn.has(due),
      });
    }
  }
  rows.sort((a, b) => a.due.localeCompare(b.due) || (a.customer ?? "").localeCompare(b.customer ?? "") || (a.invoiceNo ?? "").localeCompare(b.invoiceNo ?? ""));

  const windows = SCHEDULE_WINDOWS.map((days) => {
    const inside = rows.filter((r) => r.inDays <= days);
    const totals = new Map<string, number>();
    for (const r of inside) totals.set(r.currency ?? "—", (totals.get(r.currency ?? "—") ?? 0) + r.amount);
    return {
      days,
      invoices: new Set(inside.map((r) => r.invoiceId)).size,
      totals: [...totals].map(([currency, amount]) => ({ currency, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
    };
  });
  return { rows, windows };
}

// ---------------------------------------------------------------------------
// Priority follow-ups
// ---------------------------------------------------------------------------

/** Where chasing a customer stands (accounts_pt_follow_up.status). */
export const FOLLOW_UP_STATUS = {
  NOT_STARTED: "Not started",
  CONTACTED: "Contacted",
  PROMISED: "Payment promised",
  DISPUTED: "Disputed",
  ESCALATED: "Escalated",
  RESOLVED: "Resolved",
} as const;
export type FollowUpStatus = keyof typeof FOLLOW_UP_STATUS;

export const FOLLOW_UP_TONE: Record<FollowUpStatus, "ok" | "warn" | "bad" | "info" | "mute"> = {
  NOT_STARTED: "mute",
  CONTACTED: "info",
  PROMISED: "ok",
  DISPUTED: "bad",
  ESCALATED: "warn",
  RESOLVED: "ok",
};

export function isFollowUpStatus(v: unknown): v is FollowUpStatus {
  return typeof v === "string" && Object.hasOwn(FOLLOW_UP_STATUS, v);
}

/** One customer's follow-up as it is recorded. */
export interface FollowUp {
  status: FollowUpStatus;
  nextAction: string | null;
  nextDate: string | null;
  by: string | null;
  at: string | null;
}

export const NO_FOLLOW_UP: FollowUp = { status: "NOT_STARTED", nextAction: null, nextDate: null, by: null, at: null };

export interface PriorityRow {
  customerId: string;
  customer: string;
  /** What is past its due date, per currency, largest first. */
  overdue: Array<{ currency: string; amount: number }>;
  overdueInvoices: number;
  /** The overdue invoice that has been late longest. */
  oldest: { id: string; invoiceNo: string | null; days: number };
  /** The customer's latest receipt with a date, on any invoice in view. */
  lastPayment: string | null;
  followUp: FollowUp;
}

/**
 * Every customer with money past its due date, the longest-late first — days
 * can be compared across currencies, amounts cannot. A customer whose
 * follow-up is resolved stays on the list while money is still overdue, and
 * says so. Invoices with no customer are left out: there is nobody to chase,
 * and the data-quality list names them.
 *
 * @param paidFrom the invoices the last payment is read from — every invoice
 *                 in view, cleared ones too. Defaults to `invoices`.
 */
export function priorityFollowUps(
  invoices: TrackedInvoice[],
  followUps: ReadonlyMap<string, FollowUp>,
  paidFrom: TrackedInvoice[] = invoices,
): PriorityRow[] {
  const lastPaid = new Map<string, string>();
  for (const i of paidFrom) {
    if (!i.customerId || !i.lastReceiptDate) continue;
    if (i.lastReceiptDate > (lastPaid.get(i.customerId) ?? "")) lastPaid.set(i.customerId, i.lastReceiptDate);
  }

  const rows = new Map<string, PriorityRow & { totals: Map<string, number> }>();
  for (const i of invoices) {
    const amount = i.schedule.overdueAmount;
    const days = i.overdueDays ?? 0;
    if (!i.customerId || amount <= 0.01 || days <= 0) continue;
    let row = rows.get(i.customerId);
    if (!row) {
      row = {
        customerId: i.customerId,
        customer: i.customerName ?? "—",
        overdue: [],
        overdueInvoices: 0,
        oldest: { id: i.id, invoiceNo: i.invoiceNo, days },
        lastPayment: lastPaid.get(i.customerId) ?? null,
        followUp: followUps.get(i.customerId) ?? NO_FOLLOW_UP,
        totals: new Map(),
      };
      rows.set(i.customerId, row);
    }
    row.overdueInvoices += 1;
    row.totals.set(i.currency ?? "—", (row.totals.get(i.currency ?? "—") ?? 0) + amount);
    if (days > row.oldest.days) row.oldest = { id: i.id, invoiceNo: i.invoiceNo, days };
  }

  return [...rows.values()]
    .map(({ totals, ...row }) => ({
      ...row,
      overdue: [...totals].map(([currency, amount]) => ({ currency, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => b.oldest.days - a.oldest.days || b.overdueInvoices - a.overdueInvoices || a.customer.localeCompare(b.customer));
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

export type QualityKey = "bl" | "po" | "terms" | "receiptDate" | "incomplete" | "noCustomer" | "currencyMismatch" | "notInClients";

export interface QualityRecord {
  /** The invoice to open, or null where the alert is about a customer. */
  invoiceId: string | null;
  customerId: string | null;
  label: string;
  detail: string;
}

export interface QualityAlert {
  key: QualityKey;
  title: string;
  /** Why it matters, in one line. */
  why: string;
  tone: "bad" | "warn" | "info";
  count: number;
  /** The records, the first `limit` of them. */
  records: QualityRecord[];
  /** The Search Invoices "Missing information" filter that lists them all, where there is one. */
  missing?: string;
}

/** The ERP client list, as the check needs it: the default currency by name key. */
export type ClientCurrencies = ReadonlyMap<string, { name: string; currency: string }>;

/**
 * What the records are missing, and where they disagree with the ERP's client
 * list. Over the invoices still owing — a gap on a settled invoice changes no
 * figure. The client list is the copy of the ERP's loaded in Settings: a customer it does not
 * know, or an invoice whose own currency differs from that client's default,
 * is worth a look; neither is corrected here. Alerts with nothing in them are
 * left out.
 */
export function dataQuality(invoices: TrackedInvoice[], clients: ClientCurrencies, limit = 5): QualityAlert[] {
  const open = invoices.filter((i) => (i.money.calculatedOutstanding ?? 0) > 0.01 || i.money.invoiceValue === null);
  const name = (i: TrackedInvoice) => `${i.invoiceNo ?? "(no number)"} · ${i.customerName ?? "no customer"}`;
  const of = (i: TrackedInvoice, detail: string): QualityRecord => ({ invoiceId: i.id, customerId: i.customerId, label: name(i), detail });

  const alerts: QualityAlert[] = [];
  const add = (a: Omit<QualityAlert, "count" | "records">, records: QualityRecord[]) => {
    if (records.length) alerts.push({ ...a, count: records.length, records: records.slice(0, limit) });
  };

  // terms counted from the BL date need it; any other invoice can do without
  const countsFromBl = (i: TrackedInvoice) => i.schedule.milestones.some((m) => m.basis === "BL_DATE");
  add(
    { key: "bl", title: "BL date missing", why: "terms counted from the BL date cannot date the invoice", tone: "bad", missing: "bl" },
    open.filter((i) => !i.blDate && countsFromBl(i)).map((i) => of(i, i.paymentTerms ?? "")),
  );
  add(
    { key: "terms", title: "Payment terms missing", why: "no due date can be worked out from the terms", tone: "warn", missing: "terms" },
    open.filter((i) => !i.paymentTerms && !i.enteredDueDate).map((i) => of(i, i.schedule.dueDateSource === "default" ? "dated by the default credit period" : "no due date")),
  );
  add(
    { key: "receiptDate", title: "Receipt date missing", why: "a receipt with no date cannot be placed in the collections", tone: "warn" },
    invoices
      .filter((i) => i.receipts.some((r) => !r.receiptDate && (r.amountFcy ?? 0) !== 0))
      .map((i) => of(i, `${i.receipts.filter((r) => !r.receiptDate && (r.amountFcy ?? 0) !== 0).length} receipt(s) undated`)),
  );
  add(
    { key: "po", title: "PO number missing", why: "the records keep a PO number but no PO date field; these open invoices have no PO number", tone: "info", missing: "po" },
    open.filter((i) => !i.poNo).map((i) => of(i, "")),
  );
  add(
    { key: "incomplete", title: "Incomplete records", why: "invoice number, date or value missing — nothing can be judged without them", tone: "bad" },
    open
      .filter((i) => !i.invoiceNo || !i.invoiceDate || i.money.invoiceValue === null)
      .map((i) =>
        of(
          i,
          [!i.invoiceNo && "invoice number", !i.invoiceDate && "invoice date", i.money.invoiceValue === null && "invoice value"].filter(Boolean).join(", ") + " missing",
        ),
      ),
  );
  add(
    { key: "noCustomer", title: "No customer recorded", why: "nobody can be chased for these invoices", tone: "warn" },
    open.filter((i) => !i.customerId).map((i) => of(i, "")),
  );

  // the client list is only worth comparing with when there is one
  if (clients.size) {
    add(
      { key: "currencyMismatch", title: "Currency differs from the ERP client", why: "the invoice's currency is not the client's default in the ERP", tone: "warn" },
      open
        .filter((i) => i.currency && i.currencySource === "invoice")
        .filter((i) => {
          const c = clients.get(clientKey(i.customerName));
          return c && c.currency !== i.currency;
        })
        .map((i) => of(i, `${i.currency} here, ${clients.get(clientKey(i.customerName))!.currency} in the client list`)),
    );
    const unknown = new Map<string, QualityRecord>();
    for (const i of open) {
      if (!i.customerId || unknown.has(i.customerId) || clients.has(clientKey(i.customerName))) continue;
      unknown.set(i.customerId, { invoiceId: null, customerId: i.customerId, label: i.customerName ?? "—", detail: "no client of this name in the ERP" });
    }
    add({ key: "notInClients", title: "Customer not in the ERP client list", why: "matched by name; a spelling difference is the usual cause", tone: "info" }, [...unknown.values()]);
  }
  return alerts;
}

// ---------------------------------------------------------------------------
// Customer payment performance
// ---------------------------------------------------------------------------

export interface PerformanceRow {
  customerId: string | null;
  customer: string;
  currency: string;
  invoices: number;
  invoiced: number;
  received: number;
  outstanding: number;
  /** Received as a share of invoiced, 0–100; null with nothing invoiced. */
  collectedPct: number | null;
  /** Settled invoices: days from the invoice date to the last receipt, on average. */
  avgDays: number | null;
  /** How many settled invoices the average is over. */
  settled: number;
}

const SETTLED = new Set(["PAID", "OVERPAID", "NEARLY_SETTLED"]);

/**
 * How each customer pays, one row per customer and currency — a customer
 * billed in two currencies has two rows. Collection time is worked out as the
 * key figures do: settled invoices with an invoice date, from it to the last
 * receipt (an advance counts as 0). Largest invoiced first within a currency.
 */
export function customerPerformance(invoices: TrackedInvoice[]): PerformanceRow[] {
  const rows = new Map<string, PerformanceRow & { days: number }>();
  for (const i of invoices) {
    const currency = i.currency ?? "—";
    const key = `${i.customerId ?? `~${i.customerName ?? ""}`}|${currency}`;
    let row = rows.get(key);
    if (!row) {
      row = { customerId: i.customerId, customer: i.customerName ?? "No customer recorded", currency, invoices: 0, invoiced: 0, received: 0, outstanding: 0, collectedPct: null, avgDays: null, settled: 0, days: 0 };
      rows.set(key, row);
    }
    row.invoices += 1;
    row.invoiced += i.money.invoiceValue ?? 0;
    row.received += i.money.totalReceived;
    row.outstanding += Math.max(0, i.money.calculatedOutstanding ?? 0);
    if (SETTLED.has(i.status) && i.lastReceiptDate && i.invoiceDate) {
      row.settled += 1;
      row.days += Math.max(0, daysBetween(i.invoiceDate, i.lastReceiptDate));
    }
  }
  return [...rows.values()]
    .map(({ days, ...r }) => ({
      ...r,
      invoiced: round2(r.invoiced),
      received: round2(r.received),
      outstanding: round2(r.outstanding),
      collectedPct: r.invoiced > 0.01 ? Math.round((r.received / r.invoiced) * 1000) / 10 : null,
      avgDays: r.settled ? Math.round(days / r.settled) : null,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.invoiced - a.invoiced);
}
