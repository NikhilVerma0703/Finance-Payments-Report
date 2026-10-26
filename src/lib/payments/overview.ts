/**
 * The figures the dashboard's overview draws, from the tracked invoices.
 *
 * Pure: no database and no React, so what each strip and chart claims can be
 * checked against plain numbers. Every function takes invoices of one currency
 * — a chart that adds dollars to euros has no unit on its axis.
 */
import { addDays, round2 } from "../text";
import type { OnAccountEntry } from "./onAccount";
import type { TrackedInvoice } from "./record";

// ---------------------------------------------------------------------------
// Receipts by month
// ---------------------------------------------------------------------------

export interface MonthPoint {
  /** YYYY-MM */
  month: string;
  amount: number;
}

/**
 * What arrived in each of the last `months` calendar months, this one
 * included: every receipt on an invoice, by its own date, and what is still on
 * account — the attributed part is already among the invoices' receipts.
 * Receipts with no date cannot be placed in a month and are counted apart.
 */
export function receiptsByMonth(
  invoices: TrackedInvoice[],
  onAccount: OnAccountEntry[],
  today: string,
  months = 12,
): { points: MonthPoint[]; undated: number } {
  const keys: string[] = [];
  const [y, m] = today.split("-").map(Number);
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  const sums = new Map(keys.map((k) => [k, 0]));
  let undated = 0;

  const add = (date: string | null, amount: number) => {
    if (!amount) return;
    if (!date) {
      undated = round2(undated + amount);
      return;
    }
    const k = date.slice(0, 7);
    if (sums.has(k)) sums.set(k, round2((sums.get(k) ?? 0) + amount));
  };

  for (const i of invoices) for (const r of i.money.receipts) add(r.receiptDate, r.amountFcy ?? 0);
  for (const e of onAccount) if (e.kind === "RECEIPT") add(e.entryDate, e.unattributed);

  return { points: keys.map((month) => ({ month, amount: sums.get(month) ?? 0 })), undated };
}

/**
 * This month so far against the same days of last month — the 1st to today's
 * date in each — so a month that is a third gone is not compared with a whole
 * one. `change` is a percentage, null when last month had nothing to compare.
 */
export function monthToDate(
  invoices: TrackedInvoice[],
  onAccount: OnAccountEntry[],
  today: string,
): { now: number; before: number; change: number | null; previousMonth: string } {
  const [y, m, d] = today.split("-").map(Number);
  const previousMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const thisMonth = today.slice(0, 7);
  let now = 0;
  let before = 0;
  const add = (date: string | null, amount: number) => {
    if (!date || !amount) return;
    const month = date.slice(0, 7);
    if (month === thisMonth && date <= today) now += amount;
    else if (month === previousMonth && Number(date.slice(8, 10)) <= d) before += amount;
  };
  for (const i of invoices) for (const r of i.money.receipts) add(r.receiptDate, r.amountFcy ?? 0);
  for (const e of onAccount) if (e.kind === "RECEIPT") add(e.entryDate, e.unattributed);
  now = round2(now);
  before = round2(before);
  return {
    now,
    before,
    change: before > 0.01 ? Math.round(((now - before) / before) * 1000) / 10 : null,
    previousMonth,
  };
}

// ---------------------------------------------------------------------------
// What falls due, week by week
// ---------------------------------------------------------------------------

export type WeekKind = "older" | "overdue" | "now" | "ahead" | "later" | "nodate";

export interface WeekColumn {
  key: string;
  kind: WeekKind;
  /** "19 Oct", or "Older", "Later", "No date". */
  label: string;
  /** The Monday and Sunday of the week, for a link to those invoices. */
  from: string | null;
  to: string | null;
  amount: number;
  /** How many invoices have money falling due in it. */
  invoices: number;
}

/**
 * What an invoice still owes and when each part of it falls due: portion by
 * portion where the terms have several — 30% now and 70% in ninety days are
 * two different dates — and the whole balance on its date where a due date was
 * entered by hand. Nothing for an invoice that owes nothing.
 */
export function owingParts(i: TrackedInvoice): Array<{ due: string | null; amount: number }> {
  const owing = i.money.calculatedOutstanding ?? 0;
  if (owing <= 0.01) return [];
  return i.schedule.dueDateSource === "entered" || i.schedule.milestones.length === 0
    ? [{ due: i.schedule.dueDate, amount: owing }]
    : i.schedule.milestones.filter((ms) => ms.outstanding > 0.01).map((ms) => ({ due: ms.dueDate, amount: ms.outstanding }));
}

