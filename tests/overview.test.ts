/**
 * The dashboard overview's figures: the week-by-week strip adds up to the
 * whole balance, portions land in their own weeks, and month-to-date compares
 * like with like.
 */
import { describe, expect, it } from "vitest";

import { dueByWeek, monthToDate, receiptsByMonth, weekStart } from "@/lib/payments/overview";
import { TODAY, tracked } from "./helpers";

describe("weeks", () => {
  it("start on a Monday", () => {
    expect(weekStart("2026-10-12")).toBe("2026-10-12"); // a Monday
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // the Sunday after
    expect(weekStart("2026-10-23")).toBe("2026-10-19");
  });
});

describe("what falls due, week by week", () => {
  const book = [
    // due 2026-10-14, this week; 1000 owing
    tracked({ id: "a", enteredDueDate: "2026-10-14" }),
    // 30% at the BL date (long past), 70% ninety days after it
    tracked({
      id: "b",
      customerInvoiceValue: 2000,
      paymentTerms: "30% at BL Date, 70% at 90 days from BL Date",
      blDate: "2026-07-01",
    }),
    // no terms, so no date
    tracked({ id: "c", customerInvoiceValue: 500 }),
    // paid
    tracked({ id: "d", customerInvoiceValue: 300, receipts: [{ seq: 1, amountFcy: 300 }] }),
  ];
  const cols = dueByWeek(book, TODAY);
  const by = (k: string) => cols.find((c) => c.key === k || c.kind === k)!;

  it("adds up to the whole outstanding balance", () => {
    expect(cols.reduce((s, c) => s + c.amount, 0)).toBe(1000 + 2000 + 500);
  });

  it("puts each portion in the week it falls due", () => {
    expect(by("now").amount).toBe(1000);
    expect(by("nodate").amount).toBe(500);
    // 30% fell due 2026-07-01, before the four weeks shown; 70% on 2026-09-29,
    // in the overdue week of Monday 28 September
    expect(by("older").amount).toBe(600);
    expect(by("2026-09-28")).toMatchObject({ kind: "overdue", amount: 1400 });
  });

  it("counts an invoice once per column", () => {
    expect(by("older").invoices).toBe(1);
    expect(by("2026-09-28").invoices).toBe(1);
    expect(cols.filter((c) => c.invoices > 0).length).toBe(4);
  });
});

describe("receipts over time", () => {
  const book = [
    tracked({
      receipts: [
        { seq: 1, receiptDate: "2026-10-05", amountFcy: 300 },
        { seq: 2, receiptDate: "2026-09-04", amountFcy: 200 },
        { seq: 3, receiptDate: "2026-09-25", amountFcy: 999 },
        { seq: 4, receiptDate: null, amountFcy: 50 },
      ],
    }),
  ];

  it("by month, with undated receipts kept apart", () => {
    const { points, undated } = receiptsByMonth(book, [], TODAY);
    expect(points).toHaveLength(12);
    expect(points.at(-1)).toEqual({ month: "2026-10", amount: 300 });
    expect(points.at(-2)).toEqual({ month: "2026-09", amount: 1199 });
    expect(undated).toBe(50);
  });

  it("this month so far against the same days of last month", () => {
    // 1–12 Oct: 300; 1–12 Sep: 200 (25 Sep is after the 12th)
    expect(monthToDate(book, [], TODAY)).toMatchObject({
      now: 300,
      before: 200,
      change: 50,
      previousMonth: "2026-09",
    });
  });
});
