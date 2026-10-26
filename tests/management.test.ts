/**
 * The dashboard's working lists of 26 Oct 2026 — the upcoming schedule, the
 * priority follow-ups, the data-quality alerts and customer payment
 * performance — with made-up invoices (TEST/MG/…). TODAY is 12 Oct 2026; the
 * default credit period is off, so an invoice is dated only by what it is
 * given here.
 */
import { describe, expect, it } from "vitest";

import { clientKey } from "@/lib/payments/erpClients";
import {
  customerPerformance,
  dataQuality,
  isFollowUpStatus,
  isScheduleWindow,
  NO_FOLLOW_UP,
  priorityFollowUps,
  upcomingSchedule,
  type FollowUp,
} from "@/lib/payments/management";
import { buildTrackedInvoice, TRACKING_DEFAULTS, type TrackedInvoice, type TrackedInvoiceInput } from "@/lib/payments/record";

const TODAY = "2026-10-12";
const params = { ...TRACKING_DEFAULTS, defaultDueDays: 0 };

function tracked(over: Partial<TrackedInvoiceInput>): TrackedInvoice {
  return buildTrackedInvoice(
    {
      id: "x", customerId: "c1", customerName: "Test Customer A",
      invoiceNo: "TEST/MG/1", invoiceDate: "2026-05-01",
      customerInvoiceValue: 1000, customsInvoiceValue: null,
      exchangeRate: null, currency: "USD",
      consignee: null, notifyParty: null, country: null,
      paymentTerms: "manual", enteredDueDate: null,
      piNo: null, poNo: "PO-1", shippingBillNo: null, shippingBillDate: null,
      blNo: null, blDate: null, containerNo: null, eta: null, docsPresentedDate: null,
      booksBalance: null, remarks: null, followUpNotes: null,
      source: "EXCEL", sourceFile: null, sourceAsOn: null,
      receipts: [], notes: [], currencySource: "invoice",
      ...over,
    },
    { today: TODAY, params },
  );
}

describe("the upcoming payment schedule", () => {
  const book = [
    tracked({ id: "today", invoiceNo: "TEST/MG/T", enteredDueDate: "2026-10-12" }),
    tracked({ id: "in10", invoiceNo: "TEST/MG/10", enteredDueDate: "2026-10-22", customerInvoiceValue: 400, receipts: [{ seq: 1, receiptDate: "2026-10-01", amountFcy: 100 }] }),
    tracked({ id: "eur", invoiceNo: "TEST/MG/E", enteredDueDate: "2026-11-05", currency: "EUR", customerInvoiceValue: 250 }),
    tracked({ id: "late", invoiceNo: "TEST/MG/L", enteredDueDate: "2026-10-01" }),
    tracked({ id: "far", invoiceNo: "TEST/MG/F", enteredDueDate: "2026-12-30" }),
    tracked({ id: "paid", invoiceNo: "TEST/MG/P", enteredDueDate: "2026-10-14", receipts: [{ seq: 1, receiptDate: "2026-10-02", amountFcy: 1000 }] }),
    tracked({ id: "split", invoiceNo: "TEST/MG/S", paymentTerms: "70% CAD + 30% at 90 Days", docsPresentedDate: "2026-10-15", blDate: "2026-07-20" }),
  ];
  const s = upcomingSchedule(book, TODAY);

  it("lists what falls due from today to 30 days ahead, soonest first — not the overdue, the far off or the paid", () => {
    expect(s.rows.map((r) => r.invoiceId)).toEqual(["today", "split", "split", "in10", "eur"]);
    expect(s.rows[0]).toMatchObject({ inDays: 0, amount: 1000, outstanding: 1000, status: "DUE_SOON" });
  });

  it("shows each portion of a split invoice on its own date, with what falls due then", () => {
    const split = s.rows.filter((r) => r.invoiceId === "split");
    expect(split.map((r) => r.amount).sort((a, b) => a - b)).toEqual([300, 700]);
    expect(split.every((r) => r.outstanding === 1000)).toBe(true);
  });

  it("totals each window per currency and never across", () => {
    const w = (days: number) => s.windows.find((x) => x.days === days)!;
    expect(w(7)).toMatchObject({ invoices: 2, totals: [{ currency: "USD", amount: 2000 }] });
    expect(w(15)).toMatchObject({ invoices: 3, totals: [{ currency: "USD", amount: 2300 }] });
    expect(w(30).totals).toEqual([{ currency: "USD", amount: 2300 }, { currency: "EUR", amount: 250 }]);
  });

  it("takes only 7, 15 and 30 as windows", () => {
    expect([7, "15", 30].every(isScheduleWindow)).toBe(true);
    expect([0, 14, "x", undefined].some(isScheduleWindow)).toBe(false);
  });
});

