/**
 * Ageing analysis, under Reports & Downloads Sheets (owner, 25 Oct 2026: "Add
 * professional ageing-based KPIs, charts, and visualizations in the most
 * suitable Dashboard or Reports section"). The dashboard keeps its own ageing
 * cards; this is the fuller picture, one currency at a time — amounts in
 * different currencies are never added together:
 *
 *   the KPIs (outstanding, overdue and its share, the oldest span, not yet due,
 *   no due date, days late on average), the balance by ageing category as bars,
 *   the payment status of every invoice as a ring, the ageing by customer as a
 *   heat map — the classic receivables ageing report — the largest overdue
 *   invoices, and how each customer pays (owner, 26 Oct 2026: "Customer Payment
 *   Performance … collection percentage, invoiced, received, outstanding,
 *   average collection time") — over every invoice, completed ones too, since a
 *   settled invoice is what collection time is measured on.
 *
 * Every figure comes from lib/payments/ageingReport.ts and management.ts over
 * the active invoices, with each invoice in the one ageing category the rest of
 * the app gives it. Every bar, cell and status opens Search Invoices on those
 * invoices. Reads only.
 */
import Link from "next/link";

import { day, money, TONE_CLASS } from "@/components/tracking/bits";
import { Eyebrow, Stat } from "@/components/tracking/Overview";
import { Empty, PageHead } from "@/components/ui";
import { ageingAnalysis, type AgeingAnalysis } from "@/lib/payments/ageingReport";
import { customerPerformance, type PerformanceRow } from "@/lib/payments/management";
import { NO_DUE_DATE, NOT_YET_DUE } from "@/lib/payments/money";
import { STATUS_TONE } from "@/lib/payments/record";
import { ROUTES } from "@/lib/routes";
import { loadTracking, toQuery } from "@/server/payments/query";

export const dynamic = "force-dynamic";

const CARD = "rounded-2xl border border-[var(--color-line)] bg-white p-5";
const TH = "whitespace-nowrap px-2 py-2 text-left text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-ink-3)]";

