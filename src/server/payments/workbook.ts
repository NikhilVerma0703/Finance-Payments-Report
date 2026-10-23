/**
 * The downloadable report workbook.
 *
 * Built from the same worked-out invoices every screen shows, for exactly the
 * records the filters selected, so a download is never a different set of
 * figures from what was on screen. It carries the underlying data rather than
 * the visible columns: every invoice field, every receipt (side by side on the
 * invoice row, and one per row on a sheet of their own), every credit and debit
 * note, customer-wise and ageing summaries, and a sheet saying when it was made,
 * what was filtered and how each figure is calculated.
 */
import "server-only";

import ExcelJS from "exceljs";

import { ageingSummary, ageingOrder } from "@/lib/payments/ageing";
import { STATUS_LABELS, STATUS_TONE, type TrackedInvoice, type TrackingParams } from "@/lib/payments/record";
import { STANDING_LABELS } from "@/lib/payments/standing";
import { BASIS_LABELS } from "@/lib/payments/terms";
import { round2 } from "@/lib/text";
import { HOME_CURRENCY, toHome } from "@/lib/money";
import { describeFilters, summarise, type TrackingFilters } from "@/server/payments/query";

type Kind = "text" | "date" | "money" | "home" | "rate" | "int" | "pct" | "status";

interface Column {
  key: string;
  label: string;
  kind: Kind;
  /** The heading over a run of columns. */
  group: string;
}

type Value = string | number | null;
type Row = Record<string, Value> & { __currency?: Value; __status?: Value };

const BRAND = "FF1F3A5F";
const GROUP_FILL = "FFE4EBF3";
const TOTAL_FILL = "FFF2F6FB";
const THIN = { style: "thin" as const, color: { argb: "FFD5DEE8" } };

/** A money format in the currency's own symbol and grouping. */
export function moneyFormat(currency: string | null | undefined): string {
  const c = (currency ?? "").toUpperCase();
  if (c === "INR") {
    // lakh/crore grouping: 1,00,000 rather than 100,000
    return '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"#,##0.00';
  }
  const symbols: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" };
  if (symbols[c]) return `"${symbols[c]}"#,##0.00`;
  if (/^[A-Z]{3}$/.test(c)) return `#,##0.00" ${c}"`;
  return "#,##0.00";
}

const STATUS_FILL: Record<string, string> = {
  ok: "FFE7F6EC",
  warn: "FFFFF4D6",
  bad: "FFFDE7E7",
  info: "FFEAF2FB",
  mute: "FFF1F3F6",
};

function excelDate(iso: string | null | undefined): Date | null {
  return iso ? new Date(`${iso}T00:00:00.000Z`) : null;
}

