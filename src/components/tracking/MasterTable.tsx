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

import { BASIS_LABELS } from "@/lib/payments/terms";
import { ROUTES } from "@/lib/routes";
import type { TrackedInvoice } from "@/lib/payments/record";
import type { InvoiceGroup, SortKey } from "@/server/payments/query";
import { day, homeMoney, money, rate, StatusChip, TONE_CLASS } from "./bits";

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

const TOTAL_COLUMNS = GROUPS.reduce((s, g) => s + g.columns.length, 0);

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
}: {
  groups: InvoiceGroup[];
  query: string;
  sort?: string;
  dir?: string;
  showHeadings: boolean;
  /** The page the sort links return to, with the same filters. */
  basePath?: string;
}) {
  return (
    <div className="space-y-4">
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
                      form to fill it in — Upload Sheet's Edit, a size under the name */}
                  <Link
                    href={`${ROUTES.customer(group.customerId)}#missing`}
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
                  {GROUPS.map((g, i) => (
                    <th
                      key={g.title}
                      colSpan={g.columns.length}
                      className={`px-2 py-1.5 ${i > 0 ? "border-l-2 border-white" : ""}`}
                    >
                      {g.title}
                    </th>
                  ))}
                </tr>
                <tr className="bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
                  {GROUPS.flatMap((g, gi) =>
                    g.columns.map((c, ci) => (
                      <th
                        key={`${g.title}-${c.label}`}
                        title={c.hint}
                        className={`whitespace-nowrap px-2 py-2 font-medium ${
                          gi > 0 && ci === 0 ? "border-l-2 border-[var(--color-line)]" : ""
                        } ${c.align === "right" ? "text-right" : ""}`}
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
                    )),
                  )}
                </tr>
              </thead>

              <tbody>
                {group.rows.map((invoice, index) => (
                  <Row key={invoice.id} invoice={invoice} index={index + 1} />
                ))}
              </tbody>

              <tfoot>
                <tr className="border-t-2 border-[var(--color-line)] bg-[#f7f9fc] font-semibold">
                  <td className="px-2 py-2" colSpan={5}>
                    {group.totals.invoices} invoice(s)
                    {group.totals.currency === "mixed" && " — mixed currencies"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(group.totals.invoiceValue, group.totals.currency === "mixed" ? null : group.totals.currency)}</td>
                  <td className="px-2 py-2" colSpan={3} />
                  <td className="px-2 py-2" colSpan={3} />
                  <td className="px-2 py-2" colSpan={6} />
                  <td className="px-2 py-2 text-right tabular-nums" colSpan={2}>
                    {money(group.totals.received, group.totals.currency === "mixed" ? null : group.totals.currency)}
                  </td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-right tabular-nums">{group.totals.collectedPct}%</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2" colSpan={2} />
                  <td className="px-2 py-2 text-right tabular-nums">{money(group.totals.outstanding, group.totals.currency === "mixed" ? null : group.totals.currency)}</td>
                  <td className="px-2 py-2" colSpan={2} />
                  <td className="px-2 py-2 text-[11px] font-normal text-[var(--color-bad-fg)]">
                    {group.totals.overdue > 0.01 ? `${money(group.totals.overdue, group.totals.currency === "mixed" ? null : group.totals.currency)} past due` : ""}
                  </td>
                  <td className="px-2 py-2" colSpan={8} />
                  <td className="px-2 py-2 text-[11px] font-normal text-[var(--color-ink-3)]" colSpan={3}>
                    {group.totals.dueDatesKnown < group.totals.invoices &&
                      `due dates: ${group.totals.dueDatesKnown}/${group.totals.invoices}`}
                  </td>
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

function Row({ invoice, index }: { invoice: TrackedInvoice; index: number }) {
  const m = invoice.money;
  const s = invoice.schedule;
  const late = (invoice.overdueDays ?? 0) > 0;
  const cell = "whitespace-nowrap px-2 py-2";
  const edge = "border-l-2 border-[var(--color-line)]";

  return (
    <>
      <tr className="border-t border-[var(--color-line)] align-top">
        {/* ---- Invoice */}
        <td className={`${cell} text-[var(--color-ink-3)] tabular-nums`}>{index}</td>
        <td className={`${cell} font-medium`}>
          <Link href={ROUTES.invoice(invoice.id)} className="link">
            {invoice.invoiceNo ?? <span className="italic text-[var(--color-ink-3)]">no number</span>}
          </Link>
        </td>
        <td className={cell}>
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
        </td>
        <td className={cell}>{day(invoice.invoiceDate)}</td>
        <td className={cell}>{invoice.currency ?? "—"}</td>
        <td className={`${cell} text-right tabular-nums`}>{money(invoice.customerInvoiceValue, invoice.currency)}</td>
        <td className={`${cell} text-right tabular-nums text-[var(--color-ink-3)]`}>
          {money(invoice.customsInvoiceValue, invoice.currency)}
        </td>
        <td className={`${cell} text-right tabular-nums`}>{rate(invoice.exchangeRate)}</td>
        <td className={`${cell} text-right tabular-nums text-[var(--color-ink-3)]`}>
          {homeMoney(m.homeInvoiceValue)}
        </td>

        {/* ---- Parties */}
        <td className={`px-2 py-2 ${edge}`}>
          <span className="block max-w-[14ch] truncate" title={invoice.consignee ?? undefined}>
            {invoice.consignee ?? "—"}
          </span>
        </td>
        <td className="px-2 py-2">
          <span className="block max-w-[14ch] truncate" title={invoice.notifyParty ?? undefined}>
            {invoice.notifyParty ?? "—"}
          </span>
        </td>
        <td className={cell}>{invoice.country ?? "—"}</td>

        {/* ---- Terms & dates */}
        <td className={`px-2 py-2 ${edge}`} title={s.term.raw || "No payment terms recorded"}>
          <span className="block max-w-[18ch] truncate">
            {s.term.raw || <span className="italic text-[var(--color-ink-3)]">none</span>}
          </span>
          {s.milestones.length > 1 && (
            <span className="text-[10px] text-[var(--color-ink-3)]">
              {s.milestones.length} milestones
            </span>
          )}
        </td>
        <td className={cell} title={s.dueDateNote}>
          {s.dueDate ? (
            <>
              {day(s.dueDate)}
              {s.dueDateSource === "entered" && (
                <div className="text-[10px] text-[var(--color-warn-fg)]">as entered</div>
              )}
            </>
          ) : (
            <span className="text-[var(--color-warn-fg)]">needs verification</span>
          )}
        </td>
        <td className={`${cell} text-[10px] text-[var(--color-ink-3)]`}>
          {s.dueDateSource === "calculated" && s.milestones.length
            ? BASIS_LABELS[s.milestones[0].basis]
            : s.dueDateSource === "entered"
              ? "entered"
              : "—"}
        </td>
        <td
          className={`${cell} tabular-nums ${late ? "font-semibold text-[var(--color-bad-fg)]" : "text-[var(--color-ink-3)]"}`}
        >
          {invoice.overdueDays === null
            ? "—"
            : late
              ? `${invoice.overdueDays}d`
              : `in ${Math.abs(invoice.overdueDays)}d`}
        </td>
        <td className={`${cell} tabular-nums text-[var(--color-ink-3)]`}>
          {invoice.invoiceAge === null ? "—" : `${invoice.invoiceAge}d`}
        </td>
        <td className={cell}>{invoice.ageing}</td>

        {/* ---- Receipts */}
        <td className={`${cell} ${edge} text-right tabular-nums`}>{m.receiptCount || "—"}</td>
        <td className={`${cell} text-right tabular-nums`}>
          {m.totalReceived ? money(m.totalReceived, invoice.currency) : "—"}
        </td>
        <td className={cell}>{day(invoice.lastReceiptDate)}</td>
        <td className={`${cell} text-right tabular-nums text-[var(--color-ink-3)]`}>
          {m.collectedPct === null ? "—" : `${m.collectedPct}%`}
        </td>
        <td
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
        </td>

        {/* ---- Balance */}
        <td className={`${cell} ${edge} text-right tabular-nums`}>
          {m.creditNotes > 0.01 ? money(m.creditNotes, invoice.currency) : "—"}
        </td>
        <td className={`${cell} text-right tabular-nums`}>
          {m.debitNotes > 0.01 ? money(m.debitNotes, invoice.currency) : "—"}
        </td>
        <td className={`${cell} text-right font-semibold tabular-nums`}>
          {money(m.calculatedOutstanding, invoice.currency)}
          {s.overdueAmount > 0.01 && s.overdueAmount < (m.calculatedOutstanding ?? 0) - 0.01 && (
            <div
              className="text-[10px] font-normal text-[var(--color-bad-fg)]"
              title="A split payment term: only this much has actually fallen due."
            >
              {money(s.overdueAmount, invoice.currency)} due
            </div>
          )}
        </td>
        <td className={`${cell} text-right tabular-nums text-[var(--color-ink-3)]`}>
          {money(m.booksBalance, invoice.currency)}
        </td>
        <td
          className={`${cell} text-right tabular-nums ${
            m.booksDifference !== null && Math.abs(m.booksDifference) > 0.01
              ? "font-semibold text-[var(--color-bad-fg)]"
              : "text-[var(--color-ink-3)]"
          }`}
        >
          {money(m.booksDifference, invoice.currency)}
        </td>
        <td className={cell}>
          <StatusChip status={invoice.status} note={invoice.statusNote} />
        </td>

        {/* ---- Shipping */}
        <td className={`${cell} ${edge}`}>{invoice.piNo ?? "—"}</td>
        <td className={cell}>{invoice.poNo ?? "—"}</td>
        <td className={cell}>{invoice.shippingBillNo ?? "—"}</td>
        <td className={cell}>{day(invoice.shippingBillDate)}</td>
        <td className={cell}>{invoice.blNo ?? "—"}</td>
        <td className={cell}>{day(invoice.blDate)}</td>
        <td className={cell}>{invoice.containerNo ?? "—"}</td>
        <td className={cell}>{day(invoice.eta)}</td>

        {/* ---- Tracking */}
        <td className={`px-2 py-2 ${edge}`}>
          <span className="block max-w-[20ch] truncate" title={invoice.remarks ?? undefined}>
            {invoice.remarks ?? "—"}
          </span>
        </td>
        <td className="px-2 py-2">
          <span className="block max-w-[20ch] truncate" title={invoice.followUpNotes ?? undefined}>
            {invoice.followUpNotes ?? "—"}
          </span>
        </td>
        <td className={`${cell} text-[10px] text-[var(--color-ink-3)]`}>
          {invoice.source === "EXCEL" ? "Excel" : "Manual"}
          {invoice.sourceAsOn && <div>as on {day(invoice.sourceAsOn)}</div>}
        </td>
      </tr>

      <tr className="border-t border-dashed border-[var(--color-line)]">
        <td colSpan={TOTAL_COLUMNS} className="p-0">
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
