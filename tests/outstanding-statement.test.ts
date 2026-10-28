/**
 * The export outstanding statement (owner, 28 Oct 2026: "make upload accept
 * these excels too — multiple customer multiple inv multiple receipts"): one
 * row per invoice for every customer, a Customer Code saying whose, and the
 * receipts side by side under "Receipt -1", "Receipt -2" bands. Made-up
 * customers and invoices (TEST/ST/…), laid out as the office's statement is.
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { readPaymentSheet } from "@/lib/payments/sheetReader";

const HEAD = [
  "Sr.No", "Customer Code", "Sales Person", "Invoice No", "Invoice Date", "Customer Invoice value/ As per books", "PO No", "PO Date",
  "Consignee", "Notify Party", "Country", "Final Destination", "Delivery Terms", "Payment Terms", "Currency", "Ex. Rate", "Value in INR (As per Books)",
  "Bank", "IRM No", "Date", "Amount", "Ex.Rate", "Forex Gain / (Loss)",
  "Bank", "IRM No", "Date", "Amount", "Ex.Rate", "Forex Gain / (Loss)",
  "Debit Note", "Credit Note", "exess  payment adjusted", "exchange rate", "Total Receivables in FCY -as per PESPL book", "Total Receipts in FCY",
  "Payment Due Date", "Overdue in Days", "SB No", "SB Date", "BL No", "BL Date", "Container No", "ETA DATE", "Remarks -As per Kaviya", "Sales Team Remarks",
];

/** A statement with two customers: one paid in two receipts, one with an advance. */
async function statement(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("B2").value = "Test Surfaces Pvt Ltd";
  ws.getCell("B3").value = "Statement of Export Outstanding Receivables";
  ws.getCell("AU1").value = "Sheet Updated";
  ws.getCell("AV1").value = "28.10.2026";
  // the receipt bands above their sub-headings (columns S–X and Y–AD)
  for (let c = 19; c <= 24; c += 1) ws.getCell(7, c).value = "Receipt -1";
  for (let c = 25; c <= 30; c += 1) ws.getCell(7, c).value = "Receipt -2";
  HEAD.forEach((h, i) => (ws.getCell(8, i + 2).value = h));
  const col = (name: string, nth = 1) => {
    let seen = 0;
    const i = HEAD.findIndex((h) => h === name && ++seen === nth);
    return i + 2;
  };
  const put = (r: number, name: string, v: ExcelJS.CellValue, nth = 1) => (ws.getCell(r, col(name, nth)).value = v);

  // TEST-001, two receipts that settle it
  put(9, "Customer Code", "TST-001");
  put(9, "Invoice No", "TEST/ST/1");
  put(9, "Invoice Date", new Date(Date.UTC(2026, 4, 1)));
  put(9, "Customer Invoice value/ As per books", 1000);
  put(9, "PO No", "PI-SAL-ORD/26-27/00001 Dated: 28/04/2026");
  put(9, "PO Date", "PO-7004 Dated:13/04/2026");
  put(9, "Consignee", "Test Stone LLC");
  put(9, "Final Destination", "UNITED STATES OF AMERICA");
  put(9, "Payment Terms", "100% at 90 Days From BL Date");
  put(9, "Currency", "USD");
  put(9, "Ex. Rate", 84.9);
  put(9, "Bank", "KOTAK", 1);
  put(9, "IRM No", "IRM-1", 1);
  put(9, "Date", new Date(Date.UTC(2026, 6, 1)), 1);
  put(9, "Amount", 400, 1);
  put(9, "Ex.Rate", 94.7691, 1);
  put(9, "Date", new Date(Date.UTC(2026, 7, 1)), 2);
  put(9, "Amount", 600, 2);
  put(9, "Ex.Rate", 95.1549, 2);
  put(9, "Total Receivables in FCY -as per PESPL book", 0);
  put(9, "BL Date", new Date(Date.UTC(2026, 4, 5)));
  put(9, "Sales Team Remarks", "Paid in two parts");

  // TEST-001 again, in another spelling, nothing received yet
  put(10, "Customer Code", "TST - 001");
  put(10, "Invoice No", "TEST/ST/2");
  put(10, "Customer Invoice value/ As per books", 500);
  put(10, "PO No", "PI-SAL-ORD/26-27/00002");
  put(10, "PO Date", "-");
  put(10, "Consignee", "TEST STONE LLC");
  put(10, "Currency", " EURO ");
  put(10, "Total Receivables in FCY -as per PESPL book", 500);

  // TST-002: an advance, not an invoice
  put(11, "Customer Code", "TST-002");
  put(11, "Invoice No", "Advance");
  put(11, "Invoice Date", new Date(Date.UTC(2026, 8, 24)));
  put(11, "Customer Invoice value/ As per books", -16008);
  put(11, "Consignee", "Test Marble SA");
  put(11, "Currency", "USD");

  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("the export outstanding statement", () => {
  it("is read as one sheet per customer, by its Customer Code", async () => {
    const reads = await readPaymentSheet(await statement(), "statement.xlsx");
    expect(reads.map((r) => [r.statement?.customerCode, r.customerName, r.blocks[0].rows.length])).toEqual([
      ["TST-001", "Test Stone LLC", 2],
      ["TST-002", "Test Marble SA", 1],
    ]);
    expect(reads[0].statement?.names).toEqual(["Test Stone LLC", "TEST STONE LLC"]);
    expect(reads[0].asOn).toBe("2026-10-28");
  });

  it("finds the columns by their headings, and the receipt bands over them", async () => {
    const [read] = await readPaymentSheet(await statement(), "statement.xlsx");
    const m = read.blocks[0].mapping;
    expect(m.customerInvoiceValue).toBe("G");
    expect(m.invoiceNo).toBe("E");
    expect([m["receipt1.amount"], m["receipt2.amount"]]).toEqual(["V", "AB"]);
  });

  it("reads each receipt on its own, with its date, bank, IRM and full rate", async () => {
    const [read] = await readPaymentSheet(await statement(), "statement.xlsx");
    const row = read.blocks[0].rows[0];
    expect(row.receipts).toEqual([
      { seq: 1, amount: 400, date: "2026-07-01", exchangeRate: 94.7691, bank: "KOTAK", irm: "IRM-1" },
      { seq: 2, amount: 600, date: "2026-08-01", exchangeRate: 95.1549, bank: null, irm: null },
    ]);
    expect(row.received).toBe(1000);
    expect(row.receiptDate).toBe("2026-08-01");
    expect(row.balanceAgrees).toBe(true);
  });

  it("reads the proforma and the purchase order by what each cell says", async () => {
    const [read] = await readPaymentSheet(await statement(), "statement.xlsx");
    const [a, b] = read.blocks[0].rows;
    expect([a.piNo, a.poNo]).toEqual(["PI-SAL-ORD/26-27/00001", "PO-7004"]);
    expect([b.piNo, b.poNo]).toEqual(["PI-SAL-ORD/26-27/00002", null]);
    expect(a.country).toBe("UNITED STATES OF AMERICA");
    expect(a.blDate).toBe("2026-05-05");
    expect(a.remarks).toBe("Sales team: Paid in two parts");
  });

  it("reads 'EURO' as EUR, and a customer's currencies as they are", async () => {
    const [read] = await readPaymentSheet(await statement(), "statement.xlsx");
    expect(read.blocks[0].rows.map((r) => r.currency)).toEqual(["USD", "EUR"]);
    expect(read.currency).toBeNull();
    expect(read.warnings.some((w) => /USD and EUR/.test(w))).toBe(true);
  });

  it("keeps an advance's row as it is, for the importer to hold on account", async () => {
    const reads = await readPaymentSheet(await statement(), "statement.xlsx");
    const advance = reads[1].blocks[0].rows[0];
    expect([advance.invoiceNo, advance.customerInvoiceValue, advance.invoiceDate]).toEqual(["Advance", -16008, "2026-09-24"]);
  });

  it("leaves a customer's own sheet to the reader it always had", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Terry Stone");
    ws.addRow(["Invoice No", "Invoice Date", "Invoice Value", "Received", "Balance"]);
    ws.addRow(["TEST/ST/9", "01-05-2026", 1000, 400, 600]);
    const [read] = await readPaymentSheet(Buffer.from(await wb.xlsx.writeBuffer()), "terry.xlsx");
    expect(read.statement).toBeUndefined();
    expect(read.blocks[0].rows[0].receipts).toBeUndefined();
    expect(read.blocks[0].rows[0].received).toBe(400);
  });
});
