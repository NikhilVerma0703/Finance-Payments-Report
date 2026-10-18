/** The downloaded report: what is in it, and how it is formatted. */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { TRACKING_DEFAULTS } from "@/lib/payments/record";
import { buildInvoicesCsv, buildReportWorkbook, moneyFormat } from "@/server/payments/workbook";
import { TODAY, tracked } from "./helpers";

const rows = [
  tracked({
    id: "a", invoiceNo: "PS/1", customerName: "Alpha", exchangeRate: 83, enteredDueDate: "2026-09-01",
    customerInvoiceValue: 1000, poNo: "PO-9", blDate: "2026-05-20",
    receipts: [
      { seq: 1, receiptDate: "2026-06-01", amountFcy: 300, exchangeRate: 84, bankRef: "UTR1" },
      { seq: 2, receiptDate: "2026-07-01", amountFcy: 200, exchangeRate: 82, bankRef: "UTR2" },
      { seq: 3, receiptDate: "2026-08-01", amountFcy: 100, exchangeRate: 83, bankRef: "UTR3" },
    ],
    notes: [{ noteType: "CREDIT", amount: 50, noteNo: "CN1" }],
  }),
  tracked({ id: "b", invoiceNo: "PS/2", customerName: "Beta", customerInvoiceValue: 500, enteredDueDate: "2026-12-01" }),
  tracked({ id: "c", invoiceNo: "EU/1", customerName: "Gamma", currency: "EUR", customerInvoiceValue: 700 }),
];

async function load() {
  const buf = await buildReportWorkbook(rows, {
    today: TODAY,
    filters: { customer: "Alpha" },
    params: TRACKING_DEFAULTS,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

function headings(ws: ExcelJS.Worksheet, row: number): string[] {
  const out: string[] = [];
  ws.getRow(row).eachCell({ includeEmpty: true }, (c) => out.push(String(c.value ?? "")));
  return out;
}

describe("the report workbook", () => {
  it("has the six sheets", async () => {
    const wb = await load();
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Invoices", "Receipts", "CN & DN", "Customer Summary", "Ageing Summary", "About This Report",
    ]);
  });

  it("states its date and filters", async () => {
    const ws = (await load()).getWorksheet("Invoices")!;
    expect(String(ws.getCell("A2").value)).toContain(TODAY);
    expect(String(ws.getCell("A3").value)).toContain("Customer: Alpha");
  });

  it("puts every receipt on the invoice row, as many groups as the busiest invoice needs", async () => {
    const ws = (await load()).getWorksheet("Invoices")!;
    const h = headings(ws, 6);
    expect(h).toContain("Receipt 3 Bank Ref.");
    expect(h).not.toContain("Receipt 4 Date");
    const row = ws.getRow(7);
    expect(row.getCell(h.indexOf("Receipt 2 Amount") + 1).value).toBe(200);
    expect(row.getCell(h.indexOf("Receipt 2 Rate Difference") + 1).value).toBe(-1);
    expect(row.getCell(h.indexOf("Receipt 1 Forex G/L (INR)") + 1).value).toBe(300);
  });

  it("does not carry the columns that were asked to be removed", async () => {
    const h = headings((await load()).getWorksheet("Invoices")!, 6);
    for (const gone of ["Terms Understood As", "Due Date Source", "Counted From", "% Collected", "Not Yet Recorded", "Source", "Source File", "Source As On"]) {
      expect(h).not.toContain(gone);
    }
  });

  it("writes real dates and currency formats", async () => {
    const ws = (await load()).getWorksheet("Invoices")!;
    const h = headings(ws, 6);
    const due = ws.getRow(7).getCell(h.indexOf("Due Date") + 1);
    expect(due.value).toBeInstanceOf(Date);
    expect(due.numFmt).toBe("dd-mmm-yyyy");
    expect(ws.getRow(7).getCell(h.indexOf("Invoice Value") + 1).numFmt).toBe(moneyFormat("USD"));
    expect(moneyFormat("INR")).toContain("##\\,##\\,##0.00");
    expect(moneyFormat("EUR")).toBe('"€"#,##0.00');
  });

  it("totals per currency, never across", async () => {
    const ws = (await load()).getWorksheet("Invoices")!;
    const labels: string[] = [];
    ws.eachRow((r) => {
      const v = String(r.getCell(2).value ?? "");
      if (v.startsWith("Total")) labels.push(v);
    });
    expect(labels.sort()).toEqual(["Total EUR (1 invoice)", "Total USD (2 invoices)"]);
  });

  it("lists each receipt and note on a sheet of its own", async () => {
    const wb = await load();
    expect(wb.getWorksheet("Receipts")!.rowCount).toBeGreaterThanOrEqual(3 + 3);
    let cn = false;
    wb.getWorksheet("CN & DN")!.eachRow((r) => {
      if (String(r.getCell(5).value) === "CN1") cn = true;
    });
    expect(cn).toBe(true);
  });

  it("CSV carries the same invoices", () => {
    const csv = buildInvoicesCsv(rows);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(4);
    expect(csv).toContain("PS/1,Alpha");
  });
});
