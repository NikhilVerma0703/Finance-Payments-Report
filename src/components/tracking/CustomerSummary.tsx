/**
 * Customer-wise summary: one row per customer and currency, with totals per
 * currency underneath. Two currencies are never added together.
 *
 * The table management reads first, so it is laid out to be read left to
 * right: who, how many invoices, what was invoiced, what came in and how much
 * of it, what is still owed and how much of that is late — and one status that
 * says where the customer stands (`customerStanding`). Amounts are in the
 * customer's invoice currency, with its own symbol and grouping.
 *
 * Money held on account — received or credited but not yet attributed to an
 * invoice — gets its own two columns only when there is some. With `returnTo`,
 * a customer's currency can be set or corrected from the row itself; it is
 * saved on the customer in this module only. With `sort`, the reader can
 * reorder the rows within each currency.
 */
import Link from "next/link";

import { currencyLabel, currencyOptions } from "@/lib/choices";
import { STANDING_LABELS, STANDING_TONE } from "@/lib/payments/standing";
import { ROUTES } from "@/lib/routes";
import { saveCustomerAction } from "@/server/payments/actions";
import type { CustomerSummary as Row } from "@/server/payments/query";
import { AutoSelect } from "./AutoSelect";
import { day, money, TONE_CLASS } from "./bits";

/** The orders a reader can put the rows in, within each currency. */
export const SUMMARY_SORTS = {
  outstanding: "Outstanding balance, highest first",
  overdue: "Overdue amount, highest first",
  value: "Invoice value, highest first",
  collected: "Collected %, lowest first",
  name: "Customer name, A to Z",
} as const;

export type SummarySort = keyof typeof SUMMARY_SORTS;

export function isSummarySort(v: unknown): v is SummarySort {
  return typeof v === "string" && v in SUMMARY_SORTS;
}