export default async function AgeingAnalysisPage() {
  const { invoices, completed, params, today } = await loadTracking();
  const currencies = [...new Set(invoices.map((i) => i.currency ?? "—"))].sort(
    (a, b) => Number(a === "—") - Number(b === "—") || a.localeCompare(b),
  );
  const performance = customerPerformance([...invoices, ...completed]);

  return (
    <>
      <PageHead
        title="Ageing analysis"
        lead={`What is owed and how late, per currency, as at ${day(today)} — by ageing category, by customer and by payment status, and how each customer pays. Click any bar, cell or status for the invoices behind it.`}
        actions={
          <>
            <Link href={ROUTES.reports} className="btn-ghost">
              Reports & Downloads Sheets
            </Link>
            <Link href={ROUTES.exportReport} className="btn">
              Download the Excel report
            </Link>
          </>
        }
      />

      {!invoices.length ? (
        <section className="card">
          <Empty>No invoices yet.</Empty>
        </section>
      ) : (
        <div className="flex flex-col gap-10">
          {currencies.map((currency) => {
            const list = invoices.filter((i) => (i.currency ?? "—") === currency);
            return (
              <div key={currency} className="flex flex-col gap-4">
                <CurrencyAgeing currency={currency} a={ageingAnalysis(list, params.ageingBuckets)} />
                <PaymentPerformance currency={currency} rows={performance.filter((r) => r.currency === currency)} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Search Invoices on these invoices. */
const search = (extra: Record<string, string>) => `${ROUTES.search}?${toQuery({}, extra)}`;

/** The tone of an ageing category: no date a question, not yet due fine, late worse the later. */
function bucketColour(label: string, n: number): string {
  if (label === NO_DUE_DATE) return "#946200";
  if (label === NOT_YET_DUE) return "#1a7f43";
  // the first span late in the info blue, then deepening reds
  const reds = ["#1f4e8c", "#f87171", "#dc2626", "#991b1b"];
  return reds[Math.min(n, reds.length - 1)] ?? "#991b1b";
}

function CurrencyAgeing({ currency, a }: { currency: string; a: AgeingAnalysis }) {
  const cur = currency === "—" ? null : currency;
  const k = a.kpis;
  const lateLabels = a.labels.filter((l) => l !== NO_DUE_DATE && l !== NOT_YET_DUE);
  const colour = (label: string) => bucketColour(label, lateLabels.indexOf(label));
  const max = Math.max(...a.buckets.map((b) => b.amount), 1);
  const cellMax = Math.max(...a.rows.flatMap((r) => r.amounts), 1);
  const here = { currency };

  return (
    <section className="flex flex-col gap-4">
      <Eyebrow>
        {cur ?? "No currency recorded"} · {k.openInvoices} open invoice(s) · {a.rows.length} customer(s) owing
      </Eyebrow>

      {/* ------------------------------------------------------------ KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total outstanding" value={money(k.outstanding, cur)} sub={`${k.openInvoices} open invoice(s)`} tone="info" href={search({ open: "1", ...here })} />
        <Stat
          label="Overdue"
          value={money(k.overdue, cur)}
          sub={`${k.overduePct}% of the balance · ${k.overdueInvoices} invoice(s) · ${k.customersOverdue} customer(s)`}
          tone={k.overdue > 0.01 ? "bad" : "plain"}
          href={search({ status: "OVERDUE", ...here })}
        />
        <Stat
          label={lateLabels.at(-1) ?? "Oldest"}
          value={money(k.oldestBucket, cur)}
          sub={`${k.oldestBucketPct}% of the balance`}
          tone={k.oldestBucket > 0.01 ? "bad" : "plain"}
          href={lateLabels.length ? search({ ageing: lateLabels.at(-1)!, ...here }) : undefined}
        />
        <Stat
          label="Average days overdue"
          value={k.avgDaysOverdue === null ? "—" : `${k.avgDaysOverdue} days`}
          sub="weighted by the amount overdue"
          tone={k.avgDaysOverdue ? "warn" : "plain"}
        />
        <Stat label="Not yet due" value={money(k.notYetDue, cur)} sub="falls due later" tone="ok" href={search({ ageing: NOT_YET_DUE, ...here })} />
        <Stat
          label="No due date"
          value={money(k.noDueDate, cur)}
          sub="terms or the date they count from missing"
          tone={k.noDueDate > 0.01 ? "warn" : "plain"}
          href={search({ ageing: NO_DUE_DATE, ...here })}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* ------------------------------------------------ by ageing category */}
        <section className={CARD}>
          <Eyebrow className="mb-4">Outstanding by ageing category</Eyebrow>
          <div className="flex h-56 items-end gap-3 border-b border-[var(--color-line)] pb-1">
            {a.buckets.map((b) => (
              <Link
                key={b.label}
                href={search({ ageing: b.label, ...here })}
                className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                title={`${b.label}: ${money(b.amount, cur)} on ${b.invoices} invoice(s)`}
              >
                <span className="text-[11px] font-semibold tabular-nums text-[var(--color-ink-2)]">
                  {b.amount > 0.01 ? `${Math.round((b.amount / Math.max(k.outstanding, 0.01)) * 100)}%` : ""}
                </span>
                <span
                  className="w-full max-w-[72px] rounded-t-md transition group-hover:opacity-80"
                  style={{ height: `${Math.max((b.amount / max) * 100, b.amount > 0.01 ? 2 : 0)}%`, background: colour(b.label) }}
                />
              </Link>
            ))}
          </div>
          <div className="mt-2 flex gap-3">
            {a.buckets.map((b) => (
              <div key={b.label} className="min-w-0 flex-1 text-center">
                <div className="truncate text-[11px] font-medium text-[var(--color-ink-2)]">{b.label}</div>
                <div className="truncate text-[11px] tabular-nums">{money(b.amount, cur)}</div>
                <div className="text-[10px] text-[var(--color-ink-3)]">{b.invoices} inv.</div>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------ payment status */}
        <section className={CARD}>
          <Eyebrow className="mb-4">Payment status · every invoice</Eyebrow>
          <StatusRing a={a} cur={cur} currency={currency} />
        </section>
      </div>

      {/* ------------------------------------------------ ageing by customer */}
      <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-line)] px-5 py-4">
          <Eyebrow>Ageing by customer</Eyebrow>
          <span className="text-[11px] text-[var(--color-ink-3)]">darker = more money · click a cell for its invoices</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[12.5px]">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <th className={`${TH} pl-5`}>Customer</th>
                {a.labels.map((l) => (
                  <th key={l} className={`${TH} text-right`}>
                    {l}
                  </th>
                ))}
                <th className={`${TH} pr-5 text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {a.rows.map((r) => (
                <tr key={r.customerId ?? r.customer} className="border-b border-[#f0f3f7]">
                  <td className="py-2 pl-5 pr-4 font-medium">
                    {r.customerId ? (
                      <Link href={ROUTES.customer(r.customerId)} className="link">
                        {r.customer}
                      </Link>
                    ) : (
                      r.customer
                    )}
                    <div className="text-[11px] font-normal text-[var(--color-ink-3)]">{r.invoices} open invoice(s)</div>
                  </td>
                  {r.amounts.map((v, n) => {
                    const label = a.labels[n]!;
                    const strength = v > 0.01 ? 0.12 + 0.6 * (v / cellMax) : 0;
                    return (
                      <td key={label} className="px-1 py-1 text-right">
                        {v > 0.01 ? (
                          <Link
                            href={search({ ageing: label, customer: r.customer, ...here })}
                            className="block rounded-md px-2 py-1.5 tabular-nums transition hover:ring-2 hover:ring-[#c6dcf3]"
                            style={{ background: hexAlpha(colour(label), strength), color: strength > 0.45 ? "white" : "#16202c" }}
                          >
                            {money(v, cur)}
                          </Link>
                        ) : (
                          <span className="px-2 text-[var(--color-line)]">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-2 pl-2 pr-5 text-right font-semibold tabular-nums">{money(r.total, cur)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--color-line)] bg-[#f7f9fc] font-semibold">
                <td className="py-2 pl-5">Total</td>
                {a.buckets.map((b) => (
                  <td key={b.label} className="px-3 py-2 text-right tabular-nums">
                    {money(b.amount, cur)}
                  </td>
                ))}
                <td className="py-2 pr-5 text-right tabular-nums">{money(k.outstanding, cur)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ------------------------------------------------ largest overdue */}
      {a.topOverdue.length > 0 && (
        <section className={CARD}>
          <Eyebrow className="mb-3">Largest overdue invoices</Eyebrow>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead>
                <tr className="border-b border-[var(--color-line)]">
                  <th className={TH}>Invoice</th>
                  <th className={TH}>Customer</th>
                  <th className={TH}>Due date</th>
                  <th className={`${TH} text-right`}>Days late</th>
                  <th className={`${TH} text-right`}>Overdue</th>
                  <th className={TH}>Ageing</th>
                </tr>
              </thead>
              <tbody>
                {a.topOverdue.map((i) => (
                  <tr key={i.id} className="border-b border-[#f0f3f7]">
                    <td className="px-2 py-2">
                      <Link href={ROUTES.invoice(i.id)} className="link font-medium">
                        {i.invoiceNo ?? "no number"}
                      </Link>
                    </td>
                    <td className="px-2 py-2">{i.customerName ?? "—"}</td>
                    <td className="px-2 py-2">{day(i.schedule.dueDate)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-[var(--color-bad-fg)]">{i.overdueDays ?? "—"}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{money(i.schedule.overdueAmount, cur)}</td>
                    <td className="px-2 py-2">{i.ageing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}

/** How each customer of one currency pays: billed, in, owed, and how fast. */
function PaymentPerformance({ currency, rows }: { currency: string; rows: PerformanceRow[] }) {
  if (!rows.length) return null;
  const cur = currency === "—" ? null : currency;
  return (
    <section id={`performance-${currency}`} className={`${CARD} scroll-mt-4`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Customer payment performance · {cur ?? "No currency recorded"}</Eyebrow>
        <span className="text-[11px] text-[var(--color-ink-3)]">
          every invoice, completed ones too · collection time over settled invoices with an invoice date
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12.5px]">
          <thead>
            <tr className="border-b border-[var(--color-line)]">
              <th className={TH}>Customer</th>
              <th className={`${TH} text-right`}>Invoices</th>
              <th className={`${TH} text-right`}>Invoiced</th>
              <th className={`${TH} text-right`}>Received</th>
              <th className={`${TH} text-right`}>Outstanding</th>
              <th className={`${TH} text-right`}>Collected</th>
              <th className={`${TH} text-right`}>Avg. days to collect</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.customerId ?? r.customer}`} className="border-b border-[#f0f3f7]">
                <td className="px-2 py-2 font-medium">
                  {r.customerId ? (
                    <Link href={ROUTES.customer(r.customerId)} className="link">
                      {r.customer}
                    </Link>
                  ) : (
                    r.customer
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{r.invoices}</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(r.invoiced, cur)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--color-ok-fg)]">{money(r.received, cur)}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{money(r.outstanding, cur)}</td>
                <td className="px-2 py-2 text-right">
                  {r.collectedPct === null ? (
                    <span className="text-[var(--color-ink-3)]">—</span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-[#e8eef4] sm:inline-block" aria-hidden>
                        <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.min(r.collectedPct, 100)}%` }} />
                      </span>
                      <span className="tabular-nums">{r.collectedPct}%</span>
                    </span>
                  )}
                </td>
                <td
                  className="px-2 py-2 text-right tabular-nums"
                  title={r.settled ? `over ${r.settled} settled invoice(s)` : "no settled invoice with an invoice date"}
                >
                  {r.avgDays === null ? <span className="text-[var(--color-ink-3)]">—</span> : `${r.avgDays} days`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A ring of the invoices by payment status, with its legend. */
function StatusRing({ a, cur, currency }: { a: AgeingAnalysis; cur: string | null; currency: string }) {
  const total = a.statuses.reduce((s, x) => s + x.invoices, 0) || 1;
  const COLOURS: Record<string, string> = { ok: "#1a7f43", warn: "#946200", bad: "#b02a2a", info: "#1f4e8c", mute: "#9ca3af" };
  const r = 52;
  const c = 2 * Math.PI * r;
  let at = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 132 132" className="h-40 w-40 shrink-0 -rotate-90" role="img" aria-label="Invoices by payment status">
        <circle cx="66" cy="66" r={r} fill="none" stroke="#f1f3f6" strokeWidth="18" />
        {a.statuses.map((s) => {
          const len = (s.invoices / total) * c;
          const seg = (
            <circle
              key={s.status}
              cx="66"
              cy="66"
              r={r}
              fill="none"
              stroke={COLOURS[STATUS_TONE[s.status]] ?? "#9ca3af"}
              strokeWidth="18"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-at}
            />
          );
          at += len;
          return seg;
        })}
      </svg>
      <ul className="min-w-[200px] flex-1 space-y-1.5 text-[12.5px]">
        {a.statuses.map((s) => (
          <li key={s.status} className="flex items-center justify-between gap-3">
            <Link href={search({ status: s.status, currency })} className={`chip ${TONE_CLASS[STATUS_TONE[s.status]]} hover:opacity-80`}>
              {s.label}
            </Link>
            <span className="text-right text-[11px] tabular-nums text-[var(--color-ink-2)]">
              {s.invoices} · {Math.round((s.invoices / total) * 100)}%{s.outstanding > 0.01 ? ` · ${money(s.outstanding, cur)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A #rrggbb colour at an alpha, for a heat-map cell. */
function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 100) / 100})`;
}
