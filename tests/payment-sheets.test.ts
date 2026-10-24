/**
 * Reading the four real customer sheets, and the money arithmetic over them.
 *
 * These are the actual files Finance supplied, kept as fixtures, because the
 * value of the reader is that it copes with *their* four layouts rather than an
 * idealised one. Every figure asserted here was verified against the workbooks
 * independently.
 *
 * The cases that matter most are the ones a careless reader gets wrong:
 * merged total rows that look like invoices, a printed total that is wrong, a
 * date that cannot be reproduced, a label written in the PO column, and a
 * working cell left outside the table.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  invoiceMoney,
  receiptMaths,
  settledAmount,
  totalNotes,
  totalReceipts,
  ageingBucket,
  ageingLabels,
} from "@/lib/payments/money";
import { parseRemittance, readPaymentSheet, type SheetRead } from "@/lib/payments/sheetReader";
import { buildTrackedInvoice, TRACKING_DEFAULTS, type TrackedInvoiceInput } from "@/lib/payments/record";

const FIXTURES = path.join(process.cwd(), "tests", "fixtures");

async function read(file: string): Promise<SheetRead> {
  const buffer = readFileSync(path.join(FIXTURES, file));
  const sheets = await readPaymentSheet(buffer, file);
  return sheets[0];
}

const FAIR_DEAL = "statement_fair_deal.xlsx";
const KAMINEA = "statement_kaminea.xlsx";
const BLUE_PLANET = "statement_blue_planet.xlsx";
const TERRY = "statement_terry_stone.xlsx";

// --------------------------------------------------------------------------
describe("all four layouts are read", () => {
  it.each([
    [FAIR_DEAL, "Fair Deal Marble", 5, 9, 348688.54, 59651.63, 289036.91],
    [KAMINEA, "Partner Kamienia", 6, 4, 127137.02, 0, 127137.02],
    [BLUE_PLANET, "Blue Planet Inc", 5, 5, 195741.04, 73964.1, 121776.94],
    // Terry Stone's own block is the second table in the sheet, at row 31
    [TERRY, "Terry Stone", 31, 23, 659461.36, 447976.52, 211484.84],
  ])(
    "%s → %s, header row %i, %i invoices",
    async (file, customer, headerRow, rows, value, received, balance) => {
      const r = await read(file);
      expect(r.customerName).toBe(customer);
      const block = r.blocks.find((b) => b.kind === "OURS") ?? r.blocks[0];
      expect(block.headerRow).toBe(headerRow);
      expect(block.rows).toHaveLength(rows);
      expect(block.totals.value).toBeCloseTo(value, 2);
      expect(block.totals.received).toBeCloseTo(received, 2);
      expect(block.totals.balance).toBeCloseTo(balance, 2);
    },
  );

  it("maps each field to the column it was found in", async () => {
    const fd = (await read(FAIR_DEAL)).blocks[0];
    expect(fd.mapping).toMatchObject({
      invoiceNo: "D",
      invoiceDate: "C",
      customerInvoiceValue: "E",
      received: "F",
      statedBalance: "G",
      paymentTerms: "H",
      containerNo: "I",
      statedDueDate: "J",
    });

    // the same fields, different columns, in a sheet laid out differently
    const terry = (await read(TERRY)).blocks[1];
    expect(terry.mapping).toMatchObject({
      invoiceNo: "F",
      invoiceDate: "D",
      poNo: "E",
      received: "H",
      receiptDate: "I",
      statedBalance: "J",
    });
  });

  it("finds the customer name in a cell, or in the tab when there is no cell", async () => {
    expect((await read(FAIR_DEAL)).customerSource).toBe("the 'Customer Name' cell");
    expect((await read(TERRY)).customerSource).toBe("the worksheet tab name");
  });

  it("establishes the currency from the number format, and says where from", async () => {
    for (const file of [FAIR_DEAL, KAMINEA, BLUE_PLANET, TERRY]) {
      const r = await read(file);
      expect(r.currency, file).toBe("USD");
      expect(r.currencySource, file).toMatch(/number format/);
    }
  });
});

// --------------------------------------------------------------------------
describe("merged cells never turn a total row into an invoice", () => {
  it("reads 9 rows from Fair Deal, not 10", async () => {
    // B15:D15 is merged and holds "Total"; column D is the invoice number, so a
    // merge-blind read sees an invoice called "Total" worth the column total
    const block = (await read(FAIR_DEAL)).blocks[0];
    expect(block.rows).toHaveLength(9);
    expect(block.rows.map((r) => r.invoiceNo)).not.toContain("Total");
    expect(block.totals.value).toBeCloseTo(348688.54, 2);
    expect(block.totals.value).not.toBeCloseTo(697377.08, 2); // the doubled figure
  });

  it("captures the printed total separately instead", async () => {
    const block = (await read(FAIR_DEAL)).blocks[0];
    expect(block.statedTotals?.value).toBeCloseTo(348688.54, 2);
  });

  it("does not read a merged block caption as an invoice", async () => {
    // C30:K30 holds "As per PESPL records 03-10-2026" across nine columns
    const r = await read(TERRY);
    for (const b of r.blocks) {
      expect(b.rows).toHaveLength(23);
      expect(b.rows.every((x) => (x.invoiceNo ?? "").startsWith("PESPL/"))).toBe(true);
    }
  });

  it("reads the value beside a merged label, not the label again", async () => {
    expect((await read(FAIR_DEAL)).customerName).toBe("Fair Deal Marble");
    expect((await read(KAMINEA)).customerName).toBe("Partner Kamienia");
    expect((await read(KAMINEA)).headerPaymentTerms).toBe("100% Cash Against Document (CAD)");
  });
});

// --------------------------------------------------------------------------
describe("a printed total is never believed", () => {
  it("recomputes a total that sums 21 rows of a 23-row table", async () => {
    const ours = (await read(TERRY)).blocks.find((b) => b.kind === "OURS")!;
    expect(ours.statedTotals?.value).toBeCloseTo(587839.18, 2);
    expect(ours.totals.value).toBeCloseTo(659461.36, 2);
  });

  it("reports the discrepancy rather than silently correcting it", async () => {
    const r = await read(TERRY);
    const issue = r.warnings.find((w) => w.includes("71622.18"));
    expect(issue).toBeDefined();
    expect(issue).toMatch(/587839\.18/);
    expect(issue).toMatch(/659461\.36/);
    expect(issue).toMatch(/rows were used/);
  });

  it("shows the two blocks agree once the rows are added up", async () => {
    const [theirs, ours] = (await read(TERRY)).blocks;
    expect(theirs.totals.value).toBeCloseTo(ours.totals.value, 2);
    expect(theirs.totals.received).toBeCloseTo(ours.totals.received, 2);
  });

  it("reports the cell that presents the shortfall as a real difference", async () => {
    const stray = (await read(TERRY)).strayCells.find((s) => s.ref === "G58");
    expect(stray?.formula).toBe("=G27-G55");
  });
});

// --------------------------------------------------------------------------
describe("balance = value − received, in every row of every sheet", () => {
  it.each([FAIR_DEAL, KAMINEA, BLUE_PLANET, TERRY])("%s", async (file) => {
    const r = await read(file);
    for (const block of r.blocks) {
      for (const row of block.rows) {
        expect(row.balanceAgrees, `${row.invoiceNo} (row ${row.sourceRow})`).toBe(true);
      }
    }
  });
});

// --------------------------------------------------------------------------
describe("the as-on date, and how far it can be trusted", () => {
  it("recognises =TODAY() as meaning the sheet had no fixed date", async () => {
    for (const file of [FAIR_DEAL, KAMINEA, BLUE_PLANET]) {
      const r = await read(file);
      expect(r.asOnSource, file).toBe("TODAY() formula");
      expect(r.warnings.some((w) => w.includes("every time")), file).toBe(true);
    }
  });

  it("takes the date from a tab name when that is the only place it is", async () => {
    const r = await read(TERRY);
    expect(r.asOn).toBe("2026-10-03");
    expect(r.asOnSource).toBe("tab name");
  });
});

// --------------------------------------------------------------------------
describe("payment terms, at whichever level they were written", () => {
  it("takes a customer-level term from a header cell when there is no column", async () => {
    const rows = (await read(KAMINEA)).blocks[0].rows;
    expect(rows.every((r) => r.paymentTermsLevel === "customer")).toBe(true);
    expect(rows[0].paymentTerms).toBe("100% Cash Against Document (CAD)");
  });

  it("takes a per-invoice term from a column when there is one", async () => {
    const rows = (await read(FAIR_DEAL)).blocks[0].rows;
    expect(rows.every((r) => r.paymentTermsLevel === "invoice")).toBe(true);
  });

  it("reports no term at all rather than inventing one", async () => {
    const rows = (await read(TERRY)).blocks[0].rows;
    expect(rows.every((r) => r.paymentTermsLevel === "none")).toBe(true);
  });
});

// --------------------------------------------------------------------------
describe("things written in the wrong column", () => {
  it("treats 'Diverted Containers' as a remark, not a PO number", async () => {
    const ours = (await read(TERRY)).blocks.find((b) => b.kind === "OURS")!;
    const row = ours.rows.find((x) => x.invoiceNo === "PESPL/2131")!;
    expect(row.poNo).toBeNull();
    expect(row.remarks).toMatch(/Diverted Containers/);
    expect(row.notes.join(" ")).toMatch(/kept as a remark/);
  });

  it("keeps the real PO numbers", async () => {
    const ours = (await read(TERRY)).blocks.find((b) => b.kind === "OURS")!;
    expect(ours.rows.find((x) => x.invoiceNo === "PESPL/1918")!.poNo).toBe("B5003");
    expect(ours.rows.find((x) => x.invoiceNo === "PESPL/2096")!.poNo).toBe("B6001");
  });

  it("reports a working cell outside the table instead of importing it", async () => {
    const r = await read(FAIR_DEAL);
    const stray = r.strayCells.find((s) => s.ref === "M10");
    expect(stray?.value).toBe("114404.35");
    expect(stray?.formula).toBe("=SUM(G6:G10)");
    expect(r.warnings.some((w) => w.includes("M10"))).toBe(true);
  });
});

// --------------------------------------------------------------------------
describe("lump-sum receipts", () => {
  it("captures the remittance an allocation came out of", async () => {
    const ours = (await read(TERRY)).blocks.find((b) => b.kind === "OURS")!;
    const row = ours.rows.find((x) => x.invoiceNo === "PESPL/1918")!;
    expect(parseRemittance(row.remarks).total).toBeCloseTo(79054.68, 2);
  });

  it("shows every receipt in that sheet is the same flat amount", async () => {
    const ours = (await read(TERRY)).blocks.find((b) => b.kind === "OURS")!;
    const paid = ours.rows.filter((r) => (r.received ?? 0) > 0).map((r) => r.received);
    expect(new Set(paid)).toEqual(new Set([26351.56]));
    expect(paid).toHaveLength(17);
  });

  it("has nothing to say about a row with no remark", () => {
    expect(parseRemittance(null)).toEqual({ ref: null, total: null });
    expect(parseRemittance("Goods diverted")).toEqual({ ref: null, total: null });
  });
});

// --------------------------------------------------------------------------
describe("the exchange-rate convention", () => {
  it("difference = receipt rate − invoice rate; gain = difference × amount", () => {
    const m = receiptMaths({ seq: 1, amountFcy: 10000, exchangeRate: 84.5 }, 83.25);
    expect(m.rateDifference).toBeCloseTo(1.25, 4);
    expect(m.forexGainLoss).toBeCloseTo(12500, 2);
    expect(m.homeValue).toBeCloseTo(845000, 2);
  });

  it("reports a loss as a negative figure", () => {
    const m = receiptMaths({ seq: 1, amountFcy: 10000, exchangeRate: 82 }, 83.25);
    expect(m.forexGainLoss).toBeCloseTo(-12500, 2);
  });

  it("gives no forex figure, rather than zero, when a rate is missing", () => {
    const noReceiptRate = receiptMaths({ seq: 1, amountFcy: 10000 }, 83.25);
    expect(noReceiptRate.forexGainLoss).toBeNull();
    expect(noReceiptRate.note).toMatch(/no exchange rate/);

    const noInvoiceRate = receiptMaths({ seq: 1, amountFcy: 10000, exchangeRate: 84 }, null);
    expect(noInvoiceRate.forexGainLoss).toBeNull();
    expect(noInvoiceRate.note).toMatch(/invoice has no exchange rate/);
  });
});

// --------------------------------------------------------------------------
describe("outstanding, and not counting anything twice", () => {
  const receipts = [
    { seq: 1, amountFcy: 10000, exchangeRate: 84 },
    { seq: 2, amountFcy: 5000, exchangeRate: 83 },
  ];
  const notes = [
    { noteType: "CREDIT" as const, amount: 500 },
    { noteType: "DEBIT" as const, amount: 200 },
  ];

  it("is value − receipts − CN + DN", () => {
    const m = invoiceMoney({
      invoiceValue: 100000,
      invoiceRate: 83.25,
      receipts,
      notes,
      booksBalance: null,
    });
    expect(totalReceipts(receipts)).toBe(15000);
    expect(totalNotes(notes, "CREDIT")).toBe(500);
    expect(totalNotes(notes, "DEBIT")).toBe(200);
    expect(settledAmount(receipts, notes)).toBe(15300);
    expect(m.calculatedOutstanding).toBeCloseTo(84700, 2);
  });

  it("keeps the books balance out of the sum and reports the difference", () => {
    const m = invoiceMoney({
      invoiceValue: 100000,
      invoiceRate: 83.25,
      receipts,
      notes,
      booksBalance: 84000,
    });
    expect(m.calculatedOutstanding).toBeCloseTo(84700, 2);
    expect(m.booksDifference).toBeCloseTo(700, 2);
  });

  it("totals the per-receipt forex rather than using a blended rate", () => {
    const m = invoiceMoney({ invoiceValue: 100000, invoiceRate: 83.25, receipts, notes });
    // (84 − 83.25) × 10000 + (83 − 83.25) × 5000
    expect(m.totalForexGainLoss).toBeCloseTo(7500 - 1250, 2);
  });

  it("names the state of the balance", () => {
    const unpaid = invoiceMoney({ invoiceValue: 1000, invoiceRate: null, receipts: [], notes: [] });
    expect(unpaid.paymentState).toBe("UNPAID");

    const paid = invoiceMoney({
      invoiceValue: 1000,
      invoiceRate: null,
      receipts: [{ seq: 1, amountFcy: 1000 }],
      notes: [],
    });
    expect(paid.paymentState).toBe("PAID");

    // the real pattern: 26,351.56 paid against 26,756.97 leaves 405.41, 1.5%
    const nearly = invoiceMoney({
      invoiceValue: 26756.97,
      invoiceRate: null,
      receipts: [{ seq: 1, amountFcy: 26351.56 }],
      notes: [],
    });
    expect(nearly.calculatedOutstanding).toBeCloseTo(405.41, 2);
    expect(nearly.paymentState).toBe("NEARLY_SETTLED");

    const over = invoiceMoney({
      invoiceValue: 1000,
      invoiceRate: null,
      receipts: [{ seq: 1, amountFcy: 1200 }],
      notes: [],
    });
    expect(over.paymentState).toBe("OVERPAID");
  });
});

// --------------------------------------------------------------------------
describe("ageing", () => {
  it("buckets days past due", () => {
    expect(ageingBucket(20)).toBe("1–30 days");
    expect(ageingBucket(45)).toBe("31–60 days");
    expect(ageingBucket(423)).toBe("Over 90 days");
  });

  it("says 'Not yet due' rather than printing a negative number of days", () => {
    expect(ageingBucket(-81)).toBe("Not yet due");
  });

  it("says so when there is no due date to measure from", () => {
    expect(ageingBucket(null)).toBe("No due date");
  });

  it("follows configured boundaries and repairs nonsense ones", () => {
    expect(ageingBucket(20, [15, 45])).toBe("16–45 days");
    expect(ageingLabels([15, 45])).toEqual(["Not yet due", "1–15 days", "16–45 days", "Over 45 days"]);
    expect(ageingBucket(20, [])).toBe("1–30 days");
  });
});

// --------------------------------------------------------------------------
describe("a whole tracked invoice", () => {
  const base: TrackedInvoiceInput = {
    id: "i1",
    customerId: "c1",
    customerName: "Fair Deal Marble",
    invoiceNo: "PESPL/0845",
    invoiceDate: "2024-12-09",
    customerInvoiceValue: 55367.12,
    customsInvoiceValue: null,
    exchangeRate: 83.25,
    currency: "USD",
    consignee: null,
    notifyParty: null,
    country: null,
    paymentTerms: "120 Days From the Date of BL",
    enteredDueDate: null,
    piNo: null,
    poNo: null,
    shippingBillNo: null,
    shippingBillDate: null,
    blNo: null,
    blDate: "2024-12-17",
    containerNo: "GAOU 207638-8",
    eta: null,
    docsPresentedDate: null,
    booksBalance: null,
    remarks: null,
    followUpNotes: null,
    source: "EXCEL",
    sourceFile: "Fair Deal Marbles.xlsx",
    sourceAsOn: "2026-06-13",
    receipts: [{ seq: 1, amountFcy: 16469.4, exchangeRate: 84.1, receiptDate: "2025-06-01" }],
    notes: [],
  };

  const today = "2026-10-09";

  it("works out the due date from the BL date", () => {
    const t = buildTrackedInvoice(base, { today });
    expect(t.schedule.dueDate).toBe("2025-04-16");
    expect(t.schedule.dueDateSource).toBe("calculated");
  });

  it("works out the balance and the status", () => {
    const t = buildTrackedInvoice(base, { today });
    expect(t.money.calculatedOutstanding).toBeCloseTo(38897.72, 2);
    expect(t.status).toBe("OVERDUE");
    expect(t.overdueDays).toBe(541);
    expect(t.ageing).toBe("Over 90 days");
  });

  it("works out the forex gain on the receipt", () => {
    const t = buildTrackedInvoice(base, { today });
    expect(t.money.receipts[0].rateDifference).toBeCloseTo(0.85, 4);
    expect(t.money.totalForexGainLoss).toBeCloseTo(13999, 0);
  });

  it("says Requires verification rather than Overdue when no date can be worked out and the default is off", () => {
    const t = buildTrackedInvoice(
      { ...base, paymentTerms: null, blDate: null, enteredDueDate: null },
      { today, params: { ...TRACKING_DEFAULTS, defaultDueDays: 0 } },
    );
    expect(t.schedule.dueDate).toBeNull();
    expect(t.status).toBe("REQUIRES_VERIFICATION");
    expect(t.overdueDays).toBeNull();
    expect(t.ageing).toBe("No due date");
  });

  it("still ages the invoice itself when there is no due date", () => {
    const t = buildTrackedInvoice({ ...base, paymentTerms: null, blDate: null }, { today });
    expect(t.invoiceAge).toBe(669);
    expect(t.needsAttention).toBe(true);
  });

  it("lists what is missing without refusing the record", () => {
    const t = buildTrackedInvoice(
      {
        ...base,
        invoiceNo: null,
        customerInvoiceValue: null,
        exchangeRate: null,
        paymentTerms: null,
        blDate: null,
        receipts: [],
      },
      { today },
    );
    expect(t.status).toBe("NO_VALUE");
    expect(t.missingFields.length).toBeGreaterThanOrEqual(5);
    expect(t.missingFields.join(" ")).toMatch(/Invoice number/);
    expect(t.missingFields.join(" ")).toMatch(/BL date/);
  });

  it("counts a nearly-settled residue as its own state, not as a chase", () => {
    const t = buildTrackedInvoice(
      {
        ...base,
        customerInvoiceValue: 26756.97,
        receipts: [{ seq: 1, amountFcy: 26351.56, receiptDate: "2026-02-26" }],
      },
      { today },
    );
    expect(t.money.calculatedOutstanding).toBeCloseTo(405.41, 2);
    expect(t.status).toBe("OVERDUE"); // it is still past its due date
    expect(t.urgency).toBeLessThan(
      buildTrackedInvoice(base, { today }).urgency,
    );
  });
});

describe("a 'Payment Terms' column heading is not a customer-level term", () => {
  it("leaves the header term empty when the heading is only a column", async () => {
    // these two sheets have a Payment Terms *column*; the cell to its right is
    // the next heading, which used to be taken as the customer's terms
    for (const file of ["statement_blue_planet.xlsx", "statement_fair_deal.xlsx"]) {
      const [read] = await readPaymentSheet(readFileSync(path.join(FIXTURES, file)), file);
      expect(read.headerPaymentTerms, file).toBeNull();
    }
  });
});
