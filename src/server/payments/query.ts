/**
 * Reading the Payment Tracking data.
 *
 * Queries `pt_*` and nothing else. The figures are not stored anywhere: each
 * invoice is worked out by `buildTrackedInvoice` every time it is read, so a
 * change to a receipt, a payment term or a date shows up immediately and in
 * every view at once — the master table, the dashboard, the customer screen,
 * the invoice screen and the export all call this one function.
 */
import "server-only";

import { cache } from "react";

import { prisma } from "@/lib/db";
import { ageingSummary, type AgeingSummary } from "@/lib/payments/ageing";
import { ageingLabels } from "@/lib/payments/money";
import {
  buildTrackedInvoice,
  STATUS_LABELS,
  TRACKING_DEFAULTS,
  type TrackedInvoice,
  type TrackingParams,
  type TrackingStatus,
} from "@/lib/payments/record";
import { readTerm, type TermRule } from "@/lib/payments/terms";
import { formatMoney } from "@/lib/money";
import { round2, todayIso } from "@/lib/text";
import { loadParams, loadRules } from "@/server/payments/settings";

export interface CustomerSummary {
  id: string | null;
  name: string;
  currency: string;
  invoices: number;
  invoiceValue: number;
  received: number;
  outstanding: number;
  overdue: number;
  collectedPct: number;
  /** How many of this customer's invoices have a due date at all. */
  dueDatesKnown: number;
  needsAttention: number;
  oldestDue: string | null;
  statuses: Partial<Record<TrackingStatus, number>>;
}

export interface TrackingKpis {
  currency: string;
  invoices: number;
  customers: number;
  /** Σ invoice value. */
  totalInvoiceValue: number;
  /** Σ receipts. */
  totalReceived: number;
  /** Σ (value − receipts − CN + DN). */
  totalOutstanding: number;
  collectionRate: number;
  /** The part of the outstanding balance past a due date that exists. */
  overdueOutstanding: number;
  overdueInvoices: number;
  /** Outstanding on invoices that have a due date — the overdue denominator. */
  assessable: number;
  /** Outstanding on invoices with no obtainable due date. */
  requiresVerification: number;
  requiresVerificationInvoices: number;
  needsAttention: number;
  needsAttentionAmount: number;
  nilReceived: number;
  nilReceivedAmount: number;
  dueSoon: number;
  dueSoonAmount: number;
  ageing: Record<string, number>;
  /** The dashboard's ageing cards: each open invoice in exactly one bucket. */
  ageingSummary: AgeingSummary;
  statuses: Partial<Record<TrackingStatus, number>>;
  /** Σ per-receipt forex gain/loss, where rates were known. */
  forexGainLoss: number | null;

  /**
   * The same figures in the home currency, each invoice converted at its own
   * exchange rate — the book value of the receivable.
   *
   * `homeRatesKnown` is the denominator these need: an invoice with no rate
   * contributes nothing rather than zero, so a total covering 13 of 41
   * invoices must say so or it reads as the whole book.
   */
  homeInvoiceValue: number;
  homeReceived: number;
  homeOutstanding: number;
  homeRatesKnown: number;
}

export interface TrackingView {
  invoices: TrackedInvoice[];
  customers: CustomerSummary[];
  kpis: TrackingKpis[];
  params: TrackingParams;
  /** The payment-term rules from Settings & Rules, already applied above. */
  rules: TermRule[];
  today: string;
  options: {
    customers: string[];
    currencies: string[];
    pos: string[];
    terms: string[];
    statuses: TrackingStatus[];
  };
  counts: {
    total: number;
    fromExcel: number;
    manual: number;
    withoutDueDate: number;
    customers: number;
    receipts: number;
  };
  imports: Array<{
    id: string;
    fileName: string;
    customerName: string | null;
    asOn: string | null;
    asOnSource: string | null;
    rowsRead: number;
    created: number;
    updated: number;
    createdAt: Date;
  }>;
}

/** Read once per request — the dashboard, the table and the filters share it. */
export const loadTracking = cache(readTracking);

