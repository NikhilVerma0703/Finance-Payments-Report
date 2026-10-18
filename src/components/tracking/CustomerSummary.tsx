/**
 * Customer-wise summary: one row per customer and currency, with totals per
 * currency underneath. Two currencies are never added together.
 */
import Link from "next/link";

import { ROUTES } from "@/lib/routes";
import type { CustomerSummary as Row } from "@/server/payments/query";
import { day, money } from "./bits";

export function CustomerSummary({ customers }: { customers: Row[] }) {
  if (!customers.length) return null;

  const byCurrency = new Map<string, Row[]>();
  for (const c of customers) {
    const list = byCurrency.get(c.currency);
    if (list) list.push(c);
    else byCurrency.set(c.currency, [c]);
  }

  const head =
    "bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]";

  return (
    <section className="card mt-6">
      <h2 className="card-title">Customer-wise summary</h2>
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
              const t = rows.reduce(
                (s, c) => ({
                  invoices: s.invoices + c.invoices,
                  invoiced: s.invoiced + c.invoiceValue,
                  received: s.received + c.received,
                  outstanding: s.outstanding + c.outstanding,
                  overdue: s.overdue + c.overdue,
                  attention: s.attention + c.needsAttention,
                  due: s.due + c.dueDatesKnown,
                }),
                { invoices: 0, invoiced: 0, received: 0, outstanding: 0, overdue: 0, attention: 0, due: 0 },
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
                    <td className="px-3 py-2">{c.currency}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.invoices}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(c.invoiceValue, c.currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(c.received, c.currency)}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        c.collectedPct === 0 ? "font-semibold text-[var(--color-bad-fg)]" : ""
                      }`}
                    >
                      {c.collectedPct}%
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {money(c.outstanding, c.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--color-bad-fg)]">
                      {c.overdue > 0.01 ? money(c.overdue, c.currency) : "—"}
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
                  <td className="px-3 py-2">Total {currency}</td>
                  <td className="px-3 py-2">{currency}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.invoices}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(t.invoiced, currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(t.received, currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(t.outstanding, currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--color-bad-fg)]">
                    {t.overdue > 0.01 ? money(t.overdue, currency) : "—"}
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
