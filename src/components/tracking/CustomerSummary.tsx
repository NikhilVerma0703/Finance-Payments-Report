/**
 * Customer-wise summary: one row per customer and currency, with totals per
 * currency underneath. Two currencies are never added together.
 *
 * The table management reads first, so it is laid out to be read left to
 * right: who, how many invoices, what was invoiced, what is still owed, how
 * much of that is late and how much has been collected (owner, 29 Oct 2026:
 * the order Sheet, S. No., Customer, Total invoices, Invoice value,
 * Outstanding balance, Overdue, Collected) — then what came in and when it
 * last did, and one status that says where the customer stands
 * (`customerStanding`).
 * Amounts are in the customer's invoice currency, with its own symbol and
 * grouping.
 *
 * Its heading is the page's most prominent after the title, centred between
 * rules, with the search and the order under it (owner, 24 Oct 2026). The rows
 * come newest payment first unless another order is picked (?csort=), and a
 * name typed in the search box filters them as it is typed (CustomerSearch);
 * Enter sends it as ?cq=, so the S. No. and the totals are over the matches.
 * Rows are striped and the columns ruled; the Sheet, S. No. and Customer
 * columns stay put while the rest scrolls sideways, with a second scrollbar
 * along the top (SideScroll).
 *
 * Every amount carries its currency's code in front of it — USD 174,109.43,
 * INR 1,23,456.00 — and there is no Currency column (owner, 25 Oct 2026). The
 * code is the invoices' own, read from the uploaded sheets (sheetReader.ts
 * findCurrency; server/payments/currencies.ts reads older uploads again), then
 * the customer's default, then the ERP client list (query.ts). A row whose
 * currency nothing states says so under the customer's name.
 *
 * Money held on account — received or credited but not yet attributed to an
 * invoice — gets its own two columns only when there is some.
 */
import Link from "next/link";

import { currencyLabel } from "@/lib/choices";
import { STANDING_LABELS, STANDING_TONE } from "@/lib/payments/standing";
import { ROUTES } from "@/lib/routes";
import { daysBetween } from "@/lib/text";
import type { CustomerSummary as Row } from "@/server/payments/query";
import { AutoSelect } from "./AutoSelect";
import { formatMoney } from "@/lib/money";
import { day, TONE_CLASS } from "./bits";
import { CustomerSearch } from "./CustomerSearch";
import { SideScroll } from "./SideScroll";

/** The orders a reader can put the rows in, within each currency. The first
 *  is the default (owner, 24 Oct 2026: "By default, automatically sort
 *  customers by latest payment received"). */
export const SUMMARY_SORTS = {
  recent: "Latest payment received, newest first",
  outstanding: "Outstanding balance, highest first",
  overdue: "Overdue amount, highest first",
  value: "Invoice value, highest first",
  collected: "Collected %, lowest first",
  name: "Customer name, A to Z",
} as const;

export type SummarySort = keyof typeof SUMMARY_SORTS;

export const DEFAULT_SUMMARY_SORT: SummarySort = "recent";

export function isSummarySort(v: unknown): v is SummarySort {
  return typeof v === "string" && v in SUMMARY_SORTS;
}

