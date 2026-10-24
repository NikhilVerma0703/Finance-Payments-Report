/** Search Invoices and Reports: every filter alone, and together. */
import { describe, expect, it } from "vitest";

import {
  DATE_FIELDS,
  describeFilters,
  filterInvoices,
  filtersFrom,
  toQuery,
} from "@/server/payments/query";
import { tracked } from "./helpers";

const rows = [
  // due 2026-09-02, overdue since 2026-09-03
  tracked({ id: "a", invoiceNo: "PS/101", customerName: "Alpha", invoiceDate: "2026-05-05", enteredDueDate: "2026-09-02", poNo: "PO-1" }),
  // due 2026-11-30 — not overdue, so no overdue date
  tracked({ id: "b", invoiceNo: "PS/102", customerName: "Beta", invoiceDate: "2026-08-01", enteredDueDate: "2026-11-30", poNo: "PO-2" }),
  // paid: has a due date but owes nothing, so no overdue date either
  tracked({ id: "c", invoiceNo: "PS/103", customerName: "Alpha", invoiceDate: "2026-01-10", enteredDueDate: "2026-03-10",
    receipts: [{ seq: 1, amountFcy: 1000 }] }),
  // no due date
  tracked({ id: "d", invoiceNo: "XX/9", customerName: "Gamma", invoiceDate: "2025-12-20" }),
];
const ids = (f: Record<string, string>) => filterInvoices(rows, f).map((i) => i.id).sort();

describe("Date Range On", () => {
  it("offers exactly Invoice Date, Due Date, Overdue Date and Receipt Date", () => {
    // Receipt Date (24 Oct 2026) is what a week of the dashboard's received
    // timeline opens: the invoices with a receipt dated in it
    expect(Object.values(DATE_FIELDS)).toEqual(["Invoice Date", "Due Date", "Overdue Date", "Receipt Date"]);
  });

  it("filters by invoice date", () => {
    expect(ids({ dateField: "invoice", from: "2026-05-01", to: "2026-08-31" })).toEqual(["a", "b"]);
  });

  it("filters by due date", () => {
    expect(ids({ dateField: "due", from: "2026-09-01", to: "2026-12-31" })).toEqual(["a", "b"]);
    expect(ids({ dateField: "due", from: "2026-01-01", to: "2026-03-31" })).toEqual(["c"]);
  });

  it("filters by overdue date: the day after the due date, only while money is owed", () => {
    expect(rows[0].overdueSince).toBe("2026-09-03");
    expect(rows[1].overdueSince).toBeNull();
    expect(rows[2].overdueSince).toBeNull();
    expect(ids({ dateField: "overdue", from: "2026-09-03", to: "2026-09-03" })).toEqual(["a"]);
    expect(ids({ dateField: "overdue", from: "2026-09-02", to: "2026-09-02" })).toEqual([]);
    expect(ids({ dateField: "overdue", from: "2026-01-01" })).toEqual(["a"]);
  });

  it("an open-ended range works from either side", () => {
    expect(ids({ dateField: "invoice", to: "2026-01-31" })).toEqual(["c", "d"]);
  });
});

describe("filters alone and combined", () => {
  it("with none, every record", () => {
    expect(ids({})).toEqual(["a", "b", "c", "d"]);
  });

  it("search finds invoice number or customer name", () => {
    expect(ids({ q: "ps/10" })).toEqual(["a", "b", "c"]);
    expect(ids({ q: "gamma" })).toEqual(["d"]);
  });

  it("invoice number on its own", () => {
    expect(ids({ inv: "102" })).toEqual(["b"]);
  });

  it("customer, PO, ageing and status", () => {
    expect(ids({ customer: "Alpha" })).toEqual(["a", "c"]);
    expect(ids({ po: "PO-2" })).toEqual(["b"]);
    expect(ids({ ageing: "31–60 days" })).toEqual(["a"]);
    expect(ids({ ageing: "No due date" })).toEqual(["d"]);
    expect(ids({ status: "PAID" })).toEqual(["c"]);
  });

  it("combined", () => {
    expect(ids({ customer: "Alpha", open: "1" })).toEqual(["a"]);
    expect(ids({ customer: "Alpha", dateField: "due", from: "2026-09-01" })).toEqual(["a"]);
    expect(ids({ verify: "1", nilReceived: "1" })).toEqual(["d"]);
  });
});

describe("filters from a URL", () => {
  it("keeps known keys and drops blanks", () => {
    expect(filtersFrom(new URLSearchParams("customer=Alpha&po=&bogus=1"))).toEqual({ customer: "Alpha" });
  });

  it("ignores 'date range on' without a date — the form always sends it", () => {
    expect(filtersFrom({ dateField: "due" })).toEqual({});
    expect(filtersFrom({ dateField: "due", from: "2026-01-01" })).toEqual({ dateField: "due", from: "2026-01-01" });
  });

  it("round-trips through a query string", () => {
    const f = { customer: "Alpha Beta", ageing: "1–30 days" };
    expect(filtersFrom(new URLSearchParams(toQuery(f)))).toEqual(f);
  });

  it("is described in words", () => {
    expect(describeFilters({ customer: "Alpha", dateField: "overdue", from: "2026-01-01", open: "1", sort: "x" })).toEqual([
      "Customer: Alpha",
      "Date range on: Overdue Date",
      "From: 2026-01-01",
      "Outstanding only",
    ]);
  });
});