describe("priority follow-ups", () => {
  const book = [
    tracked({ id: "a1", invoiceNo: "TEST/MG/A1", enteredDueDate: "2026-09-02" }),
    tracked({ id: "a2", invoiceNo: "TEST/MG/A2", enteredDueDate: "2026-07-14", currency: "EUR", customerInvoiceValue: 600 }),
    tracked({ id: "b1", customerId: "c2", customerName: "Test Customer B", invoiceNo: "TEST/MG/B1", enteredDueDate: "2026-10-02", customerInvoiceValue: 5000 }),
    tracked({ id: "c1", customerId: "c3", customerName: "Test Customer C", invoiceNo: "TEST/MG/C1", enteredDueDate: "2026-11-30" }),
    tracked({ id: "none", customerId: null, customerName: null, invoiceNo: "TEST/MG/N", enteredDueDate: "2026-08-01" }),
  ];
  const cleared = tracked({ id: "old", invoiceNo: "TEST/MG/O", enteredDueDate: "2026-06-01", receipts: [{ seq: 1, receiptDate: "2026-09-20", amountFcy: 1000 }] });
  const fu: FollowUp = { status: "PROMISED", nextAction: "Call about the BL copy", nextDate: "2026-10-15", by: "Test Login", at: "2026-10-11T10:00:00.000Z" };
  const rows = priorityFollowUps(book, new Map([["c1", fu]]), [...book, cleared]);

  it("lists customers with money past due, the longest late first — days compare across currencies, amounts do not", () => {
    expect(rows.map((r) => r.customerId)).toEqual(["c1", "c2"]);
    expect(rows[0]!.oldest).toEqual({ id: "a2", invoiceNo: "TEST/MG/A2", days: 90 });
  });

  it("keeps each currency's overdue amount apart", () => {
    expect(rows[0]!.overdue).toEqual([{ currency: "USD", amount: 1000 }, { currency: "EUR", amount: 600 }]);
    expect(rows[0]!.overdueInvoices).toBe(2);
  });

  it("reads the last payment from every invoice, cleared ones too, and states none where there is none", () => {
    expect(rows[0]!.lastPayment).toBe("2026-09-20");
    expect(rows[1]!.lastPayment).toBeNull();
  });

  it("carries the recorded follow-up, and 'not started' for a customer with none", () => {
    expect(rows[0]!.followUp).toEqual(fu);
    expect(rows[1]!.followUp).toEqual(NO_FOLLOW_UP);
    expect(isFollowUpStatus("ESCALATED")).toBe(true);
    expect(isFollowUpStatus("constructor")).toBe(false);
  });
});

