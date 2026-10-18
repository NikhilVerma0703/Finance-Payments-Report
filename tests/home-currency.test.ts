import { describe, expect, it } from "vitest";
import { kpisFrom } from "@/server/payments/query";
import { buildTrackedInvoice, type TrackedInvoiceInput } from "@/lib/payments/record";

function inv(over: Partial<TrackedInvoiceInput>): TrackedInvoiceInput {
  return {
    id: "x", customerId: "c", customerName: "C",
    invoiceNo: "I", invoiceDate: "2026-05-01",
    customerInvoiceValue: 1000, customsInvoiceValue: null,
    exchangeRate: null, currency: "USD",
    consignee: null, notifyParty: null, country: null,
    paymentTerms: null, enteredDueDate: null,
    piNo: null, poNo: null, shippingBillNo: null, shippingBillDate: null,
    blNo: null, blDate: null, containerNo: null, eta: null, docsPresentedDate: null,
    booksBalance: null, remarks: null, followUpNotes: null,
    source: "MANUAL", sourceFile: null, sourceAsOn: null,
    receipts: [], notes: [],
    ...over,
  };
}

describe("the home-currency totals", () => {
  it("converts each invoice at its own rate and counts how many had one", () => {
    const rows = [
      buildTrackedInvoice(inv({ id: "a", exchangeRate: 83, customerInvoiceValue: 1000,
        receipts: [{ seq: 1, amountFcy: 400, exchangeRate: 84 }] }), { today: "2026-10-12" }),
      buildTrackedInvoice(inv({ id: "b", exchangeRate: 80, customerInvoiceValue: 500 }), { today: "2026-10-12" }),
      buildTrackedInvoice(inv({ id: "c", exchangeRate: null, customerInvoiceValue: 2000 }), { today: "2026-10-12" }),
    ];
    const [usd] = kpisFrom(rows);
    expect(usd.homeRatesKnown).toBe(2);
    // 1000×83 + 500×80 = 83,000 + 40,000
    expect(usd.homeInvoiceValue).toBeCloseTo(123000, 2);
    // only the first has a receipt: 400×83
    expect(usd.homeReceived).toBeCloseTo(33200, 2);
    // outstanding 600×83 + 500×80 = 49,800 + 40,000
    expect(usd.homeOutstanding).toBeCloseTo(89800, 2);
    // the rate-less invoice is excluded, not counted as zero rupees
    expect(usd.totalInvoiceValue).toBeCloseTo(3500, 2);
  });

  it("reports no home figures at all when no invoice carries a rate", () => {
    const [usd] = kpisFrom([buildTrackedInvoice(inv({}), { today: "2026-10-12" })]);
    expect(usd.homeRatesKnown).toBe(0);
    expect(usd.homeInvoiceValue).toBe(0);
  });
});