/** Write a table: a group-heading row, a heading row, the rows, then totals. */
function writeTable(
  ws: ExcelJS.Worksheet,
  startRow: number,
  columns: Column[],
  rows: Row[],
  totals: Row[] = [],
  freezeColumns = 0,
): void {
  // ---- group headings, merged over their runs
  let c = 1;
  while (c <= columns.length) {
    const group = columns[c - 1].group;
    let end = c;
    while (end < columns.length && columns[end].group === group) end += 1;
    const cell = ws.getCell(startRow, c);
    cell.value = group;
    if (end > c) ws.mergeCells(startRow, c, startRow, end);
    for (let k = c; k <= end; k += 1) {
      const g = ws.getCell(startRow, k);
      g.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_FILL } };
      g.font = { bold: true, size: 9, color: { argb: "FF4A5A6A" } };
      g.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
      g.alignment = { horizontal: "left", vertical: "middle" };
    }
    c = end + 1;
  }

  // ---- column headings
  const head = ws.getRow(startRow + 1);
  columns.forEach((col, i) => {
    const cell = head.getCell(i + 1);
    cell.value = col.label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: alignFor(col.kind) };
    cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  });
  head.height = 32;

  // ---- data
  const write = (data: Row, r: number, total: boolean) => {
    const row = ws.getRow(r);
    columns.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      const v = data[col.key];
      cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
      cell.alignment = { vertical: "top", horizontal: alignFor(col.kind), wrapText: col.kind === "text" };
      if (v === null || v === undefined || v === "") return;
      if (col.kind === "date" && typeof v === "string") {
        cell.value = excelDate(v);
        cell.numFmt = "dd-mmm-yyyy";
      } else if (col.kind === "money" && typeof v === "number") {
        cell.value = v;
        cell.numFmt = moneyFormat((data.__currency as string | null) ?? null);
      } else if (col.kind === "home" && typeof v === "number") {
        cell.value = v;
        cell.numFmt = moneyFormat(HOME_CURRENCY);
      } else if (col.kind === "rate" && typeof v === "number") {
        cell.value = v;
        cell.numFmt = "0.00##";
      } else if (col.kind === "int" && typeof v === "number") {
        cell.value = v;
        cell.numFmt = "0";
      } else if (col.kind === "pct" && typeof v === "number") {
        cell.value = v / 100;
        cell.numFmt = "0.0%";
      } else {
        cell.value = v;
      }
      if (col.kind === "status" && data.__status) {
        const tone = STATUS_FILL[STATUS_TONE[data.__status as keyof typeof STATUS_TONE] ?? "mute"];
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone } };
      }
      if ((col.kind === "money" || col.kind === "home") && typeof v === "number" && v < 0) {
        cell.font = { color: { argb: "FFB02A2A" } };
      }
    });
    if (total) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { ...(cell.font ?? {}), bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
        cell.border = { top: { style: "medium", color: { argb: BRAND } }, left: THIN, bottom: THIN, right: THIN };
      });
    }
  };

  let r = startRow + 2;
  for (const data of rows) write(data, r++, false);
  for (const data of totals) write(data, r++, true);

  if (rows.length) {
    ws.autoFilter = {
      from: { row: startRow + 1, column: 1 },
      to: { row: startRow + 1 + rows.length, column: columns.length },
    };
  }
  ws.views = [{ state: "frozen", xSplit: freezeColumns, ySplit: startRow + 1 }];

  // ---- widths that fit what is in the column
  columns.forEach((col, i) => {
    let width = Math.min(18, col.label.length + 2);
    for (const data of [...rows, ...totals]) {
      const v = data[col.key];
      if (v === null || v === undefined) continue;
      const len =
        col.kind === "date" ? 12 : typeof v === "number" ? String(Math.round(Math.abs(v))).length + 7 : String(v).length;
      width = Math.max(width, len + 2);
    }
    ws.getColumn(i + 1).width = Math.min(col.kind === "text" ? 48 : 22, Math.max(9, width));
  });
}

function alignFor(kind: Kind): "left" | "right" | "center" {
  return kind === "text" || kind === "date" || kind === "status" ? "left" : "right";
}

function titleBlock(ws: ExcelJS.Worksheet, title: string, lines: string[]): number {
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: BRAND } };
  lines.forEach((l, i) => {
    ws.getCell(2 + i, 1).value = l;
    ws.getCell(2 + i, 1).font = { size: 10, color: { argb: "FF4A5A6A" } };
  });
  return 2 + lines.length + 1;
}

/** Totals, one row per currency — two currencies are never added together. */
function currencyTotals(
  rows: TrackedInvoice[],
  first: string,
  build: (list: TrackedInvoice[], currency: string) => Row,
): Row[] {
  const by = new Map<string, TrackedInvoice[]>();
  for (const i of rows) {
    const c = i.currency ?? "—";
    by.set(c, [...(by.get(c) ?? []), i]);
  }
  return [...by.entries()].map(([currency, list]) => ({
    [first]: `Total ${currency} (${list.length} invoice${list.length === 1 ? "" : "s"})`,
    __currency: currency,
    ...build(list, currency),
  }));
}

const sum = (list: TrackedInvoice[], f: (i: TrackedInvoice) => number | null | undefined) =>
  round2(list.reduce((s, i) => s + (f(i) ?? 0), 0));

// ---------------------------------------------------------------------------