const ORDER: Record<SummarySort, (a: Row, b: Row) => number> = {
  // a customer nothing has come in from goes after every one something has
  recent: (a, b) => (b.lastReceipt ?? "").localeCompare(a.lastReceipt ?? "") || b.outstanding - a.outstanding,
  outstanding: (a, b) => b.outstanding - a.outstanding,
  overdue: (a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding,
  value: (a, b) => b.invoiceValue - a.invoiceValue,
  collected: (a, b) => a.collectedPct - b.collectedPct || b.outstanding - a.outstanding,
  name: (a, b) => a.name.localeCompare(b.name),
};

const TABLE_ID = "customer-summary-table";

// Ruled columns, a stronger rule under the header, room to read. The borders
// are the cells' own (border-separate), because a collapsed border stays
// behind when its cell sticks.
const th =
  "whitespace-nowrap border-b-2 border-r border-[var(--color-line)] bg-[#f1f5f9] px-3 py-3 align-bottom text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-2)] last:border-r-0";
const td = "border-b border-r border-[#e8eef4] px-3 py-3 align-top last:border-r-0";
const foot = "border-b-2 border-r border-[var(--color-line)] bg-[#eef3f8] px-3 py-3 align-top last:border-r-0";

// Sheet, S. No. and Customer stay put while the figures scroll under them:
// fixed widths, so each knows where the one before ends.
const PIN = {
  sheet: "sticky left-0 z-10 w-[76px] min-w-[76px]",
  serial: "sticky left-[76px] z-10 w-[52px] min-w-[52px]",
  name: "sticky left-[128px] z-10 min-w-[210px] shadow-[6px_0_6px_-6px_rgba(16,24,40,0.2)]",
};
/** A body row's ground, striped: opaque, so nothing shows through a pinned cell. */
const ground = (stripe: boolean) => `${stripe ? "bg-[#f8fafc]" : "bg-white"} transition-colors group-hover:bg-[#eef6f5]`;

export function CustomerSummary({
  customers,
  sort,
  today,
  search = "",
}: {
  customers: Row[];
  /** The order in force and the query to keep when it changes. Omitted, no sort control. */
  sort?: { value: SummarySort; keep: Record<string, string> };
  /** The date the figures are as at, for the heading. */
  today?: string;
  /** The customer-name search sent with the form (?cq=). */
  search?: string;
}) {
  if (!customers.length) return null;

  const term = search.trim();
  const matching = term ? customers.filter((c) => c.name.toLowerCase().includes(term.toLowerCase())) : customers;
  const order = ORDER[sort?.value ?? DEFAULT_SUMMARY_SORT];
  const byCurrency = new Map<string, Row[]>();
  for (const c of matching) byCurrency.set(c.currency, [...(byCurrency.get(c.currency) ?? []), c]);
  for (const rows of byCurrency.values()) rows.sort(order);

  const anyOnAccount = matching.some((c) => Math.abs(c.onAccount) > 0.004);
  const several = byCurrency.size > 1;
  const people = new Set(customers.map((c) => c.id ?? "~none")).size;
  const columns = 11 + (anyOnAccount ? 2 : 0);
  // the summary without its search, the filters and the order kept
  const kept = sort ? new URLSearchParams({ ...sort.keep, ...(sort.value !== DEFAULT_SUMMARY_SORT ? { csort: sort.value } : {}) }).toString() : "";
  const clearHref = sort ? `${ROUTES.dashboard}${kept ? `?${kept}` : ""}#customers` : null;
  let serial = 0;

  return (
    <section className="mt-6 scroll-mt-4 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-white" id="customers">
      {/* ---------------------------------------------------------- heading */}
      {/* the heading management looks for first (owner, 24 Oct 2026: "larger,
          bold, highlighted with a more prominent color, and center-aligned") */}
      <header className="border-b border-[var(--color-line)] bg-gradient-to-b from-[#e8f1f9] to-white px-5 pb-4 pt-6 text-center">
        <div className="flex items-center gap-4">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#9db7d1]" aria-hidden />
          <h2 className="text-[26px] font-bold tracking-tight text-[var(--color-brand)] sm:text-[28px]">Customer-wise Summary</h2>
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#9db7d1]" aria-hidden />
        </div>
        <p className="mt-1.5 text-[12px] text-[var(--color-ink-3)]">
          {people} customer(s)
          {several && ` · ${byCurrency.size} currencies, totalled separately`} · amounts in each
          customer&rsquo;s invoice currency{today && ` · as at ${day(today)}`}
        </p>

        {sort && (
          <form action={`${ROUTES.dashboard}#customers`} className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12px]">
            {Object.entries(sort.keep).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <CustomerSearch tableId={TABLE_ID} initial={term} total={customers.length} />
            <span className="flex items-center gap-2">
              <span className="font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-3)]">Sort by</span>
              <AutoSelect name="csort" value={sort.value} options={Object.entries(SUMMARY_SORTS)} label="Sort the customer-wise summary" className="py-1.5 text-[13px]" />
            </span>
            {term && clearHref && (
              <Link href={clearHref} className="btn-ghost btn-sm">
                Clear search
              </Link>
            )}
          </form>
        )}
      </header>

      {/* ---------------------------------------------------------- table */}
      {!matching.length ? (
        <p className="px-5 py-8 text-center text-[13px] text-[var(--color-ink-2)]">
          No customer&rsquo;s name holds &ldquo;{term}&rdquo;.{" "}
          {clearHref && (
            <Link href={clearHref} className="link">
              Show every customer
            </Link>
          )}
        </p>
      ) : (
        <SideScroll label="Customer-wise summary — scrolls sideways">
          <table id={TABLE_ID} className="w-full min-w-[1180px] border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr>
                <th className={`${th} ${PIN.sheet} text-center`} title="The customer's outstanding sheet, as a PDF">
                  Sheet
                </th>
                <th className={`${th} ${PIN.serial} text-center`}>S. No.</th>
                <th className={`${th} ${PIN.name} text-left`}>Customer</th>
                <th className={`${th} text-right`}>Total invoices</th>
                <th className={`${th} text-right`}>Invoice value</th>
                <th className={`${th} text-right`}>Outstanding balance</th>
                <th className={`${th} text-right`} title="The part of the balance whose due date has passed">
                  Overdue amount
                </th>
                <th className={`${th} text-left`}>Collected</th>
                <th className={`${th} text-right`}>Total received</th>
                <th className={`${th} text-left`} title="The latest date a payment came in from the customer — the default order, newest first">
                  Last payment
                </th>
                {anyOnAccount && (
                  <>
                    <th className={`${th} text-right`} title="Received or credited, not yet attributed to an invoice">
                      On account
                    </th>
                    <th className={`${th} text-right`} title="Outstanding balance less what is on account">
                      Net outstanding
                    </th>
                  </>
                )}
                <th className={`${th} text-left`}>Payment status</th>
              </tr>
            </thead>

            <tbody>
              {/* real currencies first; no currency recorded last */}
              {[...byCurrency.entries()]
                .sort(([a], [b]) => Number(a === "—") - Number(b === "—"))
                .map(([currency, rows]) => {
                  const cur = currency === "—" ? null : currency;
                  const t = rows.reduce(
                    (s, c) => ({
                      invoices: s.invoices + c.invoices,
                      open: s.open + c.openInvoices,
                      invoiced: s.invoiced + c.invoiceValue,
                      received: s.received + c.received,
                      outstanding: s.outstanding + c.outstanding,
                      onAccount: s.onAccount + c.onAccount,
                      net: s.net + c.netOutstanding,
                      overdue: s.overdue + c.overdue,
                      overdueInvoices: s.overdueInvoices + c.overdueInvoices,
                      last: c.lastReceipt && (!s.last || c.lastReceipt > s.last) ? c.lastReceipt : s.last,
                    }),
                    { invoices: 0, open: 0, invoiced: 0, received: 0, outstanding: 0, onAccount: 0, net: 0, overdue: 0, overdueInvoices: 0, last: null as string | null },
                  );
                  const pct = t.invoiced > 0 ? Math.round((t.received / t.invoiced) * 1000) / 10 : 0;

                  return [
                    several && (
                      <tr key={`head-${currency}`} data-group={currency}>
                        <td colSpan={columns} className="border-b border-[var(--color-line)] bg-[#f6f9fc] p-0">
                          {/* the label keeps to the left edge however far the row is scrolled */}
                          <div className="sticky left-0 flex w-max items-center gap-2 px-3 py-2">
                            <CurrencyBadge code={cur} />
                            <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">
                              {cur ? currencyLabel(cur).replace(/^[A-Z]{3} — /, "") : "No currency recorded"}
                            </span>
                            <span className="text-[11px] text-[var(--color-ink-3)]">{rows.length} customer(s)</span>
                          </div>
                        </td>
                      </tr>
                    ),

                    ...rows.map((c, i) => {
                      serial += 1;
                      const cell = `${td} ${ground(i % 2 === 1)}`;
                      return (
                        <tr key={`${c.id ?? "none"}-${c.currency}`} className="group" data-name={c.name.toLowerCase()} data-cur={currency}>
                          <td className={`${cell} ${PIN.sheet} text-center`}>
                            {c.id && c.invoices > 0 && (
                              <a
                                href={`${ROUTES.customerSheet}?${new URLSearchParams({ customer: c.id, currency: c.currency }).toString()}`}
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-[#b9dfd9] bg-white px-2 py-1 text-[11px] font-semibold text-[var(--color-accent)] hover:bg-[#e6f4f2]"
                                title={`Download ${c.name}'s outstanding sheet (${c.currency}) as a PDF`}
                              >
                                ↓ PDF
                              </a>
                            )}
                          </td>
                          <td className={`${cell} ${PIN.serial} text-center tabular-nums text-[var(--color-ink-3)]`}>{serial}</td>
                          <td className={`${cell} ${PIN.name}`}>
                            {c.id ? (
                              <Link href={ROUTES.customer(c.id)} className="text-[13px] font-semibold text-[var(--color-ink)] hover:text-[var(--color-brand-2)] hover:underline">
                                {c.name}
                              </Link>
                            ) : (
                              <span className="text-[13px] italic text-[var(--color-ink-3)]">{c.name}</span>
                            )}
                            {!cur && (
                              <div
                                className="mt-0.5 text-[10.5px] font-medium text-[var(--color-warn-fg)]"
                                title="No uploaded sheet, invoice, customer record or ERP client states a currency for this customer"
                              >
                                currency not stated
                              </div>
                            )}
                          </td>
                          <td className={`${cell} text-right`}>
                            <div className="tabular-nums font-medium">{c.invoices}</div>
                            {c.invoices > 0 && <div className="text-[10.5px] text-[var(--color-ink-3)]">{c.openInvoices} open</div>}
                          </td>
                          <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>{coded(c.invoiceValue, cur)}</td>
                          <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums`}>{coded(c.outstanding, cur)}</td>
                          <td className={`${cell} whitespace-nowrap text-right`}>
                            {c.overdue > 0.01 ? (
                              <>
                                <div className="font-semibold tabular-nums text-[var(--color-bad-fg)]">{coded(c.overdue, cur)}</div>
                                {c.oldestDue && <div className="text-[10.5px] text-[var(--color-ink-3)]">oldest due {day(c.oldestDue)}</div>}
                              </>
                            ) : (
                              <Dash />
                            )}
                          </td>
                          <td className={cell}>{c.invoices > 0 ? <Collected pct={c.collectedPct} /> : <Dash />}</td>
                          <td className={`${cell} whitespace-nowrap text-right tabular-nums ${c.received <= 0.01 ? "text-[var(--color-ink-3)]" : ""}`}>
                            {coded(c.received, cur)}
                          </td>
                          <td className={`${cell} whitespace-nowrap`}>
                            {c.lastReceipt ? (
                              <>
                                <div className="tabular-nums text-[var(--color-ink)]">{day(c.lastReceipt)}</div>
                                {today && <div className="text-[10.5px] text-[var(--color-ink-3)]">{ago(daysBetween(c.lastReceipt, today))}</div>}
                              </>
                            ) : (
                              <span className="text-[10.5px] text-[var(--color-ink-3)]">no dated payment</span>
                            )}
                          </td>
                          {anyOnAccount && (
                            <>
                              <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>
                                {Math.abs(c.onAccount) > 0.004 && c.id ? (
                                  <Link href={`${ROUTES.customer(c.id)}#on-account`} className="font-medium text-[var(--color-accent)] hover:underline">
                                    {coded(c.onAccount, cur)}
                                  </Link>
                                ) : (
                                  <Dash />
                                )}
                              </td>
                              <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums`}>{coded(c.netOutstanding, cur)}</td>
                            </>
                          )}
                          <td className={`${cell} min-w-[170px]`}>
                            <span className={`chip ${TONE_CLASS[STANDING_TONE[c.paymentStatus]]}`}>{STANDING_LABELS[c.paymentStatus]}</span>
                            <StatusNote row={c} />
                          </td>
                        </tr>
                      );
                    }),

                    <tr key={`total-${currency}`} className="font-semibold" data-total={currency}>
                      <td className={`${foot} ${PIN.sheet}`} />
                      <td className={`${foot} ${PIN.serial}`} />
                      <td className={`${foot} ${PIN.name}`}>
                        {cur ? `Total ${currency}` : "Total — no currency"}
                        <div className="text-[10.5px] font-normal text-[var(--color-ink-3)]">{rows.length} customer(s)</div>
                      </td>
                      <td className={`${foot} text-right`}>
                        <div className="tabular-nums">{t.invoices}</div>
                        <div className="text-[10.5px] font-normal text-[var(--color-ink-3)]">{t.open} open</div>
                      </td>
                      <td className={`${foot} whitespace-nowrap text-right tabular-nums`}>{coded(t.invoiced, cur)}</td>
                      <td className={`${foot} whitespace-nowrap text-right tabular-nums`}>{coded(t.outstanding, cur)}</td>
                      <td className={`${foot} whitespace-nowrap text-right`}>
                        {t.overdue > 0.01 ? (
                          <>
                            <div className="tabular-nums text-[var(--color-bad-fg)]">{coded(t.overdue, cur)}</div>
                            <div className="text-[10.5px] font-normal text-[var(--color-ink-3)]">{t.overdueInvoices} invoice(s)</div>
                          </>
                        ) : (
                          <Dash />
                        )}
                      </td>
                      <td className={foot}>
                        <Collected pct={pct} />
                      </td>
                      <td className={`${foot} whitespace-nowrap text-right tabular-nums`}>{coded(t.received, cur)}</td>
                      <td className={`${foot} whitespace-nowrap text-[10.5px] font-normal text-[var(--color-ink-3)]`}>{t.last ? `latest ${day(t.last)}` : ""}</td>
                      {anyOnAccount && (
                        <>
                          <td className={`${foot} whitespace-nowrap text-right tabular-nums text-[var(--color-accent)]`}>
                            {Math.abs(t.onAccount) > 0.004 ? coded(t.onAccount, cur) : <Dash />}
                          </td>
                          <td className={`${foot} whitespace-nowrap text-right tabular-nums`}>{coded(t.net, cur)}</td>
                        </>
                      )}
                      <td className={foot} />
                    </tr>,
                  ];
                })}
            </tbody>
          </table>
        </SideScroll>
      )}

      <footer className="flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--color-line)] px-5 py-3 text-[11px] text-[var(--color-ink-3)]">
        <span>Totals are per currency — amounts in different currencies are never added together.</span>
        <span>
          <strong className="font-semibold text-[var(--color-ink-2)]">Last payment</strong> is the latest receipt from
          the customer, on any of its invoices or on account.
        </span>
        <span>
          <strong className="font-semibold text-[var(--color-ink-2)]">Overdue amount</strong> is only the part of a
          balance whose due date has passed.
        </span>
      </footer>
    </section>
  );
}

/**
 * An amount with its currency's code in front of it — USD 174,109.43, EUR
 * 64,824.56, INR 1,23,456.00 — grouped the way that currency is. With no
 * currency known, the digits alone: a guessed code would be worse than none.
 */
function coded(value: number, cur: string | null): string {
  const digits = formatMoney(value, cur, { symbol: false });
  return cur ? `${cur} ${digits}` : digits;
}

/** "today", "3 days ago". */
function ago(days: number): string {
  if (days <= 0) return "today";
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function Dash() {
  return <span className="text-[var(--color-ink-3)]">—</span>;
}

/** The share collected, as a figure and a short bar. */
function Collected({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  const fill = p >= 75 ? "bg-[var(--color-ok-fg)]" : p >= 40 ? "bg-[#d9900f]" : "bg-[var(--color-bad-fg)]";
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <div className="h-1.5 w-16 rounded-full bg-[#e8eef4]">
        <div className={`h-1.5 rounded-full ${fill}`} style={{ width: `${Math.max(p, p > 0 ? 3 : 0)}%` }} />
      </div>
      <span className={`w-11 text-right tabular-nums ${p === 0 ? "font-semibold text-[var(--color-bad-fg)]" : ""}`}>
        {pct}%
      </span>
    </div>
  );
}

/** The one fact that explains the status, under it. */
function StatusNote({ row: c }: { row: Row }) {
  let note: string | null = null;
  if (c.paymentStatus === "OVERDUE") note = `${c.overdueInvoices} of ${c.openInvoices} open overdue`;
  else if (c.paymentStatus === "DUE_DATE_UNKNOWN") note = `${c.openWithoutDueDate} open without a due date`;
  else if (c.paymentStatus === "ON_ACCOUNT_ONLY") note = "no invoices in this currency";
  else if (c.needsAttention > 0) note = `${c.needsAttention} need attention`;
  return note ? <div className="mt-1 whitespace-nowrap text-[10.5px] text-[var(--color-ink-3)]">{note}</div> : null;
}

function CurrencyBadge({ code }: { code: string | null }) {
  return (
    <span
      className={`inline-block rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
        code
          ? "border-[#c6dcf3] bg-[var(--color-info-bg)] text-[var(--color-info-fg)]"
          : "border-[#efd9a1] bg-[var(--color-warn-bg)] text-[var(--color-warn-fg)]"
      }`}
    >
      {code ?? "—"}
    </span>
  );
}
