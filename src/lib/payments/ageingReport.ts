/**
 * The ageing analysis (owner, 25 Oct 2026: "professional ageing-based KPIs,
 * charts, and visualizations … to clearly show outstanding amounts, overdue
 * invoices, ageing categories, and payment status") — for invoices of one
 * currency, the figures the Reports section's Ageing analysis page draws.
 *
 * Every open invoice sits in exactly one ageing category, the one the rest of
 * the module gives it (record.ts `ageing`), so these figures add up to the
 * dashboard's. Pure: no database and no React.
 */
import { ageingOrder } from "./ageing";
import { NO_DUE_DATE, NOT_YET_DUE } from "./money";
import { STATUS_LABELS, type TrackedInvoice, type TrackingStatus } from "./record";

export interface AgeingRow {
  customerId: string | null;
  customer: string;
  /** Amount outstanding per ageing category, in `labels` order. */
  amounts: number[];
  total: number;
  invoices: number;
}

export interface AgeingAnalysis {
  /** The ageing categories, in order: no due date, not yet due, then each span late. */
  labels: string[];
  /** Per category, over every customer: amount and number of open invoices. */
  buckets: Array<{ label: string; amount: number; invoices: number }>;
  /** One row per customer with money owed, the biggest balance first. */
  rows: AgeingRow[];
  kpis: {
    outstanding: number;
    openInvoices: number;
    overdue: number;
    overdueInvoices: number;
    /** Share of the balance past due, and past the last span (over 90 days). */
    overduePct: number;
    oldestBucket: number;
    oldestBucketPct: number;
    notYetDue: number;
    noDueDate: number;
    /** Days late on average, weighted by what is overdue. */
    avgDaysOverdue: number | null;
    customersOverdue: number;
  };
  /** Every status, by number of invoices and by money owed — paid ones too. */
  statuses: Array<{ status: TrackingStatus; label: string; invoices: number; outstanding: number }>;
  /** The largest overdue balances, invoice by invoice. */
  topOverdue: TrackedInvoice[];
}

const round = (n: number) => Math.round(n * 100) / 100;

export function ageingAnalysis(invoices: TrackedInvoice[], ageingBuckets: number[], top = 10): AgeingAnalysis {
  const labels = ageingOrder(ageingBuckets);
  const index = new Map(labels.map((l, n) => [l, n]));
  const buckets = labels.map((label) => ({ label, amount: 0, invoices: 0 }));
  const byCustomer = new Map<string, AgeingRow>();
  const statuses = new Map<TrackingStatus, { invoices: number; outstanding: number }>();
  let lateMoney = 0;
  let lateWeighted = 0;
  const lateCustomers = new Set<string>();

  for (const i of invoices) {
    const owing = i.money.calculatedOutstanding ?? 0;
    const s = statuses.get(i.status) ?? { invoices: 0, outstanding: 0 };
    s.invoices += 1;
    s.outstanding = round(s.outstanding + Math.max(0, owing));
    statuses.set(i.status, s);
    if (owing <= 0.01) continue;

    const n = index.get(i.ageing);
    if (n === undefined) continue;
    buckets[n].amount = round(buckets[n].amount + owing);
    buckets[n].invoices += 1;

    const key = i.customerId ?? `~${i.customerName ?? ""}`;
    const row = byCustomer.get(key) ?? { customerId: i.customerId, customer: i.customerName ?? "No customer recorded", amounts: labels.map(() => 0), total: 0, invoices: 0 };
    row.amounts[n] = round(row.amounts[n] + owing);
    row.total = round(row.total + owing);
    row.invoices += 1;
    byCustomer.set(key, row);

    if (i.schedule.overdueAmount > 0.01 && (i.overdueDays ?? 0) > 0) {
      lateMoney += i.schedule.overdueAmount;
      lateWeighted += i.schedule.overdueAmount * (i.overdueDays ?? 0);
      lateCustomers.add(key);
    }
  }

  const outstanding = round(buckets.reduce((s, b) => s + b.amount, 0));
  const late = buckets.filter((b) => b.label !== NO_DUE_DATE && b.label !== NOT_YET_DUE);
  const overdue = round(late.reduce((s, b) => s + b.amount, 0));
  const oldest = late.at(-1)?.amount ?? 0;
  const pct = (n: number) => (outstanding > 0.01 ? Math.round((n / outstanding) * 1000) / 10 : 0);

  return {
    labels,
    buckets,
    rows: [...byCustomer.values()].sort((a, b) => b.total - a.total),
    kpis: {
      outstanding,
      openInvoices: buckets.reduce((s, b) => s + b.invoices, 0),
      overdue,
      overdueInvoices: late.reduce((s, b) => s + b.invoices, 0),
      overduePct: pct(overdue),
      oldestBucket: oldest,
      oldestBucketPct: pct(oldest),
      notYetDue: buckets[index.get(NOT_YET_DUE)!]?.amount ?? 0,
      noDueDate: buckets[index.get(NO_DUE_DATE)!]?.amount ?? 0,
      avgDaysOverdue: lateMoney > 0.01 ? Math.round(lateWeighted / lateMoney) : null,
      customersOverdue: lateCustomers.size,
    },
    statuses: [...statuses.entries()]
      .map(([status, v]) => ({ status, label: STATUS_LABELS[status], ...v }))
      .sort((a, b) => b.outstanding - a.outstanding || b.invoices - a.invoices),
    topOverdue: invoices
      .filter((i) => i.schedule.overdueAmount > 0.01)
      .sort((a, b) => b.schedule.overdueAmount - a.schedule.overdueAmount)
      .slice(0, top),
  };
}