async function readTracking(): Promise<TrackingView> {
  const today = todayIso();
  const [params, rules] = await Promise.all([loadParams(), loadRules()]);

  const [rows, imports] = await Promise.all([
    prisma.ptInvoice.findMany({
      include: {
        customer: true,
        receipts: { orderBy: [{ seq: "asc" }, { createdAt: "asc" }] },
        notes: { orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.ptImport.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        fileName: true,
        customerName: true,
        asOn: true,
        asOnSource: true,
        rowsRead: true,
        created: true,
        updated: true,
        createdAt: true,
      },
    }),
  ]);

  const invoices = rows.map((r) =>
    buildTrackedInvoice(
      {
        id: r.id,
        customerId: r.customerId,
        customerName: r.customer?.name ?? null,
        invoiceNo: r.invoiceNo,
        invoiceDate: d(r.invoiceDate),
        customerInvoiceValue: n(r.customerInvoiceValue),
        customsInvoiceValue: n(r.customsInvoiceValue),
        exchangeRate: n(r.exchangeRate),
        currency: r.currency ?? r.customer?.currency ?? null,
        consignee: r.consignee ?? r.customer?.consignee ?? null,
        notifyParty: r.notifyParty ?? r.customer?.notifyParty ?? null,
        country: r.country ?? r.customer?.country ?? null,
        paymentTerms: r.paymentTerms ?? r.customer?.defaultPaymentTerms ?? null,
        enteredDueDate: d(r.enteredDueDate),
        piNo: r.piNo,
        poNo: r.poNo,
        shippingBillNo: r.shippingBillNo,
        shippingBillDate: d(r.shippingBillDate),
        blNo: r.blNo,
        blDate: d(r.blDate),
        containerNo: r.containerNo,
        eta: d(r.eta),
        docsPresentedDate: d(r.docsPresentedDate),
        booksBalance: n(r.booksBalance),
        remarks: r.remarks,
        followUpNotes: r.followUpNotes,
        source: r.source,
        sourceFile: r.sourceFile,
        sourceAsOn: d(r.sourceAsOn),
        receipts: r.receipts.map((x) => ({
          id: x.id,
          seq: x.seq,
          receiptDate: d(x.receiptDate),
          amountFcy: n(x.amountFcy),
          exchangeRate: n(x.exchangeRate),
          bankRef: x.bankRef,
          remarks: x.remarks,
        })),
        notes: r.notes.map((x) => ({
          id: x.id,
          noteType: x.noteType === "DEBIT" ? ("DEBIT" as const) : ("CREDIT" as const),
          amount: n(x.amount),
          noteNo: x.noteNo,
          noteDate: d(x.noteDate),
          reason: x.reason,
        })),
      },
      { today, params, rules },
    ),
  );

  return {
    invoices,
    customers: summarise(invoices),
    kpis: kpisFrom(invoices, params),
    params,
    rules,
    today,
    options: {
      customers: unique(invoices.map((i) => i.customerName ?? "")),
      currencies: unique(invoices.map((i) => i.currency ?? "")),
      pos: unique(invoices.map((i) => i.poNo ?? "")),
      terms: unique(invoices.map((i) => i.schedule.term.raw)),
      statuses: unique(invoices.map((i) => i.status)) as TrackingStatus[],
    },
    counts: {
      total: invoices.length,
      fromExcel: invoices.filter((i) => i.source === "EXCEL").length,
      manual: invoices.filter((i) => i.source !== "EXCEL").length,
      withoutDueDate: invoices.filter((i) => i.schedule.dueDate === null).length,
      customers: new Set(invoices.map((i) => i.customerId ?? "~none")).size,
      receipts: invoices.reduce((s, i) => s + i.receipts.length, 0),
    },
    imports: imports.map((i) => ({ ...i, asOn: d(i.asOn) })),
  };
}

const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);
const n = (v: number | null) => (v === null || v === undefined ? null : Number(v));

