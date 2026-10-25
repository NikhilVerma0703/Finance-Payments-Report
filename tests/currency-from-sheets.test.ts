/**
 * The currency of an uploaded customer sheet (owner, 25 Oct 2026:
 * "automatically fetch the currency from the uploaded Excel sheets … without
 * manually entering or hardcoding it").
 *
 * The sheets uploaded so far format their received and balance cells in
 * Excel's US-dollar format and leave the invoice value in a plain number
 * format, so a reader that looked at the invoice-value column alone found no
 * currency in any of them. Every sheet here is built in the test; every name
 * and figure is made up (Test Customer A, TEST/…).
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { currencyOfFormat, currencyOfText, readPaymentSheet, type SheetRead } from "@/lib/payments/sheetReader";

const DOLLAR = '_-[$$-409]* #,##0.00_ ;_-[$$-409]* -#,##0.00 ;_-[$$-409]* "-"??_ ;_-@_ ';
const PLAIN = '_ * #,##0.00_ ;_ * -#,##0.00_ ;_ * "-"??_ ;_ @_ ';

async function read(opts: { heading?: string; formats?: Partial<Record<"D" | "E" | "F", string>>; title?: string; currencyColumn?: string }): Promise<SheetRead> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Statement");
  ws.getCell("A1").value = "Customer Name";
  ws.getCell("B1").value = "Test Customer A";
  ws.getCell("A2").value = "Payment Terms";
  ws.getCell("B2").value = "100% Cash Against Documents (CAD)";
  if (opts.title) ws.getCell("A3").value = opts.title;
  const head = ["Sl No", "Invoice No", "Invoice Date", opts.heading ?? "Invoice Value", "Received", "Balance"];
  if (opts.currencyColumn) head.push("Currency");
  ws.getRow(5).values = head;
  [
    [1, "TEST/0001", new Date(Date.UTC(2026, 0, 5)), 100, 40, 60],
    [2, "TEST/0002", new Date(Date.UTC(2026, 0, 12)), 150, 0, 150],
  ].forEach((r, i) => {
    ws.getRow(6 + i).values = opts.currencyColumn ? [...r, opts.currencyColumn] : r;
    for (const col of ["D", "E", "F"] as const) ws.getCell(`${col}${6 + i}`).numFmt = opts.formats?.[col] ?? PLAIN;
  });
  const [sheet] = await readPaymentSheet(Buffer.from(await wb.xlsx.writeBuffer()), "test-sheet.xlsx");
  return sheet!;
}

describe("the currency of an uploaded sheet", () => {
  it("is read from the dollar format on the received and balance cells, when the invoice value has none", async () => {
    const s = await read({ formats: { D: PLAIN, E: DOLLAR, F: DOLLAR } });
    expect(s.currency).toBe("USD");
    expect(s.currencySource).toBe("the USD number format on 4 money cell(s)");
  });

  it("goes by the most common format, and names the others", async () => {
    const s = await read({ formats: { D: "[$€-2] #,##0.00", E: "[$€-2] #,##0.00", F: DOLLAR } });
    expect(s.currency).toBe("EUR");
    expect(s.currencySource).toMatch(/EUR number format on 4 money cell\(s\) \(also USD on 2\)/);
  });

  it("takes a money column's heading before any format", async () => {
    const s = await read({ heading: "Invoice Value (EUR)", formats: { E: DOLLAR, F: DOLLAR } });
    expect(s.currency).toBe("EUR");
    expect(s.currencySource).toBe("the heading of the invoice value column");
  });

  it("takes a Currency column before anything else", async () => {
    const s = await read({ currencyColumn: "inr", formats: { E: DOLLAR } });
    expect(s.currency).toBe("INR");
    expect(s.currencySource).toBe("a Currency column");
  });

  it("reads a caption above the table when nothing else says", async () => {
    const s = await read({ title: "All amounts in EUR" });
    expect(s.currency).toBe("EUR");
    expect(s.currencySource).toMatch(/above the table/);
  });

  it("never takes Cash Against Documents for the Canadian dollar, and says when nothing states one", async () => {
    const s = await read({});
    expect(s.currency).toBeNull();
    expect(s.currencySource).toBe("not stated anywhere in the sheet");
  });
});

describe("a number format's currency", () => {
  it.each([
    [DOLLAR, "USD"],
    ['"$"#,##0.00', "USD"],
    ["\\$#,##0", "USD"],
    ["[$USD] #,##0.00", "USD"],
    ["[$EUR-x-euro2] #,##0.00", "EUR"],
    ["[$€-2] #,##0.00", "EUR"],
    ["[$£-809]#,##0.00", "GBP"],
    ["[$₹-4009] #,##0.00", "INR"],
    ["[$$-1009]#,##0.00", "CAD"],
    ["[$$-C09]#,##0.00", "AUD"],
    ["[$-409]d-mmm-yy", null],
    [PLAIN, null],
    ["#,##0.00", null],
    [null, null],
  ])("%s → %s", (fmt, code) => {
    expect(currencyOfFormat(fmt)).toBe(code);
  });
});

describe("a heading's or a caption's currency", () => {
  it.each([
    ["Invoice Value (USD)", "USD"],
    ["Amount in €", "EUR"],
    ["Balance US$", "USD"],
    ["Value in Rupees", "INR"],
    ["100% Cash Against Documents (CAD)", null],
    ["Customers", null],
    ["Invoice Value", null],
  ])("%s → %s", (text, code) => {
    expect(currencyOfText(text)).toBe(code);
  });
});
