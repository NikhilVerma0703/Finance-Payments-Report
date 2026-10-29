/**
 * The master table.
 *
 * Forty-odd columns is a lot, and the way it stays readable is a two-row header
 * that groups them — Invoice, Parties, Terms & dates, Receipts, Balance,
 * Shipping, Tracking — with a rule between the groups. A reader looking for a
 * BL number can find the Shipping block and stop reading the rest.
 *
 * Two further things keep it usable:
 *
 *   - the first three columns are **sticky**, so the invoice number, customer
 *     and date stay visible while the table scrolls sideways;
 *   - every invoice has a thin second row carrying what needs attention, which
 *     opens into the payment milestones. It is a plain `<details>` element, so
 *     there is no client component and nothing to hydrate — two hundred rows
 *     cost the browser nothing.
 *
 * Column headings link to themselves with a sort parameter, so sorting is a
 * URL rather than state: it survives a reload and can be shared.
 */
import Link from "next/link";
import { cloneElement, type ReactElement } from "react";

import { BASIS_LABELS } from "@/lib/payments/terms";
import { ROUTES } from "@/lib/routes";
import type { TrackedInvoice } from "@/lib/payments/record";
import type { InvoiceGroup, SortKey } from "@/server/payments/query";
import { day, homeMoney, money, rate, StatusChip, TONE_CLASS } from "./bits";
import { SelectAllBox } from "./BulkBar";
import { ColumnChooser } from "./ColumnChooser";

/** The column groups, and the columns inside each. */
const GROUPS: Array<{
  title: string;
  columns: Array<{ label: string; sort?: SortKey; align?: "right"; hint?: string }>;
}> = [
  {
    title: "Invoice",
    columns: [
      { label: "#" },
      { label: "Invoice No.", sort: "invoiceNo" },
      { label: "Customer", sort: "customer" },
      { label: "Invoice Date", sort: "invoiceDate" },
      { label: "Curr." },
      { label: "Invoice Value", sort: "invoiceValue", align: "right" },
      { label: "Customs / Books", align: "right", hint: "Customs invoice value, or the value as per books" },
      { label: "Ex. Rate", align: "right", hint: "Home currency per one unit of foreign currency" },
      { label: "Home Value", align: "right", hint: "Invoice value × invoice exchange rate" },
    ],
  },
  {
    title: "Parties",
    columns: [
      { label: "Consignee" },
      { label: "Notify Party" },
      { label: "Country" },
    ],
  },
  {
    title: "Terms & dates",
    columns: [
      { label: "Payment Terms" },
      { label: "Due Date", sort: "dueDate" },
      { label: "Basis", hint: "Which date the due date was counted from" },
      { label: "Overdue Days", sort: "overdueDays", align: "right" },
      { label: "Age", sort: "invoiceAge", align: "right", hint: "Days since the invoice date" },
      { label: "Ageing" },
    ],
  },
  {
    title: "Receipts",
    columns: [
      { label: "Receipts", align: "right", hint: "How many receipts are recorded" },
      { label: "Received", sort: "received", align: "right" },
      { label: "Last Receipt" },
      { label: "Collected", sort: "collectedPct", align: "right" },
      { label: "Forex G/L", sort: "forex", align: "right", hint: "Σ (receipt rate − invoice rate) × receipt amount" },
    ],
  },
  {
    title: "Balance",
    columns: [
      { label: "CN", align: "right" },
      { label: "DN", align: "right" },
      { label: "Outstanding", sort: "outstanding", align: "right", hint: "Invoice value − receipts − CN + DN" },
      { label: "As per Books", align: "right", hint: "Entered from the books; never part of the calculation" },
      { label: "Difference", align: "right", hint: "Calculated outstanding − balance as per books" },
      { label: "Status", sort: "status" },
    ],
  },
  {
    title: "Shipping",
    columns: [
      { label: "PI No." },
      { label: "PO No.", sort: "poNo" },
      { label: "S/Bill No." },
      { label: "S/Bill Date" },
      { label: "BL No." },
      { label: "BL Date", sort: "blDate" },
      { label: "Container" },
      { label: "ETA" },
    ],
  },
  {
    title: "Tracking",
    columns: [
      { label: "Remarks" },
      { label: "Follow-up" },
      { label: "Source" },
    ],
  },
];

