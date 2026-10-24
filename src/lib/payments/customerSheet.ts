/**
 * One customer's outstanding sheet as a PDF, in the layout Accounts sends
 * customers (owner, 23 Oct 2026, with "Ankur International.pdf": "let them
 * download it in this exact format"): A4 landscape, the date top right on
 * green, a Customer Name box, then Sl. No. · Invoice Date · Invoice no. ·
 * Invoice Value · Received · Balance · Payment Terms · Container No · ETA/ Due
 * Date · Overdue days · Remarks, and a TOTAL row. Amounts are written as that
 * sheet writes them — the symbol set apart, Indian digit grouping, a dash for
 * nothing received.
 *
 * The rows are the customer's open invoices in one currency (a balance left to
 * collect), oldest invoice first — the figures every screen shows, from
 * buildTrackedInvoice. Pure apart from pdf-lib: no database, no request.
 *
 * The same sheet as the ERP's Payment Tracking (lib/accounts/payments/customerSheet.ts).
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

import type { TrackedInvoice } from "./record";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2025-04-05 → 05-Apr-25, as the sheet writes a date. */
export function sheetDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${MONTHS[Number(m) - 1]}-${y.slice(2)}`;
}

/** 227180.27 → "2,27,180.27"; zero → "-", as the sheet's accounting format. */
export function sheetAmount(n: number | null | undefined): string {
  if (n === null || n === undefined || Math.abs(n) < 0.005) return "-";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The symbol a currency is set apart with: "$", "€", or the code itself. */
export function sheetSymbol(currency: string | null | undefined): string {
  const c = (currency ?? "").toUpperCase();
  return ({ USD: "$", EUR: "€", GBP: "£", INR: "Rs" } as Record<string, string>)[c] ?? c;
}

export interface SheetRow {
  sl: number;
  invoiceDate: string;
  invoiceNo: string;
  value: number | null;
  received: number;
  balance: number;
  terms: string;
  container: string;
  due: string;
  overdueDays: number | null;
  remarks: string;
}

/** The rows the sheet lists: the open invoices, oldest first, numbered. */
export function sheetRows(invoices: TrackedInvoice[]): SheetRow[] {
  return invoices
    .filter((i) => (i.money.calculatedOutstanding ?? 0) > 0.01)
    .sort((a, b) => (a.invoiceDate ?? "9999").localeCompare(b.invoiceDate ?? "9999") || (a.invoiceNo ?? "").localeCompare(b.invoiceNo ?? ""))
    .map((i, n) => ({
      sl: n + 1,
      invoiceDate: sheetDate(i.invoiceDate),
      invoiceNo: i.invoiceNo ?? "",
      value: i.customerInvoiceValue,
      received: i.money.totalReceived,
      balance: i.money.calculatedOutstanding ?? 0,
      terms: i.schedule.term.raw || i.paymentTerms || "",
      container: i.containerNo ?? "",
      due: sheetDate(i.schedule.dueDate ?? i.eta),
      overdueDays: i.overdueDays !== null && i.overdueDays > 0 ? i.overdueDays : null,
      remarks: i.remarks ?? "",
    }));
}

// the sheet's colours
const HEAD_FILL = rgb(0.867, 0.922, 0.969); // #DDEBF7
const DATE_FILL = rgb(0.663, 0.82, 0.557); // #A9D18E
const INK = rgb(0, 0, 0);
const LINE = 0.75;

// A4 landscape, in points
const W = 841.89;
const H = 595.28;

/** [heading, width, alignment]; the amount columns carry the symbol at their left. */
const COLUMNS: Array<[string, number, "c" | "l" | "r" | "money"]> = [
  ["Sl. No.", 38, "c"],
  ["Invoice Date", 62, "c"],
  ["Invoice no.", 60, "c"],
  ["Invoice Value", 74, "money"],
  ["Received", 64, "money"],
  ["Balance", 72, "money"],
  ["Payment Terms", 132, "l"],
  ["Container No", 58, "l"],
  ["ETA/ Due Date", 62, "c"],
  ["Overdue days", 62, "r"],
  ["Remarks", 60, "l"],
];

function fit(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t}…`;
}

/** pdf-lib's standard fonts are WinAnsi: anything outside it prints as "?". */
function ansi(text: string): string {
  return text.replace(/[^\x20-\x7E -ÿ€]/g, "?");
}

function cell(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  font: PDFFont,
  size: number,
  align: "c" | "l" | "r",
  fill?: ReturnType<typeof rgb>,
) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: INK, borderWidth: LINE, color: fill });
  const t = fit(ansi(text), font, size, w - 4);
  const tw = font.widthOfTextAtSize(t, size);
  const tx = align === "c" ? x + (w - tw) / 2 : align === "r" ? x + w - tw - 2.5 : x + 2.5;
  page.drawText(t, { x: tx, y: y + (h - size) / 2 + 1.5, size, font, color: INK });
}

