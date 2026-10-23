/**
 * The customer-wise summary's Payment Status: one reading of a customer's
 * figures, where the first rule that applies wins.
 */
import { describe, expect, it } from "vitest";

import { customerStanding } from "@/lib/payments/standing";
import { summarise } from "@/server/payments/query";
import { tracked } from "./helpers";

const base = { invoices: 3, received: 100, outstanding: 500, overdue: 0, openWithoutDueDate: 0 };

describe("payment status", () => {
  it("follows the order of the rules", () => {
    expect(customerStanding({ ...base, invoices: 0 })).toBe("ON_ACCOUNT_ONLY");
    expect(customerStanding({ ...base, outstanding: -20 })).toBe("OVERPAID");
    expect(customerStanding({ ...base, outstanding: 0.005 })).toBe("PAID");
    // overdue wins over a missing due date elsewhere
    expect(customerStanding({ ...base, overdue: 50, openWithoutDueDate: 2 })).toBe("OVERDUE");
    expect(customerStanding({ ...base, openWithoutDueDate: 1 })).toBe("DUE_DATE_UNKNOWN");
    expect(customerStanding({ ...base, received: 0 })).toBe("UNPAID");
    expect(customerStanding(base)).toBe("PARTLY_PAID");
  });

  it("is worked out for every summary row, with the counts it rests on", () => {
    const [row] = summarise([
      // overdue: 120 days from a BL date long past
      tracked({ id: "a", paymentTerms: "120 Days From BL Date", blDate: "2026-01-10" }),
      // open, no due date
      tracked({ id: "b" }),
      // paid
      tracked({ id: "c", customerInvoiceValue: 200, receipts: [{ seq: 1, amountFcy: 200 }] }),
    ]);
    expect(row).toMatchObject({
      invoices: 3,
      openInvoices: 2,
      overdueInvoices: 1,
      openWithoutDueDate: 1,
      paymentStatus: "OVERDUE",
    });
  });
});
