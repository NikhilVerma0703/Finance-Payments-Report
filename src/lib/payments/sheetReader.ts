/**
 * Reading a customer payment sheet.
 *
 * Four reference sheets were supplied and no two are laid out the same way:
 * the header is on row 3, 5 or 6 (twice in one of them), the customer's name is
 * in a cell on three and only in the tab name on the fourth, one carries the
 * payment term in a header cell instead of a column, one has no payment terms
 * at all, and one holds two stacked tables. None of that was a decision anybody
 * made — it is four people's templates. So the reader **finds** the shape.
 *
 * Three rules, each learned from a specific defect in the reference files:
 *
 *  1. **Read merged cells at their master.** Excel answers with a merged
 *     range's master value from every cell in it, so a total row whose label
 *     spans four columns answers "Total" when asked for its invoice number —
 *     and reading that as a data row doubles every figure on the sheet. Three
 *     of the four do this.
 *
 *  2. **Never believe a printed total.** One sheet's invoice-value total sums
 *     21 rows of a 23-row table, omitting 71,622.18, and a cell below subtracts
 *     that broken total from a good one and presents the shortfall as a
 *     genuine difference. Totals are recomputed from the rows; the printed ones
 *     are kept only so the discrepancy can be reported.
 *
 *  3. **Report what sits outside the table.** A leftover `=SUM(G6:G10)` in a
 *     spare column is not data. It is named in the warnings and not imported.
 *
 * This file only reads. It produces plain rows; deciding what to do with them
 * is the importer's job.
 */
import ExcelJS from "exceljs";

import { clean, columnLetter, toIsoDate, toNumber } from "../text";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// The standardised row
// ---------------------------------------------------------------------------

/** Every field a sheet can offer, normalised. All optional — sheets differ. */
export interface SheetRow {
  sourceRow: number;
  slNo: number | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  customerInvoiceValue: number | null;
  customsInvoiceValue: number | null;
  exchangeRate: number | null;
  received: number | null;
  receiptDate: string | null;
  receiptExchangeRate: number | null;
  /** The balance as the sheet printed it, for comparison only. */
  statedBalance: number | null;
  /** True when the printed balance equals value − received. */
  balanceAgrees: boolean;
  creditNote: number | null;
  debitNote: number | null;
  paymentTerms: string | null;
  /** "invoice" when a column gave it, "customer" from a header cell. */
  paymentTermsLevel: "invoice" | "customer" | "none";
  containerNo: string | null;
  /** The date in an "ETA / Due Date" column, exactly as found. */
  statedDueDate: string | null;
  statedOverdueDays: number | null;
  poNo: string | null;
  piNo: string | null;
  shippingBillNo: string | null;
  shippingBillDate: string | null;
  blNo: string | null;
  blDate: string | null;
  consignee: string | null;
  notifyParty: string | null;
  country: string | null;
  currency: string | null;
  remarks: string | null;
  /** Anything the reader could not make sense of on this row. */
  notes: string[];
}

export type BlockKind = "OURS" | "CUSTOMER";

export interface SheetBlock {
  label: string;
  kind: BlockKind;
  headerRow: number;
  /** Which column each field was found in — shown to the user after an import. */
  mapping: Record<string, string>;
  /** Header text that matched nothing, so an unmapped column is never silent. */
  unmapped: Array<{ column: string; heading: string }>;
  rows: SheetRow[];
  totals: { value: number; received: number; balance: number };
  statedTotals: { value: number | null; received: number | null; balance: number | null } | null;
  totalIssues: string[];
}

