/**
 * Payment Tracking's additions of 25 Oct 2026 — completed invoices, the
 * advanced filters and the ageing analysis — with made-up invoices (TEST/EN/…,
 * USD). TODAY is 12 Oct 2026; the default credit period is off, so each
 * invoice's due date is the one it is given here.
 */
import { describe, expect, it } from "vitest";

import { ageingAnalysis } from "@/lib/payments/ageingReport";
import { isSettled, splitCompleted, type Completion } from "@/lib/payments/completed";
import { buildTrackedInvoice, TRACKING_DEFAULTS, type TrackedInvoice, type TrackedInvoiceInput } from "@/lib/payments/record";
import { advancedMatch, describeFilters, filterInvoices } from "@/server/payments/query";

const TODAY = "2026-10-12";
const params = { ...TRACKING_DEFAULTS, defaultDueDays: 0 };

function tracked(over: Partial<TrackedInvoiceInput>): TrackedInvoice {
  return buildTrackedInvoice(
    {
      id: "x", customerId: "c1", customerName: "Test Customer A",
      invoiceNo: "TEST/EN/1", invoiceDate: "2026-05-01",
      customerInvoiceValue: 1000, customsInvoiceValue: null,
      exchangeRate: null, currency: "USD",
      consignee: null, notifyParty: null, country: "Poland",
      paymentTerms: null, enteredDueDate: null,
      piNo: null, poNo: null, shippingBillNo: null, shippingBillDate: null,
      blNo: null, blDate: null, containerNo: null, eta: null, docsPresentedDate: null,
      booksBalance: null, remarks: null, followUpNotes: null,
      source: "EXCEL", sourceFile: null, sourceAsOn: null,
      receipts: [], notes: [],
      ...over,
    },
    { today: TODAY, params },
  );
}

const paid = tracked({ id: "paid", enteredDueDate: "2026-06-01", receipts: [{ seq: 1, amountFcy: 1000 }] });
const owing = tracked({ id: "owing", enteredDueDate: "2026-09-01", customerInvoiceValue: 2000 });
const later = tracked({ id: "later", customerId: "c2", customerName: "Test Customer B", enteredDueDate: "2026-12-01", customerInvoiceValue: 500, country: "Mexico", source: "MANUAL" });
const undated = tracked({ id: "undated", customerId: "c2", customerName: "Test Customer B", customerInvoiceValue: 300 });
const at: Completion = { at: "2026-10-10T09:00:00.000Z", by: "Test Login", note: null };

describe("completed invoices", () => {
  it("leave the active list only while they stay settled", () => {
    expect(isSettled(paid)).toBe(true);
    expect(isSettled(owing)).toBe(false);
    const { active, completed } = splitCompleted([paid, owing, later], new Map([["paid", at]]));
    expect(completed.map((i) => i.id)).toEqual(["paid"]);
    expect(completed[0]!.completion).toEqual(at);
    expect(active.map((i) => i.id)).toEqual(["owing", "later"]);
  });

  it("come back, saying why, when money is owed on them again", () => {
    const { active, completed } = splitCompleted([owing], new Map([["owing", at]]));
    expect(completed).toEqual([]);
    expect(active[0]!.needsAttention).toBe(true);
    expect(active[0]!.attentionReasons[0]).toMatch(/^Marked completed on .+, but money is owed on it again$/);
  });

  it("change no figure: the active list is the invoices as they were", () => {
    const { active } = splitCompleted([owing, later], new Map());
    expect(active).toEqual([owing, later]);
  });
});

describe("the advanced filters", () => {
  const book = [paid, owing, later, undated];
  const ids = (f: Parameters<typeof filterInvoices>[1]) => filterInvoices(book, f).map((i) => i.id).sort();

  it("bound the outstanding balance, the invoice value and the days overdue", () => {
    expect(ids({ omin: "400" })).toEqual(["later", "owing"]);
    expect(ids({ vmin: "600", vmax: "1500" })).toEqual(["paid"]);
    expect(ids({ dmin: "1" })).toEqual(["owing", "paid"]);
    expect(ids({ dmax: "-1" })).toEqual(["later"]);
  });

  it("pick a country, a source and a missing field", () => {
    expect(ids({ country: "mexico" })).toEqual(["later"]);
    expect(ids({ src: "MANUAL" })).toEqual(["later"]);
    expect(ids({ missing: "due" })).toEqual(["undated"]);
    expect(advancedMatch(owing, {})).toBe(true);
  });

  it("are said in words", () => {
    expect(describeFilters({ omin: "400", src: "EXCEL", missing: "bl" })).toEqual(["Outstanding from: 400", "Source: uploaded sheet", "Missing: BL date"]);
  });
});

describe("the ageing analysis", () => {
  const a = ageingAnalysis([paid, owing, later, undated], params.ageingBuckets);

  it("puts every open invoice in one category, and adds up", () => {
    expect(a.labels[0]).toBe("No due date");
    expect(a.kpis.outstanding).toBe(2800);
    expect(a.buckets.reduce((s, b) => s + b.amount, 0)).toBe(2800);
    expect(a.kpis.notYetDue).toBe(500);
    expect(a.kpis.noDueDate).toBe(300);
    expect(a.kpis.overdue).toBe(2000);
    expect(a.kpis.overduePct).toBe(71.4);
    expect(a.kpis.avgDaysOverdue).toBe(41);
    expect(a.kpis.customersOverdue).toBe(1);
  });

  it("lays the balance out by customer, the biggest first", () => {
    expect(a.rows.map((r) => [r.customer, r.total])).toEqual([
      ["Test Customer A", 2000],
      ["Test Customer B", 800],
    ]);
  });

  it("counts every status, paid ones too, and names the largest overdue", () => {
    expect(a.statuses.reduce((s, x) => s + x.invoices, 0)).toBe(4);
    expect(a.statuses.find((s) => s.status === "PAID")?.invoices).toBe(1);
    expect(a.topOverdue.map((i) => i.id)).toEqual(["owing"]);
  });
});