/** A column's key, from its heading: "Invoice Value" → invoice-value. */
const colKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Every column, flat, in GROUPS order, with its group. */
const FLAT = GROUPS.flatMap((g, gi) => g.columns.map((c, ci) => ({ ...c, key: colKey(c.label), group: gi, first: ci === 0 })));

/** The # and the invoice number are always shown. */
const ALWAYS = new Set(["", "invoice-no"]);

/** The cookie a column choice is remembered in (ColumnChooser writes it). */
export const COLUMNS_COOKIE = "pt_cols";

/**
 * The columns chosen one by one (owner, 25 Oct 2026: "Allow users to choose
 * which columns to display"): ?col=… when the URL says, else the choice
 * remembered in this browser (the pt_cols cookie, dot-separated), else none —
 * every column — and none for ?col=all, "Every column". Unknown keys are
 * dropped.
 */
export function columnsFrom(param: string | string[] | undefined, remembered: string | undefined): string[] {
  const raw = param === undefined ? (remembered ?? "").split(".") : Array.isArray(param) ? param : [param];
  if (raw.includes("all")) return [];
  const known = new Set(FLAT.map((c) => c.key));
  return [...new Set(raw.filter((k) => known.has(k) && !ALWAYS.has(k)))];
}

/** The query a table's links keep, with the columns chosen. */
export function withColumns(query: string, chosen: string[]): string {
  const p = new URLSearchParams(query);
  p.delete("col");
  for (const key of chosen) p.append("col", key);
  return p.toString();
}

function sortHref(
  basePath: string,
  query: string,
  key: SortKey,
  current: string | undefined,
  dir: string | undefined,
) {
  const p = new URLSearchParams(query);
  p.set("sort", key);
  p.set("dir", current === key && dir !== "asc" ? "asc" : "desc");
  return `${basePath}?${p.toString()}`;
}