const ORDER: Record<SummarySort, (a: Row, b: Row) => number> = {
  outstanding: (a, b) => b.outstanding - a.outstanding,
  overdue: (a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding,
  value: (a, b) => b.invoiceValue - a.invoiceValue,
  collected: (a, b) => a.collectedPct - b.collectedPct || b.outstanding - a.outstanding,
  name: (a, b) => a.name.localeCompare(b.name),
};

export function CustomerSummary({
  customers,
  returnTo,
  sort,
  today,
}: {
  customers: Row[];
  /** Where a currency change from the table comes back to. Omitted, the table is read-only. */
  returnTo?: string;
  /** The order in force and the query to keep when it changes. Omitted, no sort control. */
  sort?: { value: SummarySort; keep: Record<string, string> };
  /** The date the figures are as at, for the heading. */
  today?: string;
}) {
  if (!customers.length) return null;

  const order = ORDER[sort?.value ?? "outstanding"];
  const byCurrency = new Map<string, Row[]>();
  for (const c of customers) byCurrency.set(c.currency, [...(byCurrency.get(c.currency) ?? []), c]);
  for (const rows of byCurrency.values()) rows.sort(order);

  const anyOnAccount = customers.some((c) => Math.abs(c.onAccount) > 0.004);
  const several = byCurrency.size > 1;
  const people = new Set(customers.map((c) => c.id ?? "~none")).size;
  const columns = 10 + (anyOnAccount ? 2 : 0);
  let serial = 0;

  const th = "px-3 py-2.5 align-bottom font-semibold";
  const td = "px-3 py-3 align-top";

  return (
    <section
      className="mt-6 scroll-mt-4 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-white"
      id="customers"
    >
      {/* ---------------------------------------------------------- heading */}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight text-[var(--color-ink)]">
            Customer-wise summary
          </h2>
          <p className="mt-0.5 text-[12px] text-[var(--color-ink-3)]">
            {people} customer(s)
            {several && ` · ${byCurrency.size} currencies, totalled separately`} · amounts in each
            customer&rsquo;s invoice currency{today && ` · as at ${day(today)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[12px]">
          {sort && (
            <form action={`${ROUTES.dashboard}#customers`} className="flex items-center gap-2">
              {Object.entries(sort.keep).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <span className="text-[var(--color-ink-3)]">Sort by</span>
              <AutoSelect
                name="csort"
                value={sort.value}
                options={Object.entries(SUMMARY_SORTS)}
                label="Sort the customer-wise summary"
                className="py-1"
              />
            </form>
          )}
          {returnTo && (
            <span className="text-[11px] text-[var(--color-ink-3)]">
              Pick a currency in its column to set or correct a customer&rsquo;s default.
            </span>
          )}
        </div>
      </header>

      {/* ---------------------------------------------------------- table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-[var(--color-line)] bg-[#f4f7fa] text-[10.5px] uppercase tracking-[0.06em] text-[var(--color-ink-2)]">
              <th className={`${th} w-14 whitespace-nowrap text-center`}>S. No.</th>
              <th className={`${th} text-left`}>Customer</th>
              <th className={`${th} text-left`}>Currency</th>
              <th className={`${th} text-right`}>Total invoices</th>
              <th className={`${th} text-right`}>Invoice value</th>
              <th className={`${th} text-right`}>Total received</th>
              <th className={`${th} text-left`}>Collected</th>
              <th className={`${th} text-right`}>Outstanding balance</th>
              <th className={`${th} text-right`} title="The part of the balance whose due date has passed">
                Overdue amount
              </th>
              {anyOnAccount && (
                <>
                  <th
                    className={`${th} text-right`}
                    title="Received or credited, not yet attributed to an invoice"
                  >
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
            {[...byCurrency.entries()].map(([currency, rows]) => {
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
                }),
                { invoices: 0, open: 0, invoiced: 0, received: 0, outstanding: 0, onAccount: 0, net: 0, overdue: 0, overdueInvoices: 0 },
              );
              const pct = t.invoiced > 0 ? Math.round((t.received / t.invoiced) * 1000) / 10 : 0;

              return [
                several && (
                  <tr key={`head-${currency}`} className="border-b border-[var(--color-line)] bg-[#fbfcfd]">
                    <td colSpan={columns} className="px-3 py-2">
                      <CurrencyBadge code={cur} />
                      <span className="ml-2 text-[12px] font-semibold text-[var(--color-ink-2)]">
                        {cur ? currencyLabel(cur).replace(/^[A-Z]{3} — /, "") : "No currency recorded"}
                      </span>
                      <span className="ml-2 text-[11px] text-[var(--color-ink-3)]">{rows.length} customer(s)</span>
                    </td>
                  </tr>
                ),

                ...rows.map((c) => {
                  serial += 1;
                  return (
                    <tr
                      key={`${c.id ?? "none"}-${c.currency}`}
                      className="border-b border-[var(--color-line)] transition-colors hover:bg-[#f8fbfd]"
                    >
                      <td className={`${td} text-center tabular-nums text-[var(--color-ink-3)]`}>{serial}</td>
                      <td className={`${td} min-w-[220px]`}>
                        {c.id ? (
                          <Link
                            href={ROUTES.customer(c.id)}
                            className="text-[13px] font-semibold text-[var(--color-ink)] hover:text-[var(--color-brand-2)] hover:underline"
                          >
                            {c.name}
                          </Link>
                        ) : (
                          <span className="text-[13px] italic text-[var(--color-ink-3)]">{c.name}</span>
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        <CurrencyCell row={c} returnTo={returnTo} />
                      </td>
                      <td className={`${td} text-right`}>
                        <div className="tabular-nums font-medium">{c.invoices}</div>
                        {c.invoices > 0 && (
                          <div className="text-[10.5px] text-[var(--color-ink-3)]">{c.openInvoices} open</div>
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{money(c.invoiceValue, cur)}</td>
                      <td
                        className={`${td} whitespace-nowrap text-right tabular-nums ${c.received <= 0.01 ? "text-[var(--color-ink-3)]" : ""}`}
                      >
                        {money(c.received, cur)}
                      </td>
                      <td className={td}>{c.invoices > 0 ? <Collected pct={c.collectedPct} /> : <Dash />}</td>
                      <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums`}>
                        {money(c.outstanding, cur)}
                      </td>
                      <td className={`${td} whitespace-nowrap text-right`}>
                        {c.overdue > 0.01 ? (
                          <>
                            <div className="font-semibold tabular-nums text-[var(--color-bad-fg)]">
                              {money(c.overdue, cur)}
                            </div>
                            {c.oldestDue && (
                              <div className="text-[10.5px] text-[var(--color-ink-3)]">
                                oldest due {day(c.oldestDue)}
                              </div>
                            )}
                          </>
                        ) : (
                          <Dash />
                        )}
                      </td>
                      {anyOnAccount && (
                        <>
                          <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                            {Math.abs(c.onAccount) > 0.004 && c.id ? (
                              <Link
                                href={`${ROUTES.customer(c.id)}#on-account`}
                                className="font-medium text-[var(--color-accent)] hover:underline"
                              >
                                {money(c.onAccount, cur)}
                              </Link>
                            ) : (
                              <Dash />
                            )}
                          </td>
                          <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums`}>
                            {money(c.netOutstanding, cur)}
                          </td>
                        </>
                      )}
                      <td className={`${td} min-w-[180px]`}>
                        <span className={`chip ${TONE_CLASS[STANDING_TONE[c.paymentStatus]]}`}>
                          {STANDING_LABELS[c.paymentStatus]}
                        </span>
                        <StatusNote row={c} />
                      </td>
                    </tr>
                  );
                }),

                <tr
                  key={`total-${currency}`}
                  className="border-b-2 border-[var(--color-line)] bg-[#f4f7fa] font-semibold"
                >
                  <td className={td} />
                  <td className={td}>
                    {cur ? `Total ${currency}` : "Total — no currency"}
                    <div className="text-[10.5px] font-normal text-[var(--color-ink-3)]">{rows.length} customer(s)</div>
                  </td>
                  <td className={td}>
                    <CurrencyBadge code={cur} />
                  </td>
                  <td className={`${td} text-right`}>
                    <div className="tabular-nums">{t.invoices}</div>
                    <div className="text-[10.5px] font-normal text-[var(--color-ink-3)]">{t.open} open</div>
                  </td>
                  <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{money(t.invoiced, cur)}</td>
                  <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{money(t.received, cur)}</td>
                  <td className={td}>
                    <Collected pct={pct} />
                  </td>
                  <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{money(t.outstanding, cur)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {t.overdue > 0.01 ? (
                      <>
                        <div className="tabular-nums text-[var(--color-bad-fg)]">{money(t.overdue, cur)}</div>
                        <div className="text-[10.5px] font-normal text-[var(--color-ink-3)]">
                          {t.overdueInvoices} invoice(s)
                        </div>
                      </>
                    ) : (
                      <Dash />
                    )}
                  </td>
                  {anyOnAccount && (
                    <>
                      <td className={`${td} whitespace-nowrap text-right tabular-nums text-[var(--color-accent)]`}>
                        {Math.abs(t.onAccount) > 0.004 ? money(t.onAccount, cur) : <Dash />}
                      </td>
                      <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{money(t.net, cur)}</td>
                    </>
                  )}
                  <td className={td} />
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--color-line)] px-5 py-3 text-[11px] text-[var(--color-ink-3)]">
        <span>Totals are per currency — amounts in different currencies are never added together.</span>
        <span>
          <strong className="font-semibold text-[var(--color-ink-2)]">Overdue amount</strong> is only the part of a
          balance whose due date has passed.
        </span>
        <span>
          <strong className="font-semibold text-[var(--color-ink-2)]">Due date unknown</strong>: an open invoice has
          no due date to judge it by.
        </span>
      </footer>
    </section>
  );
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

/**
 * The currency, and where it came from.
 *
 * Editable when the row's currency is the customer's default (or there is
 * none): picking one saves it on the customer, which every invoice without a
 * currency of its own then follows. A currency every invoice states for itself
 * is not the customer's to change, so it is shown, not offered.
 */
function CurrencyCell({ row, returnTo }: { row: Row; returnTo?: string }) {
  const current = row.currency === "—" ? "" : row.currency;
  const tag = row.currencySource === "erp" && (
    <span
      className="ml-1 rounded bg-[var(--color-info-bg)] px-1 text-[9px] font-bold uppercase text-[var(--color-info-fg)]"
      title="The default from the main ERP's client list. Pick a currency to confirm or correct it here."
    >
      ERP
    </span>
  );

  if (!returnTo || !row.id || row.currencySource === "invoice") {
    return (
      <>
        <CurrencyBadge code={current || null} />
        {tag}
      </>
    );
  }

  return (
    <form action={saveCustomerAction} className="inline-flex items-center">
      <input type="hidden" name="customerId" value={row.id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <AutoSelect
        name="currency"
        value={current}
        options={currencyOptions(current)}
        blankLabel="— set —"
        label={`Currency for ${row.name}`}
        className={`font-mono font-semibold ${current ? "" : "border-[#efd9a1] bg-[var(--color-warn-bg)]"}`}
      />
      {tag}
    </form>
  );
}
