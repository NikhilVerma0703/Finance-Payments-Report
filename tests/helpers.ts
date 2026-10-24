import { buildTrackedInvoice, TRACKING_DEFAULTS, type TrackedInvoice, type TrackedInvoiceInput, type TrackingParams } from "@/lib/payments/record";
import type { TermRule } from "@/lib/payments/terms";

export const TODAY = "2026-10-12";

/**
 * The thresholds with the default credit period switched off. Most suites test
 * one mechanism at a time — a filter, a bucket, a strip — with invoices that
 * carry no due date on purpose; with the default on, every such invoice would
 * fall due 150 days after its invoice date and the suites would be testing the
 * default instead. It has its own suite: default-due.test.ts.
 */
export const NO_DEFAULT: TrackingParams = { ...TRACKING_DEFAULTS, defaultDueDays: 0 };

/** An invoice with every field blank except what a test sets. */
export function input(over: Partial<TrackedInvoiceInput> = {}): TrackedInvoiceInput {
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

export function tracked(
  over: Partial<TrackedInvoiceInput> = {},
  rules: TermRule[] = [],
  params: TrackingParams = NO_DEFAULT,
): TrackedInvoice {
  return buildTrackedInvoice(input(over), { today: TODAY, rules, params });
}
