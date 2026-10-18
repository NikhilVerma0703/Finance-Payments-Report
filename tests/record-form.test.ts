/** Reading the full record form — what it accepts, and what it refuses. */
import { describe, expect, it } from "vitest";

import { parseRecordForm } from "@/lib/payments/recordForm";

function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("the record form", () => {
  it("reads only the fields it carried, and a blank clears", () => {
    const p = parseRecordForm(form({ invoiceNo: "PS/1", blDate: "", customerInvoiceValue: "1,23,456.50" }));
    expect(p.invoice).toEqual({ invoiceNo: "PS/1", blDate: null, customerInvoiceValue: 123456.5 });
    expect(p.errors).toEqual([]);
  });

  it("reads day-first dates and returns them as YYYY-MM-DD", () => {
    expect(parseRecordForm(form({ invoiceDate: "05-06-2026" })).invoice.invoiceDate).toBe("2026-06-05");
  });

  it("refuses what cannot be read rather than saving a blank", () => {
    const p = parseRecordForm(form({ customerInvoiceValue: "12,3a", "r.new1.receiptDate": "31/02/2026" }));
    expect(p.errors).toHaveLength(2);
    expect(p.errors[0]).toMatch(/Invoice value.*12,3a/);
    expect(p.errors[1]).toMatch(/Receipt 1, receipt date/);
  });

  it("tells new lines from stored ones, and reads deletions", () => {
    const p = parseRecordForm(
      form({
        "r.ckabc123.amountFcy": "100",
        "r.ckabc123.delete": "1",
        "r.new1.amountFcy": "",
        "r.new2.amountFcy": "50",
        "n.new3.noteType": "DEBIT",
        "n.new3.amount": "20",
        "n.new4.noteType": "anything",
      }),
    );
    expect(p.receipts.map((r) => [r.key, r.id, r.remove, r.hasContent])).toEqual([
      ["ckabc123", "ckabc123", true, true],
      ["new1", null, false, false],
      ["new2", null, false, true],
    ]);
    expect(p.notes.map((n) => [n.values.noteType, n.hasContent])).toEqual([
      ["DEBIT", true],
      ["CREDIT", false],
    ]);
  });

  it("reads the customer choice and the customer's own fields", () => {
    const p = parseRecordForm(form({ customerId: "", customerName: "New Co", "customer.currency": "usd" }));
    expect(p.customer).toMatchObject({ offered: true, pickedId: null, typedName: "New Co" });
    expect(p.customer.fields).toEqual({ currency: "USD" });
  });

  it("requires nothing", () => {
    const p = parseRecordForm(form({}));
    expect(p.errors).toEqual([]);
    expect(p.invoice).toEqual({});
  });
});