function unique(values: string[]): string[] {
  return [...new Set(values.filter((v) => v && v.trim() !== ""))].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/** One row per customer **and currency** — two currencies cannot be added. */
export function summarise(invoices: TrackedInvoice[]): CustomerSummary[] {
  const groups = new Map<string, CustomerSummary>();

  for (const i of invoices) {
    const name = i.customerName ?? "No customer recorded";
    const currency = i.currency ?? "—";
    const k = `${i.customerId ?? "~none"}::${currency}`;

    const g =
      groups.get(k) ??
      {
        id: i.customerId,
        name,
        currency,
        invoices: 0,
        invoiceValue: 0,
        received: 0,
        outstanding: 0,
        overdue: 0,
        collectedPct: 0,
        dueDatesKnown: 0,
        needsAttention: 0,
        oldestDue: null,
        statuses: {} as Partial<Record<TrackingStatus, number>>,
      };

    g.invoices += 1;
    g.invoiceValue = round2(g.invoiceValue + (i.customerInvoiceValue ?? 0));
    g.received = round2(g.received + i.money.totalReceived);
    g.outstanding = round2(g.outstanding + (i.money.calculatedOutstanding ?? 0));
    g.overdue = round2(g.overdue + i.schedule.overdueAmount);
    if (i.schedule.dueDate) g.dueDatesKnown += 1;
    if (i.needsAttention) g.needsAttention += 1;
    g.statuses[i.status] = (g.statuses[i.status] ?? 0) + 1;
    if (
      (i.money.calculatedOutstanding ?? 0) > 0.01 &&
      i.schedule.dueDate &&
      (!g.oldestDue || i.schedule.dueDate < g.oldestDue)
    ) {
      g.oldestDue = i.schedule.dueDate;
    }
    groups.set(k, g);
  }

  for (const g of groups.values()) {
    g.collectedPct = g.invoiceValue > 0 ? Math.round((g.received / g.invoiceValue) * 1000) / 10 : 0;
  }

  return [...groups.values()].sort((a, b) => b.outstanding - a.outstanding);
}

/**
 * The dashboard figures, per currency and never across it.
 *
 * `assessable` and `requiresVerification` split the outstanding balance into
 * the part an overdue figure can be computed for and the part it cannot. Without
 * that split, the overdue tile is a correct number with a hidden denominator —
 * and in the reference data more than a quarter of the book has no due date at
 * all.
 */
export function kpisFrom(
  invoices: TrackedInvoice[],
  params: TrackingParams = TRACKING_DEFAULTS,
): TrackingKpis[] {
  const labels = ageingLabels(params.ageingBuckets);
  const byCurrency = new Map<string, TrackedInvoice[]>();
  for (const i of invoices) {
    const c = i.currency ?? "—";
    const list = byCurrency.get(c);
    if (list) list.push(i);
    else byCurrency.set(c, [i]);
  }

  const out: TrackingKpis[] = [];

  for (const [currency, list] of byCurrency) {
    const ageing: Record<string, number> = { "No due date": 0 };
    for (const l of labels) ageing[l] = 0;
    const statuses: Partial<Record<TrackingStatus, number>> = {};

    let totalInvoiceValue = 0, totalReceived = 0, totalOutstanding = 0;
    let homeInvoiceValue = 0, homeReceived = 0, homeOutstanding = 0, homeRatesKnown = 0;
    let overdueOutstanding = 0, overdueInvoices = 0;
    let assessable = 0, requiresVerification = 0, requiresVerificationInvoices = 0;
    let needsAttention = 0, needsAttentionAmount = 0;
    let nilReceived = 0, nilReceivedAmount = 0;
    let dueSoon = 0, dueSoonAmount = 0;
    let forex = 0, forexSeen = false;

    for (const i of list) {
      const outstanding = i.money.calculatedOutstanding ?? 0;
      totalInvoiceValue = round2(totalInvoiceValue + (i.customerInvoiceValue ?? 0));
      totalReceived = round2(totalReceived + i.money.totalReceived);
      totalOutstanding = round2(totalOutstanding + outstanding);
      statuses[i.status] = (statuses[i.status] ?? 0) + 1;

      // converted at the invoice's own rate; no rate means no contribution,
      // never a zero that would quietly shrink the total
      if (i.exchangeRate !== null && i.exchangeRate !== undefined && i.exchangeRate > 0) {
        homeRatesKnown += 1;
        homeInvoiceValue = round2(homeInvoiceValue + (i.customerInvoiceValue ?? 0) * i.exchangeRate);
        homeReceived = round2(homeReceived + i.money.totalReceived * i.exchangeRate);
        homeOutstanding = round2(homeOutstanding + outstanding * i.exchangeRate);
      }

      if (i.money.totalForexGainLoss !== null) {
        forex = round2(forex + i.money.totalForexGainLoss);
        forexSeen = true;
      }

      if (outstanding > 0.01) {
        ageing[i.ageing] = round2((ageing[i.ageing] ?? 0) + outstanding);
        if (i.schedule.dueDate) assessable = round2(assessable + outstanding);
        else {
          requiresVerification = round2(requiresVerification + outstanding);
          requiresVerificationInvoices += 1;
        }
        if (i.money.totalReceived <= 0.01) {
          nilReceived += 1;
          nilReceivedAmount = round2(nilReceivedAmount + outstanding);
        }
        if (i.status === "DUE_SOON") {
          dueSoon += 1;
          dueSoonAmount = round2(dueSoonAmount + outstanding);
        }
      }
      if (i.schedule.overdueAmount > 0.01) {
        overdueOutstanding = round2(overdueOutstanding + i.schedule.overdueAmount);
        overdueInvoices += 1;
      }
      if (i.needsAttention) {
        needsAttention += 1;
        needsAttentionAmount = round2(needsAttentionAmount + outstanding);
      }
    }

    out.push({
      currency,
      invoices: list.length,
      customers: new Set(list.map((i) => i.customerId ?? "~none")).size,
      totalInvoiceValue,
      totalReceived,
      totalOutstanding,
      collectionRate:
        totalInvoiceValue > 0 ? Math.round((totalReceived / totalInvoiceValue) * 1000) / 10 : 0,
      overdueOutstanding,
      overdueInvoices,
      assessable,
      requiresVerification,
      requiresVerificationInvoices,
      needsAttention,
      needsAttentionAmount,
      nilReceived,
      nilReceivedAmount,
      dueSoon,
      dueSoonAmount,
      ageing,
      statuses,
      forexGainLoss: forexSeen ? forex : null,
      ageingSummary: ageingSummary(list, params.ageingBuckets),
      homeInvoiceValue,
      homeReceived,
      homeOutstanding,
      homeRatesKnown,
    });
  }

  out.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  return out;
}

// ---------------------------------------------------------------------------
// Filtering and sorting
// ---------------------------------------------------------------------------

export interface TrackingFilters {
  q?: string;
  /** Invoice number only — the Reports page's own box. */
  inv?: string;
  customer?: string;
  currency?: string;
  status?: string;
  ageing?: string;
  po?: string;
  term?: string;
  from?: string;
  to?: string;
  /** invoice | due | overdue — see DATE_FIELDS. */
  dateField?: string;
  attention?: string;
  nilReceived?: string;
  verify?: string;
  open?: string;
  sort?: string;
  dir?: string;
  group?: string;
}

/**
 * What "Date Range On" can filter by.
 *
 *   Invoice Date  the date the invoice was raised
 *   Due Date      the date it falls (or fell) due — the next portion still owing
 *   Overdue Date  the day it became overdue: the day after its due date, for an
 *                 invoice that still owes money past that date. An invoice that
 *                 is not overdue has no overdue date and is left out of a range
 *                 on it.
 */
export const DATE_FIELDS = {
  invoice: "Invoice Date",
  due: "Due Date",
  overdue: "Overdue Date",
} as const;

export type DateField = keyof typeof DATE_FIELDS;

export function isDateField(v: string | null | undefined): v is DateField {
  return !!v && v in DATE_FIELDS;
}

/** The date an invoice is filtered by, for the chosen field. */
export function dateFor(i: TrackedInvoice, field: DateField): string | null {
  if (field === "due") return i.schedule.dueDate;
  if (field === "overdue") return i.overdueSince;
  return i.invoiceDate;
}

/** The URL parameters every filter screen and every export understands. */
export const FILTER_KEYS = [
  "q", "inv", "customer", "currency", "status", "ageing", "po", "term",
  "from", "to", "dateField", "attention", "nilReceived", "verify", "open",
  "sort", "dir", "group",
] as const;

/** Filters read from a URL, keeping only the known keys and non-blank values. */
export function filtersFrom(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
): TrackingFilters {
  const out: TrackingFilters = {};
  for (const k of FILTER_KEYS) {
    const raw = source instanceof URLSearchParams ? source.get(k) : source[k];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
  }
  // "date range on" means nothing without a date: the form always sends it
  if (!out.from && !out.to) delete out.dateField;
  return out;
}

/** The filters that narrow the rows — sorting and grouping are not filters. */
export function activeFilters(f: TrackingFilters): Array<[string, string]> {
  return Object.entries(f).filter(
    ([k, v]) => v && k !== "sort" && k !== "dir" && k !== "group",
  ) as Array<[string, string]>;
}

const FILTER_LABELS: Record<string, string> = {
  q: "Search",
  inv: "Invoice no.",
  customer: "Customer",
  currency: "Currency",
  status: "Status",
  ageing: "Ageing",
  po: "PO",
  term: "Payment terms",
  from: "From",
  to: "To",
  dateField: "Date range on",
  open: "Outstanding only",
  attention: "Needs attention",
  nilReceived: "Nothing received",
  verify: "Requires verification",
};

/** The filters in force, as a reader would say them: "Customer: Terry Stone". */
export function describeFilters(f: TrackingFilters): string[] {
  return activeFilters(f).map(([k, v]) => {
    const label = FILTER_LABELS[k] ?? k;
    if (k === "dateField") return `${label}: ${DATE_FIELDS[v as DateField] ?? v}`;
    if (k === "status") return `${label}: ${STATUS_LABELS[v as TrackingStatus] ?? v}`;
    if (v === "1") return label;
    return `${label}: ${v}`;
  });
}

/** A filter set as a query string, for links and exports. */
export function toQuery(f: TrackingFilters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, String(v));
  return p.toString();
}

