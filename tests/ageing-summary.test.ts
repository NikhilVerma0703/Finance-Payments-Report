/**
 * The dashboard's ageing cards: every open invoice in exactly one bucket, the
 * buckets adding up to the outstanding, and "nothing received" kept apart.
 */
import { describe, expect, it } from "vitest";

import { ageingOrder, ageingSummary } from "@/lib/payments/ageing";
import { kpisFrom } from "@/server/payments/query";
import { tracked } from "./helpers";

// TODAY is 2026-10-12
const book = [
  // 10 days overdue, part paid
  tracked({ id: "a", enteredDueDate: "2026-10-02", customerInvoiceValue: 1000, receipts: [{ seq: 1, amountFcy: 400 }] }),
  // 45 days overdue, nothing received
  tracked({ id: "b", enteredDueDate: "2026-08-28", customerInvoiceValue: 2000 }),
  // 75 days overdue
  tracked({ id: "c", enteredDueDate: "2026-07-29", customerInvoiceValue: 3000, receipts: [{ seq: 1, amountFcy: 1000 }] }),
  // 200 days overdue, nothing received
  tracked({ id: "d", enteredDueDate: "2026-03-26", customerInvoiceValue: 500 }),
  // not yet due
  tracked({ id: "e", enteredDueDate: "2026-12-01", customerInvoiceValue: 700 }),
  // no due date at all — never an overdue bucket
  tracked({ id: "f", customerInvoiceValue: 900 }),
  // paid — in no bucket
  tracked({ id: "g", enteredDueDate: "2026-01-01", customerInvoiceValue: 300, receipts: [{ seq: 1, amountFcy: 300 }] }),
];

describe("the ageing summary", () => {
  const s = ageingSummary(book);
  const by = Object.fromEntries(s.buckets.map((b) => [b.label, b]));

  it("has the six categories in order", () => {
    expect(ageingOrder()).toEqual([
      "No due date",
      "Not yet due",
      "1–30 days",
      "31–60 days",
      "61–90 days",
      "Over 90 days",
    ]);
    expect(s.buckets.map((b) => b.label)).toEqual(ageingOrder());
  });

  it("puts each open invoice in exactly one bucket", () => {
    expect(by["1–30 days"]).toMatchObject({ count: 1, amount: 600 });
    expect(by["31–60 days"]).toMatchObject({ count: 1, amount: 2000 });
    expect(by["61–90 days"]).toMatchObject({ count: 1, amount: 2000 });
    expect(by["Over 90 days"]).toMatchObject({ count: 1, amount: 500 });
    expect(by["Not yet due"]).toMatchObject({ count: 1, amount: 700 });
    expect(by["No due date"]).toMatchObject({ count: 1, amount: 900 });
    expect(s.buckets.reduce((n, b) => n + b.count, 0)).toBe(s.openInvoices);
    expect(s.openInvoices).toBe(6);
  });

  it("adds up to the total outstanding — nothing counted twice", () => {
    const sum = s.buckets.reduce((n, b) => n + b.amount, 0);
    expect(sum).toBeCloseTo(s.totalOutstanding, 2);
    const [usd] = kpisFrom(book);
    expect(s.totalOutstanding).toBeCloseTo(usd.totalOutstanding, 2);
  });

  it("counts 'nothing received' separately, across the buckets", () => {
    // b, d, e and f have received nothing; g is paid and not open
    expect(s.nothingReceived).toMatchObject({ count: 4, amount: 2000 + 500 + 700 + 900 });
  });

  it("never puts an undated invoice in an overdue bucket", () => {
    const f = book.find((i) => i.id === "f")!;
    expect(f.ageing).toBe("No due date");
    expect(f.overdueSince).toBeNull();
  });

  it("a paid invoice is settled, not 'not due'", () => {
    expect(book.find((i) => i.id === "g")!.ageing).toBe("Settled");
  });

  it("comes with the KPIs, per currency", () => {
    const eur = tracked({ id: "h", currency: "EUR", enteredDueDate: "2026-09-01", customerInvoiceValue: 50 });
    const kpis = kpisFrom([...book, eur]);
    expect(kpis.map((k) => k.currency).sort()).toEqual(["EUR", "USD"]);
    const e = kpis.find((k) => k.currency === "EUR")!;
    expect(e.ageingSummary.totalOutstanding).toBe(50);
    expect(e.ageingSummary.buckets.find((b) => b.label === "31–60 days")!.count).toBe(1);
  });
});