export function MasterTable({
  groups,
  query,
  sort,
  dir,
  showHeadings,
  basePath = ROUTES.dashboard,
  chosen = [],
  select,
  chooser = false,
}: {
  groups: InvoiceGroup[];
  query: string;
  sort?: string;
  dir?: string;
  showHeadings: boolean;
  /** The page the sort links return to, with the same filters. */
  basePath?: string;
  /** Columns chosen one by one (columnsFrom); none means every column. */
  chosen?: string[];
  /** The id of the form a BulkBar draws: each row gets a tick box in it. */
  select?: string;
  /** Draw the "Choose columns" control above the table. */
  chooser?: boolean;
}) {
  const picked = new Set(chosen);
  const shown = FLAT.map((c, n) => ({ c, n })).filter(({ c }) => !chosen.length || ALWAYS.has(c.key) || picked.has(c.key)).map(({ n }) => n);
  // a rule before the first shown column of each group, but the first group
  const edges = new Set(shown.filter((n, i) => i > 0 && FLAT[n].group !== FLAT[shown[i - 1]].group));
  const blocks = GROUPS.map((g, gi) => ({ title: g.title, span: shown.filter((n) => FLAT[n].group === gi).length })).filter((b) => b.span > 0);
  const keepForChooser = [...new URLSearchParams(query).entries()].filter(([k]) => k !== "col");
  const choices = GROUPS.map((g) => ({
    title: g.title,
    columns: g.columns
      .map((c) => ({ key: colKey(c.label), label: c.label }))
      .filter((c) => !ALWAYS.has(c.key))
      .map((c) => ({ ...c, shown: !chosen.length || picked.has(c.key) })),
  }));
  const cur = (g: InvoiceGroup) => (g.totals.currency === "mixed" ? null : g.totals.currency);
  /** What a group's total row says under each column. */
  const foot = (g: InvoiceGroup, key: string): React.ReactNode => {
    if (key === "invoice-value") return money(g.totals.invoiceValue, cur(g));
    if (key === "received") return money(g.totals.received, cur(g));
    if (key === "collected") return `${g.totals.collectedPct}%`;
    if (key === "outstanding") return money(g.totals.outstanding, cur(g));
    if (key === "status")
      return g.totals.overdue > 0.01 ? (
        <span className="text-[11px] font-normal text-[var(--color-bad-fg)]">{money(g.totals.overdue, cur(g))} past due</span>
      ) : null;
    if (key === "source")
      return g.totals.dueDatesKnown < g.totals.invoices ? (
        <span className="text-[11px] font-normal text-[var(--color-ink-3)]">
          due dates: {g.totals.dueDatesKnown}/{g.totals.invoices}
        </span>
      ) : null;
    return null;
  };

  return (
    <div className="space-y-4">
      {chooser && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <ColumnChooser cookieName={COLUMNS_COOKIE} basePath={basePath} keep={keepForChooser} groups={choices} chosen={chosen} />
          {chosen.length > 0 && (
            <span className="text-[var(--color-ink-3)]">
              {shown.length} of {FLAT.length} columns shown
            </span>
          )}
        </div>
      )}
      {groups.map((group) => (
        <section key={group.key} className="card">
          {showHeadings && (
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                {group.customerId ? (
                  // the customer's name is the way in to adjusting its payments:
                  // it opens the customer at "Payments and notes on account"
                  <h2 className="mb-1">
                    <Link
                      href={`${ROUTES.customer(group.customerId)}#on-account`}
                      className="group inline-flex flex-wrap items-baseline gap-x-2 rounded-lg bg-[#e6f4f2] px-3 py-1.5 text-[17px] font-bold text-[var(--color-accent)] ring-1 ring-[#b9dfd9] transition-colors hover:bg-[#d3ece8]"
                      title="Adjust payments: book a payment or a credit/debit note against this customer, and attribute it to invoices"
                    >
                      {group.label}
                      <span className="text-[11px] font-semibold text-[var(--color-ink-2)] group-hover:text-[var(--color-accent)]">
                        Adjust payments →
                      </span>
                    </Link>
                  </h2>
                ) : (
                  <h2 className="card-title mb-0.5">{group.label}</h2>
                )}
                <p className="text-[11px] text-[var(--color-ink-3)]">{group.sub}</p>
              </div>
              {group.customerId && (
                <div className="flex flex-wrap items-center gap-2">
                  {/* the customer's invoices and what each is missing, with the
                      form to fill it in — Upload Sheet's Edit, a size under the name.
                      That list is folded at the foot of the page (29 Oct 2026);
                      ?open=missing unfolds it. */}
                  <Link
                    href={`${ROUTES.customer(group.customerId)}?open=missing#missing`}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#b9dfd9] bg-white px-2.5 py-1 text-[13px] font-semibold text-[var(--color-accent)] hover:bg-[#e6f4f2]"
                    title="Edit / add extra information: every invoice of this customer, what each is missing, and the form to fill it in"
                  >
                    <span aria-hidden>✎</span> Edit / Add extra information
                  </Link>
                  <Link href={ROUTES.customer(group.customerId)} className="btn-ghost btn-sm">
                    Open customer
                  </Link>
                </div>
              )}
            </div>
          )}

          <div className="tablewrap">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[#e4ebf3] text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-2)]">
                  {blocks.map((g, i) => (
                    <th
                      key={g.title}
                      colSpan={g.span + (i === 0 && select ? 1 : 0)}
                      className={`px-2 py-1.5 ${i > 0 ? "border-l-2 border-white" : ""}`}
                    >
                      {g.title}
                    </th>
                  ))}
                </tr>
                <tr className="bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
                  {select && (
                    <th className="px-2 py-2 text-center">
                      <SelectAllBox formId={select} />
                    </th>
                  )}
                  {shown.map((n) => {
                    const c = FLAT[n];
                    return (
                      <th
                        key={c.key || "no"}
                        title={c.hint}
                        className={`whitespace-nowrap px-2 py-2 font-medium ${edges.has(n) ? "border-l-2 border-[var(--color-line)]" : ""} ${
                          c.align === "right" ? "text-right" : ""
                        }`}
                      >
                        {c.sort ? (
                          <Link href={sortHref(basePath, query, c.sort, sort, dir)} className="hover:underline">
                            {c.label}
                            {sort === c.sort && (dir === "asc" ? " ▲" : " ▼")}
                          </Link>
                        ) : (
                          c.label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {group.rows.map((invoice, index) => (
                  <Row key={invoice.id} invoice={invoice} index={index + 1} shown={shown} edges={edges} select={select} />
                ))}
              </tbody>

              <tfoot>
                <tr className="border-t-2 border-[var(--color-line)] bg-[#f7f9fc] font-semibold">
                  <td className="whitespace-nowrap px-2 py-2" colSpan={2 + (select ? 1 : 0)}>
                    {group.totals.invoices} invoice(s)
                    {group.totals.currency === "mixed" && " — mixed currencies"}
                  </td>
                  {shown.slice(2).map((n) => (
                    <td key={n} className={`whitespace-nowrap px-2 py-2 ${FLAT[n].align === "right" ? "text-right tabular-nums" : ""}`}>
                      {foot(group, FLAT[n].key)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          {group.totals.currency === "mixed" && (
            <p className="mt-2 text-[11px] text-[var(--color-bad-fg)]">
              Mixed currencies — the totals above cannot be used. Filter by currency.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

/** Every cell of an invoice's row, in GROUPS order (one per column). */
function cellsOf(invoice: TrackedInvoice, index: number): ReactElement<{ className?: string }>[] {
  const m = invoice.money;
  const s = invoice.schedule;
  const late = (invoice.overdueDays ?? 0) > 0;
  const cell = "whitespace-nowrap px-2 py-2";
  return [
    <td key="c0" className={`${cell} text-[var(--color-ink-3)] tabular-nums`}>{index}</td>,
    <td key="c1" className={`${cell} font-medium`}>
              <Link href={ROUTES.invoice(invoice.id)} className="link">
                {invoice.invoiceNo ?? <span className="italic text-[var(--color-ink-3)]">no number</span>}
              </Link>
            </td>,
    <td key="c2" className={cell}>
              {invoice.customerId ? (
                <Link
                  href={`${ROUTES.customer(invoice.customerId)}#on-account`}
                  className="rounded-md bg-[#e6f4f2] px-1.5 py-0.5 text-[13.5px] font-bold text-[var(--color-accent)] hover:bg-[#d3ece8] hover:underline"
                  title="Adjust this customer's payments"
                >
                  {invoice.customerName}
                </Link>
              ) : (
                <span className="italic text-[var(--color-ink-3)]">no customer</span>
              )}
            </td>,
    <td key="c3" className={cell}>{day(invoice.invoiceDate)}</td>,
    <td key="c4" className={cell}>{invoice.currency ?? "—"}</td>,
    <td key="c5" className={`${cell} text-right tabular-nums`}>{money(invoice.customerInvoiceValue, invoice.currency)}</td>,
    <td key="c6" className={`${cell} text-right tabular-nums text-[var(--color-ink-3)]`}>
              {money(invoice.customsInvoiceValue, invoice.currency)}
            </td>,
    <td key="c7" className={`${cell} text-right tabular-nums`}>{rate(invoice.exchangeRate)}</td>,
    <td key="c8" className={`${cell} text-right tabular-nums text-[var(--color-ink-3)]`}>
              {homeMoney(m.homeInvoiceValue)}
            </td>,
    <td key="c9" className={`px-2 py-2`}>
              <span className="block max-w-[14ch] truncate" title={invoice.consignee ?? undefined}>
                {invoice.consignee ?? "—"}
              </span>
            </td>,
    <td key="c10" className="px-2 py-2">
              <span className="block max-w-[14ch] truncate" title={invoice.notifyParty ?? undefined}>
                {invoice.notifyParty ?? "—"}
              </span>
            </td>,
    <td key="c11" className={cell}>{invoice.country ?? "—"}</td>,
    <td key="c12" className={`px-2 py-2`} title={s.term.raw || "No payment terms recorded"}>
              <span className="block max-w-[18ch] truncate">
                {s.term.raw || <span className="italic text-[var(--color-ink-3)]">none</span>}
              </span>
              {s.milestones.length > 1 && (
                <span className="text-[10px] text-[var(--color-ink-3)]">
                  {s.milestones.length} milestones
                </span>
              )}
            </td>,
    <td key="c13" className={cell} title={s.dueDateNote}>
              {s.dueDate ? (
                <>
                  {day(s.dueDate)}
                  {s.dueDateSource === "entered" && (
                    <div className="text-[10px] text-[var(--color-warn-fg)]">as entered</div>
                  )}
                  {s.dueDateSource === "default" && (
                    <div className="text-[10px] text-[var(--color-warn-fg)]">default — terms give none</div>
                  )}
                </>
              ) : (
                <span className="text-[var(--color-warn-fg)]">needs verification</span>
              )}
            </td>,
    <td key="c14" className={`${cell} text-[10px] text-[var(--color-ink-3)]`}>
              {s.dueDateSource === "calculated" && s.milestones.length
                ? BASIS_LABELS[s.milestones[0].basis]
                : s.dueDateSource === "entered"
                  ? "entered"
                  : s.dueDateSource === "default"
                    ? "invoice date (default)"
                    : "—"}
            </td>,
    <td key="c15"
              className={`${cell} tabular-nums ${late ? "font-semibold text-[var(--color-bad-fg)]" : "text-[var(--color-ink-3)]"}`}
            >
              {invoice.overdueDays === null
                ? "—"
                : late
                  ? `${invoice.overdueDays}d`
                  : `in ${Math.abs(invoice.overdueDays)}d`}
            </td>,
    <td key="c16" className={`${cell} tabular-nums text-[var(--color-ink-3)]`}>
              {invoice.invoiceAge === null ? "—" : `${invoice.invoiceAge}d`}
            </td>,
    <td key="c17" className={cell}>{invoice.ageing}</td>,
    <td key="c18" className={`${cell} text-right tabular-nums`}>{m.receiptCount || "—"}</td>,
    <td key="c19" className={`${cell} text-right tabular-nums`}>
              {m.totalReceived ? money(m.totalReceived, invoice.currency) : "—"}
            </td>,
    <td key="c20" className={cell}>{day(invoice.lastReceiptDate)}</td>,
    <td key="c21" className={`${cell} text-right tabular-nums text-[var(--color-ink-3)]`}>
              {m.collectedPct === null ? "—" : `${m.collectedPct}%`}
            </td>,
    <td key="c22"
              className={`${cell} text-right tabular-nums ${
                m.totalForexGainLoss === null
                  ? "text-[var(--color-ink-3)]"
                  : m.totalForexGainLoss >= 0
                    ? "text-[var(--color-ok-fg)]"
                    : "text-[var(--color-bad-fg)]"
              }`}
              title={m.forexNote ?? undefined}
            >
              {m.totalForexGainLoss === null ? "—" : homeMoney(m.totalForexGainLoss)}
            </td>,
    <td key="c23" className={`${cell} text-right tabular-nums`}>
              {m.creditNotes > 0.01 ? money(m.creditNotes, invoice.currency) : "—"}
            </td>,
    <td key="c24" className={`${cell} text-right tabular-nums`}>
              {m.debitNotes > 0.01 ? money(m.debitNotes, invoice.currency) : "—"}
            </td>,
    <td key="c25" className={`${cell} text-right font-semibold tabular-nums`}>
              {money(m.calculatedOutstanding, invoice.currency)}
              {s.overdueAmount > 0.01 && s.overdueAmount < (m.calculatedOutstanding ?? 0) - 0.01 && (
                <div
                  className="text-[10px] font-normal text-[var(--color-bad-fg)]"
                  title="A split payment term: only this much has actually fallen due."
                >
                  {money(s.overdueAmount, invoice.currency)} due
                </div>
              )}
            </td>,
    <td key="c26" className={`${cell} text-right tabular-nums text-[var(--color-ink-3)]`}>
              {money(m.booksBalance, invoice.currency)}
            </td>,
    <td key="c27"
              className={`${cell} text-right tabular-nums ${
                m.booksDifference !== null && Math.abs(m.booksDifference) > 0.01
                  ? "font-semibold text-[var(--color-bad-fg)]"
                  : "text-[var(--color-ink-3)]"
              }`}
            >
              {money(m.booksDifference, invoice.currency)}
            </td>,
    <td key="c28" className={cell}>
              <StatusChip status={invoice.status} note={invoice.statusNote} />
            </td>,
    <td key="c29" className={`${cell}`}>{invoice.piNo ?? "—"}</td>,
    <td key="c30" className={cell}>{invoice.poNo ?? "—"}</td>,
    <td key="c31" className={cell}>{invoice.shippingBillNo ?? "—"}</td>,
    <td key="c32" className={cell}>{day(invoice.shippingBillDate)}</td>,
    <td key="c33" className={cell}>{invoice.blNo ?? "—"}</td>,
    <td key="c34" className={cell}>{day(invoice.blDate)}</td>,
    <td key="c35" className={cell}>{invoice.containerNo ?? "—"}</td>,
    <td key="c36" className={cell}>{day(invoice.eta)}</td>,
    <td key="c37" className={`px-2 py-2`}>
              <span className="block max-w-[20ch] truncate" title={invoice.remarks ?? undefined}>
                {invoice.remarks ?? "—"}
              </span>
            </td>,
    <td key="c38" className="px-2 py-2">
              <span className="block max-w-[20ch] truncate" title={invoice.followUpNotes ?? undefined}>
                {invoice.followUpNotes ?? "—"}
              </span>
            </td>,
    <td key="c39" className={`${cell} text-[10px] text-[var(--color-ink-3)]`}>
              {invoice.source === "EXCEL" ? "Excel" : "Manual"}
              {invoice.sourceAsOn && <div>as on {day(invoice.sourceAsOn)}</div>}
            </td>
  ];
}

function Row({
  invoice,
  index,
  shown,
  edges,
  select,
}: {
  invoice: TrackedInvoice;
  index: number;
  /** The indexes (in GROUPS order) of the columns shown. */
  shown: number[];
  /** Of those, the ones that open a group, drawn with a rule before them. */
  edges: Set<number>;
  /** The id of the BulkBar's form: the row gets a tick box in it. */
  select?: string;
}) {
  const m = invoice.money;
  const s = invoice.schedule;
  const all = cellsOf(invoice, index);
  const span = shown.length + (select ? 1 : 0);

  return (
    <>
      <tr className="border-t border-[var(--color-line)] align-top">
        {select && (
          <td className="px-2 py-2 text-center">
            <input
              type="checkbox"
              name="id"
              value={invoice.id}
              form={select}
              aria-label={`Select invoice ${invoice.invoiceNo ?? "with no number"}`}
              className="h-4 w-4 accent-[var(--color-brand)]"
            />
          </td>
        )}
        {shown.map((n) =>
          cloneElement(all[n], {
            key: n,
            className: `${all[n].props.className ?? ""}${edges.has(n) ? " border-l-2 border-[var(--color-line)]" : ""}`,
          }),
        )}
      </tr>

      <tr className="border-t border-dashed border-[var(--color-line)]">
        <td colSpan={span} className="p-0">
          <details className="group">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-2 py-1.5 text-[11px] hover:bg-[#f7f9fc]">
              <span className="text-[var(--color-ink-3)] group-open:hidden">▸</span>
              <span className="hidden text-[var(--color-ink-3)] group-open:inline">▾</span>
              {invoice.needsAttention ? (
                <span className={`chip ${TONE_CLASS.warn}`}>{invoice.attentionReasons[0]}</span>
              ) : (
                <span className="text-[var(--color-ink-3)]">Nothing outstanding to chase</span>
              )}
              {invoice.attentionReasons.length > 1 && (
                <span className="text-[var(--color-ink-3)]">
                  +{invoice.attentionReasons.length - 1} more
                </span>
              )}
              <span className="ml-auto text-[var(--color-ink-3)]">
                {s.milestones.length > 1 ? "Payment milestones" : "Details"}
              </span>
            </summary>

            <div className="border-t border-[var(--color-line)] bg-[#fbfcfe] p-3 text-[11px]">
              <div className="grid gap-4 lg:grid-cols-3">
                <div>
                  <h3 className="mb-1 text-[12px] font-semibold">Payment milestones</h3>
                  <p className="mb-1 text-[var(--color-ink-3)]">{s.term.description}</p>
                  {s.milestones.length ? (
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-[10px] uppercase text-[var(--color-ink-3)]">
                          <th className="pr-2">Portion</th>
                          <th className="pr-2 text-right">Amount</th>
                          <th className="pr-2">Due</th>
                          <th className="pr-2 text-right">Outstanding</th>
                          <th>State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.milestones.map((ms) => (
                          <tr key={ms.seq} className="border-t border-dashed border-[var(--color-line)]">
                            <td className="pr-2">{ms.label}</td>
                            <td className="pr-2 text-right tabular-nums">{money(ms.amount, invoice.currency)}</td>
                            <td className="pr-2" title={ms.pending ?? undefined}>
                              {ms.dueDate ? day(ms.dueDate) : "needs verification"}
                            </td>
                            <td className="pr-2 text-right tabular-nums">{money(ms.outstanding, invoice.currency)}</td>
                            <td>{ms.state.replace("_", " ").toLowerCase()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-[var(--color-ink-3)]">{s.dueDateNote}</p>
                  )}
                  {s.term.assumptions.map((a) => (
                    <p key={a} className="mt-1 text-[var(--color-warn-fg)]">
                      {a}
                    </p>
                  ))}
                </div>

                <div>
                  <h3 className="mb-1 text-[12px] font-semibold">Receipts</h3>
                  {m.receipts.length ? (
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-[10px] uppercase text-[var(--color-ink-3)]">
                          <th className="pr-2">#</th>
                          <th className="pr-2">Date</th>
                          <th className="pr-2 text-right">FCY</th>
                          <th className="pr-2 text-right">Rate</th>
                          <th className="pr-2 text-right">Diff.</th>
                          <th className="text-right">Forex</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.receipts.map((r) => (
                          <tr key={r.seq} className="border-t border-dashed border-[var(--color-line)]">
                            <td className="pr-2">{r.seq}</td>
                            <td className="pr-2">{day(r.receiptDate)}</td>
                            <td className="pr-2 text-right tabular-nums">{money(r.amountFcy, invoice.currency)}</td>
                            <td className="pr-2 text-right tabular-nums">{rate(r.exchangeRate)}</td>
                            <td className="pr-2 text-right tabular-nums">{rate(r.rateDifference)}</td>
                            <td
                              className={`text-right tabular-nums ${
                                r.forexGainLoss === null
                                  ? ""
                                  : r.forexGainLoss >= 0
                                    ? "text-[var(--color-ok-fg)]"
                                    : "text-[var(--color-bad-fg)]"
                              }`}
                              title={r.note ?? undefined}
                            >
                              {homeMoney(r.forexGainLoss)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-[var(--color-ink-3)]">No receipts recorded.</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-3">
                    <Link href={ROUTES.invoice(invoice.id)} className="link">
                      Open invoice
                    </Link>
                    <Link href={ROUTES.editInvoice(invoice.id)} className="link">
                      Edit or add information
                    </Link>
                  </div>
                </div>

                <div>
                  <h3 className="mb-1 text-[12px] font-semibold">
                    {invoice.needsAttention ? "Needs attention" : "Position"}
                  </h3>
                  {invoice.attentionReasons.length ? (
                    <ul className="list-disc space-y-0.5 pl-4 text-[var(--color-ink-2)]">
                      {invoice.attentionReasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[var(--color-ink-3)]">{invoice.statusNote}</p>
                  )}
                  {invoice.missingFields.length > 0 && (
                    <>
                      <h3 className="mb-1 mt-2 text-[12px] font-semibold">Not yet recorded</h3>
                      <ul className="list-disc space-y-0.5 pl-4 text-[var(--color-ink-3)]">
                        {invoice.missingFields.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </div>
          </details>
        </td>
      </tr>
    </>
  );
}
