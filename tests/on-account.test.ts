/**
 * Money held on account: what is left to attribute is worked out, never
 * stored, and it moves the customer's net balance the way the same money would
 * on an invoice.
 */
import { describe, expect, it } from "vitest";

import {
  attributionAmount,
  buildOnAccount,
  currenciesFit,
  onAccountTotals,
  type OnAccountInput,
} from "@/lib/payments/onAccount";
import { summarise } from "@/server/payments/query";
import { tracked } from "./helpers";

function entry(over: Partial<OnAccountInput> = {}): OnAccountInput {
  return {
    id: "e1", customerId: "c", customerName: "C", kind: "RECEIPT",
    entryDate: "2026-10-01", amount: 5000, currency: "USD", exchangeRate: null,
    reference: "SWIFT 1", remarks: null, attributions: [],
    ...over,
  };
}

describe("an entry on account", () => {
  it("is all on account until something is attributed", () => {
    const e = buildOnAccount(entry());
    expect(e.attributed).toBe(0);
    expect(e.unattributed).toBe(5000);
    expect(e.credit).toBe(5000);
  });

  it("loses what is attributed, invoice by invoice", () => {
    const e = buildOnAccount(
      entry({
        attributions: [
          { id: "r1", invoiceId: "i1", invoiceNo: "A", amount: 1200.5 },
          { id: "r2", invoiceId: "i2", invoiceNo: "B", amount: 799.5 },
        ],
      }),
    );
    expect(e.attributed).toBe(2000);
    expect(e.unattributed).toBe(3000);
    expect(e.excess).toBe(0);
  });

  it("reports over-attribution rather than a negative balance", () => {
    const e = buildOnAccount(
      entry({ amount: 100, attributions: [{ id: "r", invoiceId: "i", invoiceNo: null, amount: 150 }] }),
    );
    expect(e.unattributed).toBe(0);
    expect(e.excess).toBe(50);
  });

  it("counts a debit note against the customer", () => {
    const debit = buildOnAccount(entry({ kind: "DEBIT", amount: 300 }));
    expect(debit.credit).toBe(-300);
    const t = onAccountTotals([
      buildOnAccount(entry({ amount: 1000 })),
      buildOnAccount(entry({ kind: "CREDIT", amount: 200 })),
      debit,
    ]);
    expect(t).toMatchObject({ entries: 3, receipts: 1000, credits: 200, debits: 300, net: 900 });
  });
});

describe("how much one attribution takes", () => {
  it("left blank, as much of a payment as the invoice still owes", () => {
    expect(
      attributionAmount({ kind: "RECEIPT", unattributed: 5000, invoiceOutstanding: 1800, typed: null }),
    ).toEqual({ amount: 1800, capped: false });
    expect(
      attributionAmount({ kind: "RECEIPT", unattributed: 500, invoiceOutstanding: 1800, typed: null }),
    ).toEqual({ amount: 500, capped: false });
  });

  it("never more than is left, and says when it cut a typed amount down", () => {
    expect(
      attributionAmount({ kind: "RECEIPT", unattributed: 500, invoiceOutstanding: 1800, typed: 900 }),
    ).toEqual({ amount: 500, capped: true });
    expect(attributionAmount({ kind: "CREDIT", unattributed: 500, invoiceOutstanding: 1800, typed: 0 }).amount).toBe(0);
  });

  it("a debit note goes on whole, whatever the invoice owes", () => {
    expect(attributionAmount({ kind: "DEBIT", unattributed: 250, invoiceOutstanding: 0, typed: null }).amount).toBe(250);
  });

  it("only within one currency, unless a side has none", () => {
    expect(currenciesFit("USD", "usd")).toBe(true);
    expect(currenciesFit("USD", "EUR")).toBe(false);
    expect(currenciesFit(null, "EUR")).toBe(true);
  });
});

describe("the customer-wise summary", () => {
  it("nets what is on account off the outstanding balance", () => {
    const [row] = summarise([tracked({ customerInvoiceValue: 10000 })], [buildOnAccount(entry({ amount: 4000 }))]);
    expect(row.outstanding).toBe(10000);
    expect(row.onAccount).toBe(4000);
    expect(row.netOutstanding).toBe(6000);
  });

  it("gives money on account a row even with no invoice in that currency", () => {
    const rows = summarise([tracked({ currency: "USD" })], [buildOnAccount(entry({ currency: "EUR", amount: 70 }))]);
    expect(rows.map((r) => `${r.currency}:${r.onAccount}`).sort()).toEqual(["EUR:70", "USD:0"]);
  });

  it("offers the customer's default currency only for a row that inherits it", () => {
    const own = summarise([tracked({ currencySource: "invoice" })]);
    const inherited = summarise([
      tracked({ currencySource: "invoice" }),
      tracked({ id: "y", currencySource: "erp" }),
    ]);
    expect(own[0].currencySource).toBe("invoice");
    expect(inherited[0].currencySource).toBe("erp");
  });
});