describe("data-quality alerts", () => {
  const book = [
    tracked({ id: "bl", invoiceNo: "TEST/MG/BL", paymentTerms: "90 Days From BL Date" }),
    tracked({ id: "terms", invoiceNo: "TEST/MG/TR", paymentTerms: null }),
    tracked({ id: "po", invoiceNo: "TEST/MG/PO", poNo: null, enteredDueDate: "2026-11-01" }),
    tracked({ id: "rcpt", invoiceNo: "TEST/MG/R", enteredDueDate: "2026-11-01", receipts: [{ seq: 1, receiptDate: null, amountFcy: 200 }] }),
    tracked({ id: "inc", invoiceNo: null, invoiceDate: null, enteredDueDate: "2026-11-01" }),
    tracked({ id: "eur", customerId: "c2", customerName: "Test Customer B LLC", currency: "EUR", invoiceNo: "TEST/MG/EU", enteredDueDate: "2026-11-01" }),
    // settled: a gap on it changes no figure
    tracked({ id: "done", invoiceNo: "TEST/MG/D", poNo: null, paymentTerms: null, receipts: [{ seq: 1, receiptDate: "2026-09-01", amountFcy: 1000 }] }),
  ];
  const clients = new Map([[clientKey("Test Customer B"), { name: "Test Customer B", currency: "USD" }]]);
  const alerts = dataQuality(book, clients);
  const of = (key: string) => alerts.find((a) => a.key === key);
  const ids = (key: string) => of(key)?.records.map((r) => r.invoiceId ?? r.customerId);

  it("flags a missing BL date only where the terms count from it", () => {
    expect(ids("bl")).toEqual(["bl"]);
    expect(of("bl")!.missing).toBe("bl");
  });

  it("flags missing terms, PO numbers, receipt dates and incomplete records on the open invoices only", () => {
    expect(ids("terms")).toEqual(["terms"]);
    expect(ids("po")).toEqual(["po"]);
    expect(ids("receiptDate")).toEqual(["rcpt"]);
    expect(ids("incomplete")).toEqual(["inc"]);
    expect(of("incomplete")!.records[0]!.detail).toBe("invoice number, invoice date missing");
  });

  it("compares with the ERP client list by name: a different currency, and a customer it does not know", () => {
    expect(ids("currencyMismatch")).toEqual(["eur"]);
    expect(of("currencyMismatch")!.records[0]!.detail).toBe("EUR here, USD in the client list");
    expect(ids("notInClients")).toEqual(["c1"]);
  });

  it("says nothing about the client list when there is none to compare with, and leaves out empty alerts", () => {
    const bare = dataQuality(book, new Map());
    expect(bare.some((a) => a.key === "currencyMismatch" || a.key === "notInClients")).toBe(false);
    expect(dataQuality([tracked({ id: "ok", enteredDueDate: "2026-11-01" })], new Map())).toEqual([]);
  });

  it("shows the first few records and counts them all", () => {
    const many = Array.from({ length: 8 }, (_, n) => tracked({ id: `p${n}`, invoiceNo: `TEST/MG/P${n}`, poNo: null, enteredDueDate: "2026-11-01" }));
    const po = dataQuality(many, new Map(), 5).find((a) => a.key === "po")!;
    expect(po.count).toBe(8);
    expect(po.records).toHaveLength(5);
  });
});

describe("customer payment performance", () => {
  const rows = customerPerformance([
    tracked({ id: "p1", invoiceDate: "2026-05-01", receipts: [{ seq: 1, receiptDate: "2026-06-30", amountFcy: 1000 }] }),
    tracked({ id: "p2", invoiceDate: "2026-06-01", receipts: [{ seq: 1, receiptDate: "2026-06-21", amountFcy: 1000 }] }),
    tracked({ id: "p3", customerInvoiceValue: 2000, receipts: [{ seq: 1, receiptDate: "2026-09-01", amountFcy: 500 }] }),
    tracked({ id: "e1", currency: "EUR", customerInvoiceValue: 300 }),
  ]);

  it("gives a customer one row per currency", () => {
    expect(rows.map((r) => `${r.customerId} ${r.currency}`)).toEqual(["c1 EUR", "c1 USD"]);
  });

  it("works out invoiced, received, outstanding and the share collected", () => {
    expect(rows[1]).toMatchObject({ invoices: 3, invoiced: 4000, received: 2500, outstanding: 1500, collectedPct: 62.5 });
    expect(rows[0]).toMatchObject({ invoiced: 300, received: 0, collectedPct: 0, avgDays: null, settled: 0 });
  });

  it("averages the days to collect over the settled invoices alone", () => {
    expect(rows[1]).toMatchObject({ settled: 2, avgDays: 40 });
  });
});