/** An amount cell: the symbol at the left edge, the figure at the right. */
function moneyCell(page: PDFPage, x: number, y: number, w: number, h: number, sym: string, amount: string, font: PDFFont, size: number, fill?: ReturnType<typeof rgb>) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: INK, borderWidth: LINE, color: fill });
  const ty = y + (h - size) / 2 + 1.5;
  page.drawText(ansi(sym), { x: x + 2.5, y: ty, size, font, color: INK });
  const t = ansi(amount);
  page.drawText(t, { x: x + w - font.widthOfTextAtSize(t, size) - 2.5, y: ty, size, font, color: INK });
}

/** The sheet, as PDF bytes. `today` is yyyy-mm-dd; the sheet prints it dd-mm-yyyy. */
export async function buildCustomerSheet(args: { customerName: string; currency: string | null; invoices: TrackedInvoice[]; today: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${args.customerName} — outstanding`);
  pdf.setCreator("Pacific ERP · Payment tracking");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const rows = sheetRows(args.invoices);
  const sym = sheetSymbol(args.currency);
  const tableW = COLUMNS.reduce((s, c) => s + c[1], 0);
  const left = (W - tableW) / 2;
  const rowH = 13;
  const size = 7.5;
  const perPage = 30;

  const totals = rows.reduce((t, r) => ({ value: t.value + (r.value ?? 0), received: t.received + r.received, balance: t.balance + r.balance }), { value: 0, received: 0, balance: 0 });
  const [y4, m2, d2] = args.today.split("-");
  const stamp = `${d2}-${m2}-${y4}`;

  for (let start = 0; start === 0 || start < rows.length; start += perPage) {
    const page = pdf.addPage([W, H]);
    let y = H - 70;

    // the date, top right, on green
    const dw = 70;
    page.drawRectangle({ x: left + tableW - dw - 40, y: y + 22, width: dw, height: 14, color: DATE_FILL });
    page.drawText(stamp, { x: left + tableW - 40 - regular.widthOfTextAtSize(stamp, 9) - 4, y: y + 26, size: 9, font: regular, color: INK });

    // the customer's name in its box
    cell(page, left, y, 190, 14, "Customer Name", bold, 9, "c", HEAD_FILL);
    cell(page, left + 190, y, 160, 14, args.customerName, regular, 9, "l");
    y -= 40;

    // the headings
    let x = left;
    for (const [label, w] of COLUMNS) {
      cell(page, x, y, w, rowH, label, bold, size, "c", HEAD_FILL);
      x += w;
    }

    const slice = rows.slice(start, start + perPage);
    for (const r of slice) {
      y -= rowH;
      const values = [
        String(r.sl),
        r.invoiceDate,
        r.invoiceNo,
        sheetAmount(r.value),
        sheetAmount(r.received),
        sheetAmount(r.balance),
        r.terms,
        r.container,
        r.due,
        r.overdueDays === null ? "" : r.overdueDays.toFixed(2),
        r.remarks,
      ];
      x = left;
      COLUMNS.forEach(([, w, align], c) => {
        if (align === "money") moneyCell(page, x, y, w, rowH, sym, values[c], regular, size);
        else cell(page, x, y, w, rowH, values[c], regular, size, align);
        x += w;
      });
    }

    // the total, on the last page
    if (start + perPage >= rows.length) {
      y -= rowH;
      const first = COLUMNS[0][1] + COLUMNS[1][1] + COLUMNS[2][1];
      cell(page, left, y, first, rowH, "TOTAL", bold, size, "c", HEAD_FILL);
      x = left + first;
      moneyCell(page, x, y, COLUMNS[3][1], rowH, sym, sheetAmount(totals.value), bold, size, HEAD_FILL);
      x += COLUMNS[3][1];
      moneyCell(page, x, y, COLUMNS[4][1], rowH, sym, sheetAmount(totals.received), bold, size, HEAD_FILL);
      x += COLUMNS[4][1];
      moneyCell(page, x, y, COLUMNS[5][1], rowH, sym, sheetAmount(totals.balance), bold, size, HEAD_FILL);
      x += COLUMNS[5][1];
      const rest = tableW - (x - left);
      page.drawRectangle({ x, y, width: rest, height: rowH, borderColor: INK, borderWidth: LINE, color: HEAD_FILL });
    }
    if (rows.length === 0) {
      page.drawText("No open invoices: nothing is outstanding for this customer.", { x: left, y: y - 20, size: 9, font: regular, color: INK });
    }
  }

  return pdf.save();
}