/**
 * Apply the filter bar.
 *
 * In memory, deliberately: outstanding, status, ageing and "needs attention"
 * are all computed on read and none of them is a database column, so filtering
 * the computed rows is the only way the filters can mean what they say.
 */
export function filterInvoices(rows: TrackedInvoice[], f: TrackingFilters): TrackedInvoice[] {
  const q = f.q?.trim().toLowerCase();
  const inv = f.inv?.trim().toLowerCase();
  const field: DateField = isDateField(f.dateField) ? f.dateField : "invoice";

  const out = rows.filter((i) => {
    const outstanding = i.money.calculatedOutstanding ?? 0;
    if (f.open === "1" && outstanding <= 0.01) return false;
    if (f.customer && (i.customerName ?? "") !== f.customer) return false;
    if (f.currency && (i.currency ?? "") !== f.currency) return false;
    if (f.status && i.status !== f.status) return false;
    if (f.ageing && i.ageing !== f.ageing) return false;
    if (f.po && (i.poNo ?? "") !== f.po) return false;
    if (f.term && i.schedule.term.raw !== f.term) return false;
    if (f.attention === "1" && !i.needsAttention) return false;
    if (f.nilReceived === "1" && i.money.totalReceived > 0.01) return false;
    if (f.verify === "1" && i.status !== "REQUIRES_VERIFICATION") return false;

    if (inv && !(i.invoiceNo ?? "").toLowerCase().includes(inv)) return false;

    if (f.from || f.to) {
      const date = dateFor(i, field);
      if (!date) return false;
      if (f.from && date < f.from) return false;
      if (f.to && date > f.to) return false;
    }

    if (q) {
      const hay = [
        i.invoiceNo, i.customerName, i.poNo, i.piNo, i.containerNo, i.blNo,
        i.shippingBillNo, i.paymentTerms, i.remarks, i.followUpNotes, i.consignee, i.notifyParty,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return sortInvoices(out, f);
}

const SORTABLE = {
  urgency: (i: TrackedInvoice) => i.urgency,
  invoiceNo: (i: TrackedInvoice) => i.invoiceNo ?? "",
  customer: (i: TrackedInvoice) => i.customerName ?? "",
  invoiceDate: (i: TrackedInvoice) => i.invoiceDate ?? "",
  dueDate: (i: TrackedInvoice) => i.schedule.dueDate ?? "",
  blDate: (i: TrackedInvoice) => i.blDate ?? "",
  invoiceValue: (i: TrackedInvoice) => i.customerInvoiceValue ?? 0,
  received: (i: TrackedInvoice) => i.money.totalReceived,
  outstanding: (i: TrackedInvoice) => i.money.calculatedOutstanding ?? 0,
  overdueDays: (i: TrackedInvoice) => i.overdueDays ?? -99999,
  invoiceAge: (i: TrackedInvoice) => i.invoiceAge ?? -1,
  collectedPct: (i: TrackedInvoice) => i.money.collectedPct ?? -1,
  poNo: (i: TrackedInvoice) => i.poNo ?? "",
  status: (i: TrackedInvoice) => STATUS_LABELS[i.status],
  forex: (i: TrackedInvoice) => i.money.totalForexGainLoss ?? 0,
} as const;

export type SortKey = keyof typeof SORTABLE;

export function isSortKey(v: string | null | undefined): v is SortKey {
  return !!v && v in SORTABLE;
}

function sortInvoices(rows: TrackedInvoice[], f: TrackingFilters): TrackedInvoice[] {
  const key: SortKey = isSortKey(f.sort) ? f.sort : "outstanding";
  const dir = f.dir === "asc" ? 1 : -1;
  const pick = SORTABLE[key];

  return [...rows].sort((a, b) => {
    const av = pick(a);
    const bv = pick(b);
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv)) * dir;
    }
    if (av === bv) return (a.invoiceNo ?? "").localeCompare(b.invoiceNo ?? "");
    return (Number(av) - Number(bv)) * dir;
  });
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export const GROUPINGS = {
  none: "No grouping",
  customer: "By customer",
  month: "By invoice month",
  po: "By PO number",
  status: "By status",
} as const;

export type Grouping = keyof typeof GROUPINGS;

export function isGrouping(v: string | null | undefined): v is Grouping {
  return !!v && v in GROUPINGS;
}

export interface InvoiceGroup {
  key: string;
  label: string;
  sub: string;
  rows: TrackedInvoice[];
  totals: {
    currency: string;
    invoices: number;
    invoiceValue: number;
    received: number;
    outstanding: number;
    overdue: number;
    collectedPct: number;
    dueDatesKnown: number;
    needsAttention: number;
  };
}

export function groupInvoices(rows: TrackedInvoice[], grouping: Grouping): InvoiceGroup[] {
  if (grouping === "none") {
    return rows.length ? [build("all", "All invoices", rows)] : [];
  }

  const buckets = new Map<string, { label: string; rows: TrackedInvoice[] }>();
  for (const i of rows) {
    const { key, label } = keyOf(i, grouping);
    const b = buckets.get(key);
    if (b) b.rows.push(i);
    else buckets.set(key, { label, rows: [i] });
  }

  const groups = [...buckets.entries()].map(([k, b]) => build(k, b.label, b.rows));
  if (grouping === "month") groups.sort((a, b) => b.key.localeCompare(a.key));
  else if (grouping === "status") {
    groups.sort((a, b) => b.totals.outstanding - a.totals.outstanding);
  } else groups.sort((a, b) => b.totals.outstanding - a.totals.outstanding);
  return groups;
}

function keyOf(i: TrackedInvoice, grouping: Grouping): { key: string; label: string } {
  if (grouping === "customer") {
    return {
      key: `${i.customerId ?? "~none"}::${i.currency ?? "—"}`,
      label: i.customerName ?? "No customer recorded",
    };
  }
  if (grouping === "po") {
    const po = (i.poNo ?? "").trim();
    return po ? { key: `po:${po}`, label: `PO ${po}` } : { key: "po:~none", label: "No PO recorded" };
  }
  if (grouping === "status") {
    return { key: `st:${i.status}`, label: STATUS_LABELS[i.status] };
  }
  const date = i.invoiceDate;
  return date
    ? { key: date.slice(0, 7), label: monthLabel(date.slice(0, 7)) }
    : { key: "~nodate", label: "No invoice date" };
}

function build(key: string, label: string, rows: TrackedInvoice[]): InvoiceGroup {
  const currencies = new Set(rows.map((i) => i.currency ?? "—"));
  let invoiceValue = 0, received = 0, outstanding = 0, overdue = 0;
  let dueDatesKnown = 0, needsAttention = 0;

  for (const i of rows) {
    invoiceValue = round2(invoiceValue + (i.customerInvoiceValue ?? 0));
    received = round2(received + i.money.totalReceived);
    outstanding = round2(outstanding + (i.money.calculatedOutstanding ?? 0));
    overdue = round2(overdue + i.schedule.overdueAmount);
    if (i.schedule.dueDate) dueDatesKnown += 1;
    if (i.needsAttention) needsAttention += 1;
  }

  const currency = currencies.size === 1 ? [...currencies][0] : "mixed";
  const collectedPct = invoiceValue > 0 ? Math.round((received / invoiceValue) * 1000) / 10 : 0;

  // grouped the way the currency is written: USD 250,139.19, never 2,50,139.19
  const cur = currency === "mixed" ? null : currency;
  const bits = [
    `${rows.length} invoice(s)`,
    `${formatMoney(outstanding, cur)} outstanding`,
    `${collectedPct}% collected`,
  ];
  if (overdue > 0.01) bits.push(`${formatMoney(overdue, cur)} past due`);
  if (dueDatesKnown < rows.length) bits.push(`due dates known for ${dueDatesKnown} of ${rows.length}`);
  if (needsAttention) bits.push(`${needsAttention} needing attention`);

  return {
    key,
    label,
    sub: bits.join(" · "),
    rows,
    totals: {
      currency,
      invoices: rows.length,
      invoiceValue,
      received,
      outstanding,
      overdue,
      collectedPct,
      dueDatesKnown,
      needsAttention,
    },
  };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const i = Number(m) - 1;
  return MONTHS[i] ? `${MONTHS[i]} ${y}` : ym;
}

// ---------------------------------------------------------------------------
// One customer, one invoice
// ---------------------------------------------------------------------------

/** Everything for one customer's screen. */
export async function loadCustomer(id: string) {
  const view = await loadTracking();
  const invoices = view.invoices.filter((i) => i.customerId === id);
  const customer = await prisma.ptCustomer.findUnique({ where: { id } });
  return {
    customer,
    invoices,
    summary: summarise(invoices),
    kpis: kpisFrom(invoices, view.params),
    today: view.today,
    params: view.params,
  };
}

/** One invoice, with its term explained in full. */
export async function loadInvoice(id: string) {
  const view = await loadTracking();
  const invoice = view.invoices.find((i) => i.id === id) ?? null;
  const customers = await prisma.ptCustomer.findMany({ orderBy: { name: "asc" } });
  return {
    invoice,
    customers,
    today: view.today,
    params: view.params,
    /** Other invoices for the same customer, for the "see also" list. */
    siblings: invoice
      ? view.invoices.filter((i) => i.customerId === invoice.customerId && i.id !== id)
      : [],
  };
}

export { readTerm, STATUS_LABELS };
