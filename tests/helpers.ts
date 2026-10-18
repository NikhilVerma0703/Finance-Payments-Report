import { buildTrackedInvoice, type TrackedInvoice, type TrackedInvoiceInput } from "@/lib/payments/record";
import type { TermRule } from "@/lib/payments/terms";

export const TODAY = "2026-10-12";

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

export function tracked(over: Partial<TrackedInvoiceInput> = {}, rules: TermRule[] = []): TrackedInvoice {
  return buildTrackedInvoice(input(over), { today: TODAY, rules });
}