export interface SheetRead {
  fileName: string;
  sheetName: string;
  customerName: string | null;
  customerSource: string;
  asOn: string | null;
  asOnSource: "cell" | "tab name" | "block caption" | "TODAY() formula" | "not stated";
  currency: string | null;
  currencySource: string;
  /** A payment term written once for the whole customer. */
  headerPaymentTerms: string | null;
  blocks: SheetBlock[];
  strayCells: Array<{ ref: string; value: string; formula: string | null }>;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Column recognition
// ---------------------------------------------------------------------------

/**
 * Header patterns, tried in order.
 *
 * Deliberately loose. "Invoice no.", "Invoice No", "INVOICE NUMBER" and
 * "Inv No" are the same column, and across four sheets they all turn up.
 */
const COLUMNS: Array<[keyof SheetRow | "customsInvoiceValue", RegExp]> = [
  ["slNo", /^(sl|sr|s)\.? ?(no|num)/],
  ["invoiceNo", /^(invoice|inv)\.? ?(no|num|#)/],
  ["invoiceDate", /^(invoice|inv)\.? ?date/],
  ["customsInvoiceValue", /(customs|as per books|book) .*value|value as per book/],
  ["customerInvoiceValue", /(invoice|customer).*(value|amount)$|^value$|^amount$/],
  ["exchangeRate", /^(invoice )?(exchange|ex\.?) ?rate/],
  ["receiptExchangeRate", /receipt.*(exchange|ex\.?) ?rate/],
  ["received", /^(amount )?(received|receipt amount|collection)/],
  ["receiptDate", /^receipt ?date|date of receipt/],
  ["statedBalance", /^(balance|outstanding|bal)/],
  ["creditNote", /credit ?note|^cn$/],
  ["debitNote", /debit ?note|^dn$/],
  ["paymentTerms", /^payment ?terms?|^terms$/],
  ["containerNo", /^container ?(no|num)/],
  ["statedDueDate", /\beta\b|due ?date|arrival/],
  ["statedOverdueDays", /overdue ?days|days overdue/],
  ["poNo", /^po\.? ?(no|num)|purchase order/],
  ["piNo", /^pi\.? ?(no|num)|proforma/],
  ["shippingBillNo", /shipping ?bill ?(no|num)/],
  ["shippingBillDate", /shipping ?bill ?date/],
  ["blNo", /^b\/?l ?(no|num)|bill of lading ?(no|num)/],
  ["blDate", /^b\/?l ?date|bill of lading date/],
  ["consignee", /^consignee/],
  ["notifyParty", /^notify/],
  ["country", /^country|destination/],
  ["currency", /^currency|^curr\b/],
  ["remarks", /^remarks?|^notes?$|^comments?/],
];

const squash = (v: unknown) => clean(v).toLowerCase().replace(/\s+/g, " ").trim();

function matchColumn(text: string): string | null {
  for (const [key, re] of COLUMNS) if (re.test(text)) return String(key);
  return null;
}

/**
 * A cell's value, but only where the cell actually holds one.
 *
 * A merged range reports its master's value from every cell in it, so a cell
 * that is merged and is not the master answers null. This one guard is what
 * stops a total row being read as an invoice (see the file header).
 */
function valueOf(cell: ExcelJS.Cell | undefined): unknown {
  if (!cell) return null;
  const m = cell as unknown as { isMerged?: boolean; master?: { address?: string } };
  if (m.isMerged && m.master?.address && m.master.address !== cell.address) return null;

  const v = cell.value as unknown;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return o.result ?? null;
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
    }
    if ("text" in o) return o.text;
    if ("error" in o) return null;
  }
  return v;
}

function formulaOf(cell: ExcelJS.Cell | undefined): string | null {
  const f = (cell as unknown as { formula?: string })?.formula;
  return f ? `=${f}` : null;
}

function dateOf(cell: ExcelJS.Cell | undefined): string | null {
  const v = valueOf(cell);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = clean(v);
  return s ? toIsoDate(s) : null;
}

function numberOf(cell: ExcelJS.Cell | undefined): number | null {
  const v = valueOf(cell);
  if (typeof v === "number") return Number.isFinite(v) ? round2(v) : null;
  const s = clean(v);
  return s ? toNumber(s) : null;
}

function textOf(cell: ExcelJS.Cell | undefined): string | null {
  return clean(valueOf(cell)) || null;
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

export async function readPaymentSheet(buffer: Buffer, fileName: string): Promise<SheetRead[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => readSheet(ws, fileName));
}

function readSheet(ws: ExcelJS.Worksheet, fileName: string): SheetRead {
  const warnings: string[] = [];
  const maxRow = Math.max(ws.rowCount ?? 0, ws.actualRowCount ?? 0);
  const maxCol = Math.max(ws.columnCount ?? 0, ws.actualColumnCount ?? 0);

  // ---- 1. every header row in the sheet (one of the four holds two tables)
  const headers: Array<{
    row: number;
    mapping: Record<string, string>;
    unmapped: Array<{ column: string; heading: string }>;
  }> = [];

  for (let r = 1; r <= maxRow; r += 1) {
    const mapping: Record<string, string> = {};
    const unmapped: Array<{ column: string; heading: string }> = [];
    let headings = 0;

    for (let c = 1; c <= maxCol; c += 1) {
      const text = squash(valueOf(ws.getCell(r, c)));
      if (!text) continue;
      headings += 1;
      const key = matchColumn(text);
      if (key && !mapping[key]) mapping[key] = columnLetter(c);
      else if (!key) unmapped.push({ column: columnLetter(c), heading: clean(valueOf(ws.getCell(r, c))) });
    }

    // a header row names an invoice *and* a figure. A stray cell reading
    // "Balance" somewhere on the sheet is not a table.
    const hasInvoice = Boolean(mapping.invoiceNo || mapping.invoiceDate);
    const hasMoney = Boolean(mapping.customerInvoiceValue || mapping.statedBalance || mapping.received);
    if (hasInvoice && hasMoney && headings >= 3) headers.push({ row: r, mapping, unmapped });
  }

  const customer = customerFrom(ws, fileName, maxRow, maxCol);

  if (!headers.length) {
    return {
      fileName,
      sheetName: ws.name,
      customerName: customer.name,
      customerSource: customer.source,
      asOn: null,
      asOnSource: "not stated",
      currency: null,
      currencySource: "no table found",
      headerPaymentTerms: null,
      blocks: [],
      strayCells: [],
      warnings: [
        `No invoice table was found in '${ws.name}'. A payment sheet needs a header row naming ` +
          "an invoice number or date, and at least one of invoice value, received or balance.",
      ],
    };
  }

  // a "Payment Terms" *column heading* is not a customer-level term: the cell to
  // its right is the next heading ("Container No"), not a term — so the table's
  // own heading rows are not searched for one
  const headerTerms = labelledValue(
    ws,
    maxRow,
    maxCol,
    /^payment ?terms?$/,
    new Set(headers.map((h) => h.row)),
  );
  const asOn = findAsOn(ws, maxRow, maxCol, headers[0].row);

  if (asOn.source === "TODAY() formula") {
    warnings.push(
      "This sheet's as-on date is a =TODAY() formula, so its overdue figures changed every time " +
        `the file was opened. The cached value (${asOn.date}) is what was saved — it is not a ` +
        "position anyone can reproduce. Every date in this section is recomputed against today.",
    );
  } else if (asOn.source === "not stated") {
    warnings.push("This sheet does not say what date its figures are as at.");
  }

  // ---- 2. the blocks
  const used = new Set<string>();
  const blocks: SheetBlock[] = [];
  for (const [i, h] of headers.entries()) {
    const stop = headers[i + 1]?.row ?? maxRow + 1;
    const block = readBlock(ws, h, stop, maxCol, headerTerms, used);
    blocks.push(block);
    warnings.push(...block.totalIssues);
  }

  if (blocks.length > 1) {
    warnings.push(
      `This sheet holds ${blocks.length} tables — ` +
        blocks.map((b) => `'${b.label || "(untitled)"}' with ${b.rows.length} row(s)`).join(" and ") +
        ". They are read separately so they can be compared rather than merged.",
    );
  }

  for (const b of blocks) {
    for (const u of b.unmapped) {
      warnings.push(
        `Column ${u.column} is headed "${u.heading}", which matched no known field. Its values ` +
          "were not imported.",
      );
    }
  }

  const strays = findStrays(ws, maxRow, maxCol, used);
  for (const s of strays) {
    warnings.push(
      `Cell ${s.ref} holds ${s.value}${s.formula ? ` (${s.formula})` : ""} but sits outside the ` +
        "table's columns. It was not imported.",
    );
  }

  const currency = findCurrency(ws, blocks);

  return {
    fileName,
    sheetName: ws.name,
    customerName: customer.name,
    customerSource: customer.source,
    asOn: asOn.date,
    asOnSource: asOn.source,
    currency: currency.code,
    currencySource: currency.source,
    headerPaymentTerms: headerTerms,
    blocks,
    strayCells: strays,
    warnings,
  };
}

// ---------------------------------------------------------------------------

function readBlock(
  ws: ExcelJS.Worksheet,
  header: {
    row: number;
    mapping: Record<string, string>;
    unmapped: Array<{ column: string; heading: string }>;
  },
  stopRow: number,
  maxCol: number,
  headerTerms: string | null,
  used: Set<string>,
): SheetBlock {
  const { row: headerRow, mapping } = header;
  const label = captionAbove(ws, headerRow, maxCol);
  const rows: SheetRow[] = [];
  let statedTotals: SheetBlock["statedTotals"] = null;

  const at = (r: number, key: string) => (mapping[key] ? ws.getCell(`${mapping[key]}${r}`) : undefined);
  const mapped = new Set(Object.values(mapping).map(columnIndexOf));
  const mark = (r: number) => {
    for (const c of mapped) used.add(`${r},${c}`);
  };
  mark(headerRow);

  for (let r = headerRow + 1; r < stopRow; r += 1) {
    if (rowSaysTotal(ws, r, maxCol)) {
      statedTotals = {
        value: numberOf(at(r, "customerInvoiceValue")),
        received: numberOf(at(r, "received")),
        balance: numberOf(at(r, "statedBalance")),
      };
      mark(r);
      continue;
    }

    const invoiceNo = textOf(at(r, "invoiceNo"));
    const invoiceDate = dateOf(at(r, "invoiceDate"));
    const value = numberOf(at(r, "customerInvoiceValue"));

    // A row needs an identity — a number or a date. A row carrying only a
    // figure is not an invoice, and one of the reference sheets has exactly
    // that three rows below its total: a cell holding the difference between a
    // good total and a broken one. Reading it as an invoice would add 71,622.18
    // of phantom receivable. It is reported as a stray instead.
    if (!invoiceNo && !invoiceDate) continue;

    const notes: string[] = [];
    const received = numberOf(at(r, "received"));
    const statedBalance = numberOf(at(r, "statedBalance"));
    const recomputed = value === null ? null : round2(value - (received ?? 0));
    const balanceAgrees =
      statedBalance === null || recomputed === null || Math.abs(statedBalance - recomputed) <= 0.01;
    if (!balanceAgrees) {
      notes.push(
        `The sheet prints a balance of ${statedBalance} where value − received gives ${recomputed}.`,
      );
    }

    // "Diverted Containers" is written across the PO column as a label over two
    // invoices. It describes what happened; it is not a purchase order.
    const rawPo = textOf(at(r, "poNo"));
    const looksLikePo = Boolean(rawPo && /\d/.test(rawPo) && rawPo.length <= 24);
    if (rawPo && !looksLikePo) {
      notes.push(`"${rawPo}" was in the PO column; kept as a remark rather than a PO number.`);
    }

    const remarkParts = [textOf(at(r, "remarks")), !looksLikePo ? rawPo : null].filter(Boolean);
    mark(r);

    rows.push({
      sourceRow: r,
      slNo: numberOf(at(r, "slNo")),
      invoiceNo,
      invoiceDate,
      customerInvoiceValue: value,
      customsInvoiceValue: numberOf(at(r, "customsInvoiceValue")),
      exchangeRate: numberOf(at(r, "exchangeRate")),
      received,
      receiptDate: dateOf(at(r, "receiptDate")),
      receiptExchangeRate: numberOf(at(r, "receiptExchangeRate")),
      statedBalance,
      balanceAgrees,
      creditNote: numberOf(at(r, "creditNote")),
      debitNote: numberOf(at(r, "debitNote")),
      paymentTerms: textOf(at(r, "paymentTerms")) ?? headerTerms,
      paymentTermsLevel: textOf(at(r, "paymentTerms")) ? "invoice" : headerTerms ? "customer" : "none",
      containerNo: textOf(at(r, "containerNo")),
      statedDueDate: dateOf(at(r, "statedDueDate")),
      statedOverdueDays: numberOf(at(r, "statedOverdueDays")),
      poNo: looksLikePo ? rawPo : null,
      piNo: textOf(at(r, "piNo")),
      shippingBillNo: textOf(at(r, "shippingBillNo")),
      shippingBillDate: dateOf(at(r, "shippingBillDate")),
      blNo: textOf(at(r, "blNo")),
      blDate: dateOf(at(r, "blDate")),
      consignee: textOf(at(r, "consignee")),
      notifyParty: textOf(at(r, "notifyParty")),
      country: textOf(at(r, "country")),
      currency: textOf(at(r, "currency")),
      remarks: remarkParts.join(" · ") || null,
      notes,
    });
  }

  const totals = {
    value: round2(rows.reduce((s, x) => s + (x.customerInvoiceValue ?? 0), 0)),
    received: round2(rows.reduce((s, x) => s + (x.received ?? 0), 0)),
    balance: round2(
      rows.reduce((s, x) => s + (x.customerInvoiceValue ?? 0) - (x.received ?? 0), 0),
    ),
  };

  const totalIssues: string[] = [];
  if (statedTotals) {
    const check = (what: string, stated: number | null, ours: number) => {
      if (stated === null || Math.abs(stated - ours) <= 0.01) return;
      totalIssues.push(
        `In '${label || ws.name}' the printed ${what} total is ${stated.toFixed(2)} but the rows ` +
          `add up to ${ours.toFixed(2)} — a difference of ${Math.abs(round2(stated - ours)).toFixed(2)}. ` +
          "The rows were used, because a printed total can be wrong and rows cannot.",
      );
    };
    check("invoice value", statedTotals.value, totals.value);
    check("received", statedTotals.received, totals.received);
    check("balance", statedTotals.balance, totals.balance);
  }

  return {
    label,
    kind: /customer'?s? record/i.test(label) ? "CUSTOMER" : "OURS",
    headerRow,
    mapping,
    unmapped: header.unmapped,
    rows,
    totals,
    statedTotals,
    totalIssues,
  };
}

function columnIndexOf(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function rowSaysTotal(ws: ExcelJS.Worksheet, r: number, maxCol: number): boolean {
  for (let c = 1; c <= maxCol; c += 1) {
    const t = squash(valueOf(ws.getCell(r, c)));
    if (t && /^(total|grand total|sub ?total)\b/.test(t)) return true;
  }
  return false;
}

function captionAbove(ws: ExcelJS.Worksheet, headerRow: number, maxCol: number): string {
  for (let r = headerRow - 1; r >= Math.max(1, headerRow - 3); r -= 1) {
    const text = rowCaption(ws, r, maxCol);
    if (text && !/^customer name|^payment ?terms?/i.test(text)) return text;
  }
  return "";
}

function rowCaption(ws: ExcelJS.Worksheet, r: number, maxCol: number): string {
  const parts: string[] = [];
  for (let c = 1; c <= maxCol; c += 1) {
    const v = clean(valueOf(ws.getCell(r, c)));
    if (v && v !== parts[parts.length - 1]) parts.push(v);
  }
  return parts.join(" ");
}

/**
 * The value beside a label.
 *
 * The label is often merged across several columns, and `valueOf` already skips
 * non-master cells; the equality guard covers the case where the value next to
 * it genuinely repeats the label.
 */
function labelledValue(
  ws: ExcelJS.Worksheet,
  maxRow: number,
  maxCol: number,
  label: RegExp,
  skipRows: ReadonlySet<number> = new Set(),
): string | null {
  for (let r = 1; r <= Math.min(maxRow, 12); r += 1) {
    if (skipRows.has(r)) continue;
    for (let c = 1; c <= maxCol; c += 1) {
      const here = clean(valueOf(ws.getCell(r, c)));
      if (!label.test(squash(here))) continue;
      for (let k = c + 1; k <= maxCol; k += 1) {
        const v = clean(valueOf(ws.getCell(r, k)));
        if (v && v !== here) return v;
      }
    }
  }
  return null;
}

function customerFrom(
  ws: ExcelJS.Worksheet,
  fileName: string,
  maxRow: number,
  maxCol: number,
): { name: string | null; source: string } {
  const cell = labelledValue(ws, Math.max(maxRow, 12), Math.max(maxCol, 12), /^customer ?name$/);
  if (cell) return { name: cell, source: "the 'Customer Name' cell" };

  const fromTab = ws.name.replace(/\(.*?\)/g, "").replace(/[_-]+/g, " ").trim();
  if (fromTab && !/^sheet\d*$/i.test(fromTab)) {
    return { name: fromTab, source: "the worksheet tab name" };
  }
  const fromFile = fileName.replace(/\.[a-z]+$/i, "").replace(/[_-]+/g, " ").trim();
  return { name: fromFile || null, source: "the file name" };
}

/**
 * The date the figures are as at, and how far it can be trusted.
 *
 * Looked for in this order: a `=TODAY()` cell (three of the four reference
 * sheets do this, which means they have no fixed position date at all); a date
 * in the tab name; a date in a block caption; any other date above the table.
 */
function findAsOn(
  ws: ExcelJS.Worksheet,
  maxRow: number,
  maxCol: number,
  firstHeader: number,
): { date: string | null; source: SheetRead["asOnSource"] } {
  for (let r = 1; r <= Math.min(maxRow, firstHeader); r += 1) {
    for (let c = 1; c <= maxCol; c += 1) {
      const cell = ws.getCell(r, c);
      if (/^=?TODAY\(\)/i.test(formulaOf(cell) ?? "")) {
        return { date: dateOf(cell), source: "TODAY() formula" };
      }
    }
  }
  const fromTab = dateInText(ws.name);
  if (fromTab) return { date: fromTab, source: "tab name" };

  for (let r = 1; r < firstHeader; r += 1) {
    const d = dateInText(rowCaption(ws, r, maxCol));
    if (d) return { date: d, source: "block caption" };
  }
  for (let r = 1; r < firstHeader; r += 1) {
    for (let c = 1; c <= maxCol; c += 1) {
      const d = dateOf(ws.getCell(r, c));
      if (d) return { date: d, source: "cell" };
    }
  }
  return { date: null, source: "not stated" };
}

/** "Terry Stone (03-10-26)" → 2026-10-03. Day first, as the sheets write it. */
function dateInText(text: string): string | null {
  const m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(text ?? "");
  if (!m) return null;
  const [, a, b, c] = m;
  const year = c.length === 2 ? Number(c) + 2000 : Number(c);
  const day = Number(a);
  const month = Number(b);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The currency, from how the money cells are formatted.
 *
 * No reference sheet states a currency in words; every money cell in all four
 * is formatted `[$$-409]`, the US dollar format. That is evidence rather than a
 * declaration, so where it came from is reported alongside it.
 */
function findCurrency(
  ws: ExcelJS.Worksheet,
  blocks: SheetBlock[],
): { code: string | null; source: string } {
  for (const b of blocks) {
    const stated = b.rows.find((r) => r.currency)?.currency;
    if (stated) return { code: stated.toUpperCase().slice(0, 3), source: "a Currency column" };

    const col = b.mapping.customerInvoiceValue ?? b.mapping.statedBalance;
    if (!col) continue;
    for (const row of b.rows) {
      const fmt = ws.getCell(`${col}${row.sourceRow}`).numFmt ?? "";
      if (/\[\$\$-/.test(fmt) || /(^|[^A-Z])\$/.test(fmt)) {
        return { code: "USD", source: "the US dollar number format on the money cells" };
      }
      const m = /\[\$([A-Z]{3})/.exec(fmt);
      if (m) return { code: m[1], source: `the '${m[1]}' number format on the money cells` };
      if (/₹|INR/.test(fmt)) {
        return { code: "INR", source: "the rupee number format on the money cells" };
      }
    }
  }
  return { code: null, source: "not stated anywhere in the sheet" };
}

/** Numbers outside every mapped column — leftover working cells. */
function findStrays(
  ws: ExcelJS.Worksheet,
  maxRow: number,
  maxCol: number,
  used: Set<string>,
): SheetRead["strayCells"] {
  const out: SheetRead["strayCells"] = [];
  for (let r = 1; r <= maxRow; r += 1) {
    for (let c = 1; c <= maxCol; c += 1) {
      if (used.has(`${r},${c}`)) continue;
      const cell = ws.getCell(r, c);
      const v = valueOf(cell);
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      // a bare 1 or 2 is a row number somebody left behind, not a figure
      if (Math.abs(v) < 100) continue;
      out.push({
        ref: `${columnLetter(c)}${r}`,
        value: round2(v).toFixed(2),
        formula: formulaOf(cell),
      });
    }
  }
  return out;
}

/**
 * The lump sum a receipt was allocated from, where the remarks say so.
 *
 * One reference customer pays in lump sums covering several invoices and
 * records it in the remarks: "Received as part of $ 79,054.68" against three
 * invoices of 26,351.56 each. Without capturing that, the allocation cannot be
 * explained — and it is exactly where two sets of records diverge.
 */
export function parseRemittance(remarks: string | null): { ref: string | null; total: number | null } {
  if (!remarks) return { ref: null, total: null };
  const m = /received\s*(?:as\s*part\s*of)?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i.exec(remarks);
  if (!m) return { ref: null, total: null };
  const total = toNumber(m[1]);
  if (total === null) return { ref: null, total: null };
  const part = /as\s*part\s*of/i.test(remarks);
  return {
    ref: `${part ? "Part of" : "Receipt of"} ${total.toFixed(2)}`,
    total,
  };
}
