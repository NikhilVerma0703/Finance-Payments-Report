/**
 * Customer-wise summary: one row per customer and currency, with totals per
 * currency underneath. Two currencies are never added together.
 *
 * Money held on account — received or credited but not yet attributed to an
 * invoice — has its own column, and Net is what the customer owes once it is
 * counted. With `returnTo`, a customer's currency can be set or corrected from
 * the row itself; it is saved on the customer in this module only.
 */
import Link from "next/link";

import { currencyOptions } from "@/lib/choices";
import { ROUTES } from "@/lib/routes";
import { saveCustomerAction } from "@/server/payments/actions";
import type { CustomerSummary as Row } from "@/server/payments/query";
import { AutoSelect } from "./AutoSelect";
import { day, money } from "./bits";

export function CustomerSummary({
  customers,
  returnTo,
}: {
  customers: Row[];
  /** Where a currency change from the table comes back to. Omitted, the table is read-only. */
  returnTo?: string;
}) {
  if (!customers.length) return null;

  const byCurrency = new Map<string, Row[]>();
  for (const c of customers) {
    const list = byCurrency.get(c.currency);
    if (list) list.push(c);
    else byCurrency.set(c.currency, [c]);
  }
  const anyOnAccount = customers.some((c) => Math.abs(c.onAccount) > 0.004);

  const head =
    "bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]";

  return (
    <section className="card mt-6" id="customers">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="card-title mb-0">Customer-wise summary</h2>
        {returnTo && (
          <span className="text-[11px] text-[var(--color-ink-3)]">
            Pick a currency in the Currency column to set or correct a customer&rsquo;s default.
          </span>
        )}
      </div>
      <div className="tablewrap">
        <table className="w-full text-[12px]">
          <thead>
            <tr className={head}>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Currency</th>
              <th className="px-3 py-2 text-right">Invoices</th>
              <th className="px-3 py-2 text-right">Invoiced</th>
              <th className="px-3 py-2 text-right">Received</th>
              <th className="px-3 py-2 text-right">Collected</th>
              <th className="px-3 py-2 text-right">Outstanding</th>
              {anyOnAccount && (
                <>
                  <th
                    className="px-3 py-2 text-right"
                    title="Received or credited, not yet attributed to an invoice"
                  >
                    On account
                  </th>
                  <th className="px-3 py-2 text-right" title="Outstanding less what is on account">
                    Net
                  </th>
                </>
              )}
              <th className="px-3 py-2 text-right">Overdue</th>
              <th className="px-3 py-2">Oldest due</th>
              <th className="px-3 py-2" title="Invoices with a due date that could be established">
                Due dates
              </th>
              <th className="px-3 py-2 text-right">Attention</th>
            </tr>
          </thead>
          <tbody>
            {[...byCurrency.entries()].map(([currency, rows]) => {
              const cur = currency === "—" ? null : currency;
              const t = rows.reduce(
                (s, c) => ({
                  invoices: s.invoices + c.invoices,
                  invoiced: s.invoiced + c.invoiceValue,
                  received: s.received + c.received,
                  outstanding: s.outstanding + c.outstanding,
                  onAccount: s.onAccount + c.onAccount,
                  net: s.net + c.netOutstanding,
                  overdue: s.overdue + c.overdue,
                  attention: s.attention + c.needsAttention,
                  due: s.due + c.dueDatesKnown,
                }),
                { invoices: 0, invoiced: 0, received: 0, outstanding: 0, onAccount: 0, net: 0, overdue: 0, attention: 0, due: 0 },
              );
              const pct = t.invoiced > 0 ? Math.round((t.received / t.invoiced) * 1000) / 10 : 0;
              return [
                ...rows.map((c) => (
                  <tr key={`${c.id ?? "none"}-${c.currency}`} className="border-t border-[var(--color-line)]">
                    <td className="px-3 py-2 font-medium">
                      {c.id ? (
                        <Link href={ROUTES.customer(c.id)} className="link">
                          {c.name}
                        </Link>
                      ) : (
                        <span className="text-[var(--color-ink-3)]">{c.name}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <CurrencyCell row={c} returnTo={returnTo} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.invoices}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(c.invoiceValue, cur)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(c.received, cur)}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        c.collectedPct === 0 && c.invoices > 0 ? "font-semibold text-[var(--color-bad-fg)]" : ""
                      }`}
                    >
                      {c.invoices > 0 ? `${c.collectedPct}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {money(c.outstanding, cur)}
                    </td>
                    {anyOnAccount && (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums text-[var(--color-accent)]">
                          {Math.abs(c.onAccount) > 0.004 && c.id ? (
                            <Link href={`${ROUTES.customer(c.id)}#on-account`} className="hover:underline">
                              {money(c.onAccount, cur)}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {money(c.netOutstanding, cur)}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--color-bad-fg)]">
                      {c.overdue > 0.01 ? money(c.overdue, cur) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{day(c.oldestDue)}</td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 ${
                        c.dueDatesKnown < c.invoices
                          ? "text-[var(--color-warn-fg)]"
                          : "text-[var(--color-ink-3)]"
                      }`}
                    >
                      {c.dueDatesKnown} of {c.invoices}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.needsAttention || "—"}</td>
                  </tr>
                )),
                <tr
                  key={`total-${currency}`}
                  className="border-t-2 border-[var(--color-line)] bg-[#f2f6fb] font-semibold"
                >
                  <td className="px-3 py-2">{cur ? `Total ${currency}` : "Total — no currency"}</td>
                  <td className="px-3 py-2">{currency}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.invoices}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(t.invoiced, cur)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(t.received, cur)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(t.outstanding, cur)}</td>
                  {anyOnAccount && (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--color-accent)]">
                        {Math.abs(t.onAccount) > 0.004 ? money(t.onAccount, cur) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(t.net, cur)}</td>
                    </>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--color-bad-fg)]">
                    {t.overdue > 0.01 ? money(t.overdue, cur) : "—"}
                  </td>
                  <td className="px-3 py-2" />
                  <td className="whitespace-nowrap px-3 py-2">
                    {t.due} of {t.invoices}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.attention || "—"}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
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
  const fromErp = row.currencySource === "erp";
  const tag = fromErp && (
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
        {row.currency}
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
        className={current ? "" : "border-[#efd9a1] bg-[var(--color-warn-bg)]"}
      />
      {tag}
    </form>
  );
}