/** The Monday of the week a date falls in. */
export function weekStart(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1]}`;

/**
 * The outstanding balance laid out by the week it falls (or fell) due.
 *
 * Portion by portion where the terms have several — 30% now and 70% in ninety
 * days are two different weeks — and the whole balance on its date where a due
 * date was entered by hand. `back` weeks of overdue money are shown one by one
 * with everything earlier in "Older"; `ahead` weeks after this one, with
 * everything beyond in "Later". Money with no due date has its own column, so
 * the strip always adds up to the whole balance.
 */
export function dueByWeek(
  invoices: TrackedInvoice[],
  today: string,
  back = 4,
  ahead = 7,
): WeekColumn[] {
  const thisWeek = weekStart(today);
  const columns: WeekColumn[] = [];
  const firstShown = addDays(thisWeek, -7 * back);
  const lastShown = addDays(thisWeek, 7 * ahead + 6);

  columns.push({ key: "older", kind: "older", label: "Older", from: null, to: addDays(firstShown, -1), amount: 0, invoices: 0 });
  for (let w = -back; w <= ahead; w += 1) {
    const from = addDays(thisWeek, 7 * w);
    columns.push({
      key: from,
      kind: w < 0 ? "overdue" : w === 0 ? "now" : "ahead",
      label: w === 0 ? "This week" : short(from),
      from,
      to: addDays(from, 6),
      amount: 0,
      invoices: 0,
    });
  }
  columns.push({ key: "later", kind: "later", label: "Later", from: addDays(lastShown, 1), to: null, amount: 0, invoices: 0 });
  columns.push({ key: "nodate", kind: "nodate", label: "No date", from: null, to: null, amount: 0, invoices: 0 });

  const byKey = new Map(columns.map((c) => [c.key, c]));
  const columnFor = (due: string | null): WeekColumn => {
    if (!due) return byKey.get("nodate")!;
    if (due < firstShown) return byKey.get("older")!;
    if (due > lastShown) return byKey.get("later")!;
    return byKey.get(weekStart(due))!;
  };

  for (const i of invoices) {
    const touched = new Set<string>();
    for (const p of owingParts(i)) {
      const col = columnFor(p.due);
      col.amount = round2(col.amount + p.amount);
      if (!touched.has(col.key)) {
        col.invoices += 1;
        touched.add(col.key);
      }
    }
  }
  return columns;
}

// ---------------------------------------------------------------------------
// What came in, week by week
// ---------------------------------------------------------------------------

export type ReceivedKind = "earlier" | "past" | "now" | "later" | "nodate";

export interface ReceivedColumn {
  key: string;
  kind: ReceivedKind;
  /** "19 Oct", or "Earlier", "This week", "Later", "No date". */
  label: string;
  /** The Monday and Sunday of the week, for a link to those invoices. */
  from: string | null;
  to: string | null;
  amount: number;
  /** How many receipts came in, money booked on account included. */
  receipts: number;
  /** How many invoices they were received against. */
  invoices: number;
}

/**
 * What came in, laid out by the week it was received, Monday to Sunday — the
 * received side of the falling-due strip (owner, 24 Oct 2026: "we should have
 * Received timeline too on dashboard").
 *
 * Every receipt on an invoice counts by its own date, cleared invoices
 * included: it is a record of money in, not of what is still owed. Money still
 * on account counts by the date it was booked (the part already attributed is
 * among the invoices' receipts). `back` weeks before this one are shown one by
 * one, with everything before them in "Earlier"; a receipt dated after this
 * week (a typing slip, usually) goes in "Later", and one with no date has its
 * own column, so the strip always adds up to everything received.
 */
export function receivedByWeek(
  invoices: TrackedInvoice[],
  onAccount: OnAccountEntry[],
  today: string,
  back = 12,
): ReceivedColumn[] {
  const thisWeek = weekStart(today);
  const firstShown = addDays(thisWeek, -7 * back);
  const lastShown = addDays(thisWeek, 6);
  const columns: ReceivedColumn[] = [
    { key: "earlier", kind: "earlier", label: "Earlier", from: null, to: addDays(firstShown, -1), amount: 0, receipts: 0, invoices: 0 },
  ];
  for (let w = -back; w <= 0; w += 1) {
    const from = addDays(thisWeek, 7 * w);
    columns.push({
      key: from,
      kind: w === 0 ? "now" : "past",
      label: w === 0 ? "This week" : short(from),
      from,
      to: addDays(from, 6),
      amount: 0,
      receipts: 0,
      invoices: 0,
    });
  }
  columns.push({ key: "later", kind: "later", label: "Later", from: addDays(lastShown, 1), to: null, amount: 0, receipts: 0, invoices: 0 });
  columns.push({ key: "nodate", kind: "nodate", label: "No date", from: null, to: null, amount: 0, receipts: 0, invoices: 0 });

  const byKey = new Map(columns.map((c) => [c.key, c]));
  const columnFor = (date: string | null): ReceivedColumn => {
    if (!date) return byKey.get("nodate")!;
    if (date < firstShown) return byKey.get("earlier")!;
    if (date > lastShown) return byKey.get("later")!;
    return byKey.get(weekStart(date))!;
  };

  for (const i of invoices) {
    const touched = new Set<string>();
    for (const r of i.money.receipts) {
      const amount = r.amountFcy ?? 0;
      if (!amount) continue;
      const col = columnFor(r.receiptDate);
      col.amount = round2(col.amount + amount);
      col.receipts += 1;
      if (!touched.has(col.key)) {
        col.invoices += 1;
        touched.add(col.key);
      }
    }
  }
  for (const e of onAccount) {
    if (e.kind !== "RECEIPT" || e.unattributed <= 0) continue;
    const col = columnFor(e.entryDate);
    col.amount = round2(col.amount + e.unattributed);
    col.receipts += 1;
  }
  return columns;
}

/** Days left in the month, and how far through it today is, for the month card. */
export function monthProgress(today: string): { day: number; days: number; pct: number } {
  const [y, m, d] = today.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { day: d, days, pct: Math.round((d / days) * 100) };
}