export async function buildReportWorkbook(
  rows: TrackedInvoice[],
  args: { today: string; filters: TrackingFilters; params: TrackingParams; title?: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Finance Reports";
  wb.created = new Date();

  const title = args.title ?? "Payment Tracking Report";
  const filterText = describeFilters(args.filters);
  const header = [
    `Generated ${args.today} · ${rows.length} invoice(s)`,
    filterText.length ? `Filters: ${filterText.join(" · ")}` : "Filters: none — every record",
  ];

  // ======================================================== Invoices
  const maxReceipts = Math.max(0, ...rows.map((i) => i.money.receipts.length));
  const columns: Column[] = [
    { key: "slNo", label: "Sl. No.", kind: "int", group: "Invoice" },
    { key: "invoiceNo", label: "Invoice No.", kind: "text", group: "Invoice" },
    { key: "customer", label: "Customer", kind: "text", group: "Invoice" },
    { key: "invoiceDate", label: "Invoice Date", kind: "date", group: "Invoice" },
    { key: "currency", label: "Currency", kind: "text", group: "Invoice" },
    { key: "value", label: "Invoice Value", kind: "money", group: "Invoice" },
    { key: "customsValue", label: "Customs Invoice Value", kind: "money", group: "Invoice" },
    { key: "invoiceRate", label: "Invoice Exchange Rate", kind: "rate", group: "Invoice" },
    { key: "homeValue", label: `Invoice Value (${HOME_CURRENCY})`, kind: "home", group: "Invoice" },

    { key: "consignee", label: "Consignee", kind: "text", group: "Parties" },
    { key: "notifyParty", label: "Notify Party", kind: "text", group: "Parties" },
    { key: "country", label: "Country", kind: "text", group: "Parties" },

    { key: "paymentTerms", label: "Payment Terms", kind: "text", group: "Payment terms & ageing" },
    { key: "dueDate", label: "Due Date", kind: "date", group: "Payment terms & ageing" },
    { key: "overdueDate", label: "Overdue Date", kind: "date", group: "Payment terms & ageing" },
    { key: "overdueDays", label: "Overdue Days", kind: "int", group: "Payment terms & ageing" },
    { key: "invoiceAge", label: "Invoice Age (days)", kind: "int", group: "Payment terms & ageing" },
    { key: "ageing", label: "Ageing", kind: "text", group: "Payment terms & ageing" },
    { key: "status", label: "Payment Status", kind: "status", group: "Payment terms & ageing" },

    { key: "receiptCount", label: "Receipts", kind: "int", group: "Collections & balance" },
    { key: "received", label: "Total Received", kind: "money", group: "Collections & balance" },
    { key: "homeReceived", label: `Total Received (${HOME_CURRENCY})`, kind: "home", group: "Collections & balance" },
    { key: "forex", label: `Forex Gain/Loss (${HOME_CURRENCY})`, kind: "home", group: "Collections & balance" },
    { key: "cn", label: "Credit Notes (CN)", kind: "money", group: "Collections & balance" },
    { key: "dn", label: "Debit Notes (DN)", kind: "money", group: "Collections & balance" },
    { key: "outstanding", label: "Outstanding", kind: "money", group: "Collections & balance" },
    { key: "homeOutstanding", label: `Outstanding (${HOME_CURRENCY})`, kind: "home", group: "Collections & balance" },
    { key: "pastDue", label: "Of Which Past Due", kind: "money", group: "Collections & balance" },
    { key: "books", label: "Balance as per Books", kind: "money", group: "Collections & balance" },
    { key: "booksDiff", label: "Difference (Calculated − Books)", kind: "money", group: "Collections & balance" },
  ];
  for (let n = 1; n <= maxReceipts; n += 1) {
    const g = `Receipt ${n}`;
    columns.push(
      { key: `r${n}Date`, label: `Receipt ${n} Date`, kind: "date", group: g },
      { key: `r${n}Amount`, label: `Receipt ${n} Amount`, kind: "money", group: g },
      { key: `r${n}Rate`, label: `Receipt ${n} Exchange Rate`, kind: "rate", group: g },
      { key: `r${n}Diff`, label: `Receipt ${n} Rate Difference`, kind: "rate", group: g },
      { key: `r${n}Forex`, label: `Receipt ${n} Forex G/L (${HOME_CURRENCY})`, kind: "home", group: g },
      { key: `r${n}Ref`, label: `Receipt ${n} Bank Ref.`, kind: "text", group: g },
    );
  }
  columns.push(
    { key: "piNo", label: "PI No.", kind: "text", group: "Shipping" },
    { key: "poNo", label: "PO No.", kind: "text", group: "Shipping" },
    { key: "sbNo", label: "Shipping Bill No.", kind: "text", group: "Shipping" },
    { key: "sbDate", label: "Shipping Bill Date", kind: "date", group: "Shipping" },
    { key: "blNo", label: "BL No.", kind: "text", group: "Shipping" },
    { key: "blDate", label: "BL Date", kind: "date", group: "Shipping" },
    { key: "containerNo", label: "Container No.", kind: "text", group: "Shipping" },
    { key: "eta", label: "ETA", kind: "date", group: "Shipping" },
    { key: "docsPresented", label: "Documents Presented", kind: "date", group: "Shipping" },
    { key: "remarks", label: "Remarks", kind: "text", group: "Remarks" },
    { key: "followUp", label: "Follow-up Notes", kind: "text", group: "Remarks" },
    { key: "attention", label: "Needs Attention", kind: "text", group: "Remarks" },
    { key: "why", label: "Why", kind: "text", group: "Remarks" },
  );

  const invoiceRows: Row[] = rows.map((i, index) => {
    const m = i.money;
    const out: Row = {
      __currency: i.currency,
      __status: i.status,
      slNo: index + 1,
      invoiceNo: i.invoiceNo,
      customer: i.customerName,
      invoiceDate: i.invoiceDate,
      currency: i.currency,
      value: i.customerInvoiceValue,
      customsValue: i.customsInvoiceValue,
      invoiceRate: i.exchangeRate,
      homeValue: m.homeInvoiceValue,
      consignee: i.consignee,
      notifyParty: i.notifyParty,
      country: i.country,
      paymentTerms: i.paymentTerms,
      dueDate: i.schedule.dueDate,
      overdueDate: i.overdueSince,
      overdueDays: i.overdueDays,
      invoiceAge: i.invoiceAge,
      ageing: i.ageing,
      status: STATUS_LABELS[i.status],
      receiptCount: m.receiptCount,
      received: m.totalReceived,
      homeReceived: m.homeReceived,
      forex: m.totalForexGainLoss,
      cn: m.creditNotes || null,
      dn: m.debitNotes || null,
      outstanding: m.calculatedOutstanding,
      homeOutstanding: toHome(m.calculatedOutstanding, i.exchangeRate),
      pastDue: i.schedule.overdueAmount || null,
      books: m.booksBalance,
      booksDiff: m.booksDifference,
      piNo: i.piNo,
      poNo: i.poNo,
      sbNo: i.shippingBillNo,
      sbDate: i.shippingBillDate,
      blNo: i.blNo,
      blDate: i.blDate,
      containerNo: i.containerNo,
      eta: i.eta,
      docsPresented: i.docsPresentedDate,
      remarks: i.remarks,
      followUp: i.followUpNotes,
      attention: i.needsAttention ? "Yes" : "No",
      why: i.attentionReasons.join("; ") || null,
    };
    m.receipts.forEach((r, k) => {
      const n = k + 1;
      out[`r${n}Date`] = r.receiptDate;
      out[`r${n}Amount`] = r.amountFcy;
      out[`r${n}Rate`] = r.exchangeRate;
      out[`r${n}Diff`] = r.rateDifference;
      out[`r${n}Forex`] = r.forexGainLoss;
      out[`r${n}Ref`] = r.bankRef;
    });
    return out;
  });

  const invoiceTotals = currencyTotals(rows, "invoiceNo", (list, currency) => ({
    currency,
    value: sum(list, (i) => i.customerInvoiceValue),
    receiptCount: list.reduce((s, i) => s + i.money.receiptCount, 0),
    received: sum(list, (i) => i.money.totalReceived),
    forex: sum(list, (i) => i.money.totalForexGainLoss),
    cn: sum(list, (i) => i.money.creditNotes),
    dn: sum(list, (i) => i.money.debitNotes),
    outstanding: sum(list, (i) => i.money.calculatedOutstanding),
    pastDue: sum(list, (i) => i.schedule.overdueAmount),
  }));

  const ws = wb.addWorksheet("Invoices", { properties: { tabColor: { argb: BRAND } } });
  const start = titleBlock(ws, title, header);
  writeTable(ws, start, columns, invoiceRows, invoiceTotals, 3);

  // ======================================================== Receipts
  const rc: Column[] = [
    { key: "customer", label: "Customer", kind: "text", group: "Invoice" },
    { key: "invoiceNo", label: "Invoice No.", kind: "text", group: "Invoice" },
    { key: "invoiceDate", label: "Invoice Date", kind: "date", group: "Invoice" },
    { key: "currency", label: "Currency", kind: "text", group: "Invoice" },
    { key: "invoiceRate", label: "Invoice Exchange Rate", kind: "rate", group: "Invoice" },
    { key: "seq", label: "Receipt No.", kind: "int", group: "Receipt" },
    { key: "date", label: "Receipt Date", kind: "date", group: "Receipt" },
    { key: "amount", label: "Amount (FCY)", kind: "money", group: "Receipt" },
    { key: "rate", label: "Receipt Exchange Rate", kind: "rate", group: "Receipt" },
    { key: "diff", label: "Exchange Rate Difference", kind: "rate", group: "Receipt" },
    { key: "forex", label: `Forex Gain/Loss (${HOME_CURRENCY})`, kind: "home", group: "Receipt" },
    { key: "home", label: `Amount (${HOME_CURRENCY})`, kind: "home", group: "Receipt" },
    { key: "ref", label: "Bank Reference", kind: "text", group: "Receipt" },
    { key: "remarks", label: "Remarks", kind: "text", group: "Receipt" },
  ];
  const receiptRows: Row[] = rows.flatMap((i) =>
    i.money.receipts.map((r) => ({
      __currency: i.currency,
      customer: i.customerName,
      invoiceNo: i.invoiceNo,
      invoiceDate: i.invoiceDate,
      currency: i.currency,
      invoiceRate: i.exchangeRate,
      seq: r.seq,
      date: r.receiptDate,
      amount: r.amountFcy,
      rate: r.exchangeRate,
      diff: r.rateDifference,
      forex: r.forexGainLoss,
      home: r.homeValue,
      ref: r.bankRef,
      remarks: r.remarks ?? r.note,
    })),
  );
  const wsR = wb.addWorksheet("Receipts");
  writeTable(
    wsR,
    titleBlock(wsR, "Receipts", [`${receiptRows.length} receipt(s) against the invoices in this report`]),
    rc,
    receiptRows,
    currencyTotals(
      rows.filter((i) => i.money.receipts.length),
      "customer",
      (list, currency) => ({
        currency,
        amount: sum(list, (i) => i.money.totalReceived),
        forex: sum(list, (i) => i.money.totalForexGainLoss),
      }),
    ),
    2,
  );

  // ======================================================== Credit & debit notes
  const nc: Column[] = [
    { key: "customer", label: "Customer", kind: "text", group: "Invoice" },
    { key: "invoiceNo", label: "Invoice No.", kind: "text", group: "Invoice" },
    { key: "currency", label: "Currency", kind: "text", group: "Invoice" },
    { key: "type", label: "Type", kind: "text", group: "Note" },
    { key: "noteNo", label: "Note No.", kind: "text", group: "Note" },
    { key: "noteDate", label: "Note Date", kind: "date", group: "Note" },
    { key: "amount", label: "Amount", kind: "money", group: "Note" },
    { key: "reason", label: "Reason", kind: "text", group: "Note" },
  ];
  const noteRows: Row[] = rows.flatMap((i) =>
    i.notes.map((n) => ({
      __currency: i.currency,
      customer: i.customerName,
      invoiceNo: i.invoiceNo,
      currency: i.currency,
      type: n.noteType === "DEBIT" ? "Debit note (DN)" : "Credit note (CN)",
      noteNo: n.noteNo ?? null,
      noteDate: n.noteDate ?? null,
      amount: n.amount ?? null,
      reason: n.reason ?? null,
    })),
  );
  const wsN = wb.addWorksheet("CN & DN");
  writeTable(
    wsN,
    titleBlock(wsN, "Credit and debit notes", [
      noteRows.length ? `${noteRows.length} note(s)` : "No credit or debit notes against these invoices.",
    ]),
    nc,
    noteRows,
    [],
    2,
  );

  // ======================================================== Customer summary
  const order = ageingOrder(args.params.ageingBuckets);
  // the same columns, in the same order and words, as the screen's table
  const cc: Column[] = [
    { key: "sno", label: "S. No.", kind: "int", group: "Customer" },
    { key: "customer", label: "Customer", kind: "text", group: "Customer" },
    { key: "currency", label: "Currency", kind: "text", group: "Customer" },
    { key: "invoices", label: "Total Invoices", kind: "int", group: "Totals" },
    { key: "value", label: "Invoice Value", kind: "money", group: "Totals" },
    { key: "received", label: "Total Received", kind: "money", group: "Totals" },
    { key: "collected", label: "Collected %", kind: "pct", group: "Totals" },
    { key: "cn", label: "CN", kind: "money", group: "Totals" },
    { key: "dn", label: "DN", kind: "money", group: "Totals" },
    { key: "outstanding", label: "Outstanding Balance", kind: "money", group: "Totals" },
    { key: "overdue", label: "Overdue Amount", kind: "money", group: "Totals" },
    { key: "status", label: "Payment Status", kind: "text", group: "Totals" },
    { key: "nil", label: "Nothing Received (invoices)", kind: "int", group: "Totals" },
    ...order.map((label, i) => ({
      key: `a${i}`,
      label,
      kind: "money" as const,
      group: "Outstanding by ageing",
    })),
  ];
  const custRows: Row[] = summarise(rows).map((c, n) => {
    const list = rows.filter(
      (i) => (i.customerId ?? null) === c.id && (i.currency ?? "—") === c.currency,
    );
    const a = ageingSummary(list, args.params.ageingBuckets);
    const out: Row = {
      __currency: c.currency,
      sno: n + 1,
      customer: c.name,
      currency: c.currency,
      invoices: c.invoices,
      value: c.invoiceValue,
      received: c.received,
      collected: c.collectedPct,
      cn: sum(list, (i) => i.money.creditNotes),
      dn: sum(list, (i) => i.money.debitNotes),
      outstanding: c.outstanding,
      overdue: c.overdue,
      status: STANDING_LABELS[c.paymentStatus],
      nil: a.nothingReceived.count,
    };
    a.buckets.forEach((b, i) => (out[`a${i}`] = b.amount));
    return out;
  });
  const custTotals = currencyTotals(rows, "customer", (list, currency) => {
    const a = ageingSummary(list, args.params.ageingBuckets);
    const value = sum(list, (i) => i.customerInvoiceValue);
    const received = sum(list, (i) => i.money.totalReceived);
    const out: Row = {
      currency,
      invoices: list.length,
      value,
      received,
      collected: value > 0 ? Math.round((received / value) * 1000) / 10 : 0,
      cn: sum(list, (i) => i.money.creditNotes),
      dn: sum(list, (i) => i.money.debitNotes),
      outstanding: sum(list, (i) => i.money.calculatedOutstanding),
      overdue: sum(list, (i) => i.schedule.overdueAmount),
      nil: a.nothingReceived.count,
    };
    a.buckets.forEach((b, i) => (out[`a${i}`] = b.amount));
    return out;
  });
  const wsC = wb.addWorksheet("Customer Summary");
  writeTable(
    wsC,
    titleBlock(wsC, "Customer-wise summary", ["One row per customer and currency"]),
    cc,
    custRows,
    custTotals,
    2,
  );

  // ======================================================== Ageing summary
  const ac: Column[] = [
    { key: "currency", label: "Currency", kind: "text", group: "Ageing" },
    { key: "bucket", label: "Category", kind: "text", group: "Ageing" },
    { key: "count", label: "Invoices", kind: "int", group: "Ageing" },
    { key: "amount", label: "Outstanding", kind: "money", group: "Ageing" },
    { key: "share", label: "% of Outstanding", kind: "pct", group: "Ageing" },
  ];
  const ageRows: Row[] = [];
  const ageTotals: Row[] = [];
  const currencies = [...new Set(rows.map((i) => i.currency ?? "—"))];
  for (const currency of currencies) {
    const a = ageingSummary(
      rows.filter((i) => (i.currency ?? "—") === currency),
      args.params.ageingBuckets,
    );
    for (const b of a.buckets) {
      ageRows.push({
        __currency: currency,
        currency,
        bucket: b.label,
        count: b.count,
        amount: b.amount,
        share: a.totalOutstanding > 0 ? round2((b.amount / a.totalOutstanding) * 100) : 0,
      });
    }
    ageTotals.push({
      __currency: currency,
      currency,
      bucket: `Total outstanding ${currency}`,
      count: a.openInvoices,
      amount: a.totalOutstanding,
      share: a.totalOutstanding > 0 ? 100 : 0,
    });
    ageRows.push({
      __currency: currency,
      currency,
      bucket: "Nothing received (also counted above)",
      count: a.nothingReceived.count,
      amount: a.nothingReceived.amount,
      share:
        a.totalOutstanding > 0 ? round2((a.nothingReceived.amount / a.totalOutstanding) * 100) : 0,
    });
  }
  const wsA = wb.addWorksheet("Ageing Summary");
  writeTable(
    wsA,
    titleBlock(wsA, "Ageing of the outstanding balance", [
      "Each open invoice is in exactly one ageing category. 'Nothing received' overlaps them and is not added in.",
    ]),
    ac,
    ageRows,
    ageTotals,
    0,
  );

  // ======================================================== About
  const wsI = wb.addWorksheet("About This Report");
  const about: Array<[string, string]> = [
    ["Report", title],
    ["Generated", args.today],
    ["Invoices", String(rows.length)],
    ["Filters", filterText.length ? filterText.join(" · ") : "None — every record"],
    ["Outstanding", "Invoice value − total received − credit notes + debit notes"],
    ["Total received", "Sum of every receipt's amount in the invoice currency"],
    ["Exchange rates", `${HOME_CURRENCY} per one unit of the invoice currency`],
    ["Rate difference", "Receipt exchange rate − invoice exchange rate"],
    ["Forex gain/loss", `Rate difference × receipt amount, in ${HOME_CURRENCY}. Positive is a gain.`],
    [`Values in ${HOME_CURRENCY}`, "Each invoice at its own invoice exchange rate; blank where no rate is recorded"],
    ["Due date", "From the payment terms and the date they count from (BL date, invoice date, documents presented, ETA, shipping bill date); an entered due date is used as entered"],
    ["Overdue date", "The day after the due date, for an invoice still owing money past it"],
    ["Overdue days", `Days past the due date, counted to ${args.today}`],
    ["Ageing", `${order.join(", ")} — by overdue days, for invoices with money outstanding`],
    ["Of which past due", "For split terms, only the portions whose own due date has passed"],
    ["Balance as per books", "Entered from the books; never part of the calculation. Difference = calculated outstanding − books balance"],
    ["Bases", Object.values(BASIS_LABELS).join(", ")],
    ["Totals", "Given per currency; amounts in different currencies are never added together"],
  ];
  wsI.getColumn(1).width = 24;
  wsI.getColumn(2).width = 110;
  about.forEach(([k, v], i) => {
    const r = wsI.getRow(i + 1);
    r.getCell(1).value = k;
    r.getCell(1).font = { bold: true, color: { argb: BRAND } };
    r.getCell(2).value = v;
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/** The invoices sheet as CSV, for a system that cannot read a workbook. */
export function buildInvoicesCsv(rows: TrackedInvoice[]): string {
  const head = [
    "Invoice No.", "Customer", "Invoice Date", "Currency", "Invoice Value", "Invoice Exchange Rate",
    "Payment Terms", "Due Date", "Overdue Date", "Overdue Days", "Ageing", "Status", "Receipts",
    "Total Received", "CN", "DN", "Outstanding", "PO No.", "BL No.", "BL Date", "Remarks",
  ];
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((i) =>
    [
      i.invoiceNo, i.customerName, i.invoiceDate, i.currency, i.customerInvoiceValue, i.exchangeRate,
      i.paymentTerms, i.schedule.dueDate, i.overdueSince, i.overdueDays, i.ageing, STATUS_LABELS[i.status],
      i.money.receiptCount, i.money.totalReceived, i.money.creditNotes, i.money.debitNotes,
      i.money.calculatedOutstanding, i.poNo, i.blNo, i.blDate, i.remarks,
    ]
      .map(esc)
      .join(","),
  );
  return `﻿${[head.join(","), ...lines].join("\r\n")}\r\n`;
}

export function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "export";
}
