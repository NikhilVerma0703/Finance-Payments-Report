/**
 * The dashboard's received timeline and the pending-only view (owner, 24 Oct
 * 2026: "we should have Received timeline too on dashboard"; "Only pending
 * invoices should show as default").
 *
 * TODAY is Monday 12 Oct 2026, so this week runs 12–18 Oct.
 */
import { describe, expect, it } from "vitest";

import { buildOnAccount } from "@/lib/payments/onAccount";
import { receivedByWeek } from "@/lib/payments/overview";
import { filterInvoices, isPending, showsAll } from "@/server/payments/query";
import { TODAY, tracked } from "./helpers";

const book = [
  tracked({
    id: "a",
    receipts: [
      { seq: 1, receiptDate: "2026-10-13", amountFcy: 100 },
      { seq: 2, receiptDate: "2026-10-05", amountFcy: 50 },
    ],
  }),
  // cleared: its receipt still came in this week
  tracked({ id: "b", customerInvoiceValue: 300, receipts: [{ seq: 1, receiptDate: "2026-10-14", amountFcy: 300 }] }),
  tracked({ id: "c", receipts: [{ seq: 1, receiptDate: "2026-06-01", amountFcy: 70 }] }),
  tracked({ id: "d", receipts: [{ seq: 1, receiptDate: null, amountFcy: 30 }] }),
  // dated after this week — a slip, but still money in
  tracked({ id: "e", receipts: [{ seq: 1, receiptDate: "2026-11-20", amountFcy: 20 }] }),
];

const held = [
  buildOnAccount({
    id: "oa", customerId: "c", customerName: "C", kind: "RECEIPT", entryDate: "2026-10-06", amount: 25,
    currency: "USD", exchangeRate: null, reference: null, remarks: null, attributions: [],
  }),
];

describe("what came in, week by week", () => {
  const weeks = receivedByWeek(book, held, TODAY);
  const col = (key: string) => weeks.find((w) => w.key === key)!;

  it("shows Earlier, twelve weeks and this one, Later and No date", () => {
    expect(weeks.map((w) => w.kind)).toEqual(["earlier", ...Array(12).fill("past"), "now", "later", "nodate"]);
    expect(col("2026-10-12").label).toBe("This week");
    expect(col("earlier").to).toBe("2026-07-19");
  });

  it("counts every receipt by its own date, a cleared invoice's too", () => {
    expect(col("2026-10-12")).toMatchObject({ amount: 400, receipts: 2, invoices: 2 });
  });

  it("counts money booked on account by the date it was booked", () => {
    expect(col("2026-10-05")).toMatchObject({ amount: 75, receipts: 2, invoices: 1 });
  });

  it("keeps the old, the undated and the future-dated in their own columns", () => {
    expect(col("earlier").amount).toBe(70);
    expect(col("nodate").amount).toBe(30);
    expect(col("later").amount).toBe(20);
  });

  it("adds up to everything received", () => {
    expect(weeks.reduce((s, w) => s + w.amount, 0)).toBe(595);
  });
});

describe("a week's link: invoices by receipt date", () => {
  it("finds an invoice by any of its receipts, not only the last", () => {
    const ids = (from: string, to: string) => filterInvoices(book, { dateField: "receipt", from, to }).map((i) => i.id).sort();
    expect(ids("2026-10-12", "2026-10-18")).toEqual(["a", "b"]);
    expect(ids("2026-10-05", "2026-10-11")).toEqual(["a"]);
  });
});

describe("the pending-only view", () => {
  it("shows every invoice not paid in full: unpaid, part paid, nearly settled, with no value", () => {
    expect(isPending(tracked({ customerInvoiceValue: 1000 }))).toBe(true);
    expect(isPending(tracked({ receipts: [{ seq: 1, amountFcy: 400 }] }))).toBe(true);
    expect(isPending(tracked({ receipts: [{ seq: 1, amountFcy: 995 }] }))).toBe(true);
    expect(isPending(tracked({ customerInvoiceValue: null }))).toBe(true);
  });

  it("leaves out the cleared: paid and overpaid", () => {
    expect(isPending(tracked({ receipts: [{ seq: 1, amountFcy: 1000 }] }))).toBe(false);
    expect(isPending(tracked({ receipts: [{ seq: 1, amountFcy: 1200 }] }))).toBe(false);
  });

  it("is switched off by ?show=all and nothing else", () => {
    expect(showsAll("all")).toBe(true);
    expect(showsAll(["all"])).toBe(true);
    expect(showsAll(undefined)).toBe(false);
    expect(showsAll("pending")).toBe(false);
  });
});
