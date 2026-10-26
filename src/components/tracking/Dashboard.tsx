/**
 * The dashboard: KPIs and the ageing summary, per currency and never across it,
 * because adding a USD balance to a EUR one produces the only kind of number a
 * receivables figure must not be.
 *
 * Overdue prints its own denominator: it can only be computed for invoices
 * whose due date could be established, so the tile says how much of the book it
 * covers and how much it cannot speak for.
 *
 * Two parts, so the page can put the customer-wise summary between them: the
 * KPI cards (`Dashboard`) — the collection gauge, receipts by month and the
 * headline figures — then what lies ahead (`AgeingSummary`): the balance week
 * by week, the ageing, the biggest balances and the status chips.
 */
import Link from "next/link";

import { STATUS_LABELS, STATUS_TONE, type TrackedInvoice, type TrackingStatus } from "@/lib/payments/record";
import { HOME_CURRENCY } from "@/lib/money";
import { NO_DUE_DATE, NOT_YET_DUE } from "@/lib/payments/money";
import type { OnAccountEntry } from "@/lib/payments/onAccount";
import { dueByWeek, monthToDate, receiptsByMonth, receivedByWeek } from "@/lib/payments/overview";
import { ROUTES } from "@/lib/routes";
import {
  toQuery,
  type CustomerSummary,
  type TrackingFilters,
  type TrackingKpis,
} from "@/server/payments/query";
import { homeMoney, kpiMoney, money, TONE_CLASS } from "./bits";
import { DueStrip, Eyebrow, ReceivedStrip, Ring, ShareBar, Sparkline, Stat, TopBalances } from "./Overview";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

/** Search Invoices with the filters in force and these on top. */
function drillTo(filters: TrackingFilters, extra: Record<string, string>): string {
  return `${ROUTES.search}?${toQuery({ ...filters, sort: undefined, dir: undefined }, extra)}`;
}

const inCurrency = <T extends { currency: string | null }>(rows: T[], currency: string) =>
  rows.filter((r) => (r.currency ?? "—") === currency);

export function Dashboard({
  kpis,
  today,
  invoices,
  receiptsFrom,
  onAccount,
  filters,
}: {
  kpis: TrackingKpis[];
  today: string;
  /** The invoices the KPIs were worked out from. */
  invoices: TrackedInvoice[];
  /** Every invoice in view, cleared ones too, for what came in month by month —
   *  the KPIs may be over the pending invoices alone, and a receipt on an
   *  invoice since cleared is still money that came in. Defaults to `invoices`. */
  receiptsFrom?: TrackedInvoice[];
  onAccount: OnAccountEntry[];
  /** The filters in force, carried into every drill-down link. */
  filters: TrackingFilters;
}) {
  if (!kpis.length) return null;

  // the one figure that can be added across currencies: each invoice at its
  // own rate. Shown only with more than one currency, with its coverage.
  const home = kpis.reduce(
    (t, k) => ({
      invoiced: t.invoiced + k.homeInvoiceValue,
      received: t.received + k.homeReceived,
      outstanding: t.outstanding + k.homeOutstanding,
      known: t.known + k.homeRatesKnown,
      invoices: t.invoices + k.invoices,
    }),
    { invoiced: 0, received: 0, outstanding: 0, known: 0, invoices: 0 },
  );

  return (
    <div className="mb-6 space-y-7">
      {kpis.length > 1 && home.known > 0 && (
        <section className="rounded-2xl border border-[#c6dcf3] bg-[var(--color-info-bg)] p-5">
          <Eyebrow className="mb-3">
            All currencies, in {HOME_CURRENCY}
            <span className="ml-2 font-normal normal-case tracking-normal text-[var(--color-ink-3)]">
              each invoice at its own rate · {home.known} of {home.invoices} invoice(s) carry one
            </span>
          </Eyebrow>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={`Invoiced (${HOME_CURRENCY})`} value={kpiMoney(home.invoiced, HOME_CURRENCY)} />
            <Stat label={`Received (${HOME_CURRENCY})`} value={kpiMoney(home.received, HOME_CURRENCY)} tone="ok" />
            <Stat
              label={`Outstanding (${HOME_CURRENCY})`}
              value={kpiMoney(home.outstanding, HOME_CURRENCY)}
              tone="info"
            />
          </div>
        </section>
      )}

      {kpis.map((k) => {
        const cur = k.currency === "—" ? null : k.currency;
        const coverage =
          k.totalOutstanding > 0.01 ? Math.round((k.assessable / k.totalOutstanding) * 100) : 100;
        const list = inCurrency(receiptsFrom ?? invoices, k.currency);
        const held = inCurrency(onAccount, k.currency);
        const months = receiptsByMonth(list, held, today);
        const mtd = monthToDate(list, held, today);
        const net = k.totalOutstanding - k.onAccount.net;
        const outstandingShare = k.totalInvoiceValue > 0 ? (k.totalOutstanding / k.totalInvoiceValue) * 100 : 0;
        const overdueShare = k.totalOutstanding > 0.01 ? (k.overdueOutstanding / k.totalOutstanding) * 100 : 0;

        return (
          <section key={k.currency} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Eyebrow>
                {cur ?? "No currency recorded"} · {k.invoices} invoice(s) · {k.customers} customer(s)
              </Eyebrow>
              {k.forexGainLoss !== null && (
                <span className="text-[11px] text-[var(--color-ink-3)]">
                  forex{" "}
                  <strong
                    className={
                      k.forexGainLoss >= 0 ? "text-[var(--color-ok-fg)]" : "text-[var(--color-bad-fg)]"
                    }
                  >
                    {k.forexGainLoss >= 0 ? "gain" : "loss"} {homeMoney(Math.abs(k.forexGainLoss))}
                  </strong>
                </span>
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              {/* ------------------------------------------- collection gauge */}
              <section className="rounded-2xl border border-[var(--color-line)] bg-white p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <Eyebrow>Collected against invoiced</Eyebrow>
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--color-line)] text-[9px] text-[var(--color-ink-3)]"
                    title="Received ÷ invoice value, over every invoice in view. Credit notes are not counted as collected."
                  >
                    i
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-6">
                  <Ring pct={k.collectionRate}>
                    <span className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
                      Collected
                    </span>
                    <span className="text-[30px] font-semibold leading-none tracking-tight">{k.collectionRate}%</span>
                    <span className="mt-1 text-[10.5px] text-[var(--color-ink-3)]">of invoiced</span>
                  </Ring>
                  <div className="min-w-[210px] flex-1 space-y-3">
                    <div>
                      <div className="text-[22px] font-semibold leading-tight tabular-nums">
                        {kpiMoney(k.totalReceived, cur)}
                      </div>
                      <div className="text-[11px] text-[var(--color-ink-3)]">
                        received of {money(k.totalInvoiceValue, cur)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      {mtd.change !== null ? (
                        <span
                          className={`chip ${mtd.change >= 0 ? TONE_CLASS.ok : TONE_CLASS.bad}`}
                          title={`${money(mtd.now, cur)} this month so far against ${money(mtd.before, cur)} over the same days of ${monthName(mtd.previousMonth)}`}
                        >
                          {mtd.change >= 0 ? "▲" : "▼"} {Math.abs(mtd.change)}% vs {monthName(mtd.previousMonth)} to date
                        </span>
                      ) : (
                        <span className={`chip ${TONE_CLASS.mute}`}>nothing to compare in {monthName(mtd.previousMonth)}</span>
                      )}
                      <span className="text-[var(--color-ink-3)]">
                        {money(mtd.now, cur)} this month
                      </span>
                    </div>
                    <ShareBar label="Outstanding" value={money(k.totalOutstanding, cur)} pct={outstandingShare} tone="info" />
                    <ShareBar label="of it overdue" value={money(k.overdueOutstanding, cur)} pct={overdueShare} tone="bad" />
                    <ShareBar label="of it with a due date" value={money(k.assessable, cur)} pct={coverage} tone="accent" />
                  </div>
                </div>

                <div className="mt-4 border-t border-[var(--color-line)] pt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <Eyebrow>Received · last 12 months</Eyebrow>
                    <span className="text-[10.5px] text-[var(--color-ink-3)]">by receipt date</span>
                  </div>
                  <Sparkline points={months.points} id={`spark-${k.currency}`} />
                  <div className="flex justify-between text-[10px] text-[var(--color-ink-3)]">
                    <span>{monthName(months.points[0].month)}</span>
                    <span>{monthName(months.points[months.points.length - 1].month)} (so far)</span>
                  </div>
                  {months.undated > 0.01 && (
                    <p className="mt-1 text-[10.5px] text-[var(--color-warn-fg)]">
                      {money(months.undated, cur)} received without a date is not in the line.
                    </p>
                  )}
                </div>
              </section>

              {/* ------------------------------------------- headline figures */}
              <div className="flex min-w-0 flex-col gap-3">
              <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Stat label="Total invoice value" value={kpiMoney(k.totalInvoiceValue, cur)} sub={`${k.invoices} invoice(s)`} />
                <Stat
                  label="Total received"
                  value={kpiMoney(k.totalReceived, cur)}
                  sub={`${k.collectionRate}% collected`}
                  tone={k.collectionRate >= 75 ? "ok" : k.collectionRate >= 40 ? "warn" : "bad"}
                />
                <Stat
                  label="Total outstanding"
                  value={kpiMoney(k.totalOutstanding, cur)}
                  sub={`${k.customers} customer(s)`}
                  tone="info"
                  href={drillTo(filters, { open: "1", currency: k.currency })}
                />
                <Stat
                  label="Overdue outstanding"
                  value={kpiMoney(k.overdueOutstanding, cur)}
                  sub={
                    <>
                      {k.overdueInvoices} invoice(s) · {coverage}% of the balance has a due date
                      {k.requiresVerification > 0.01 && (
                        <>
                          {" · "}
                          <strong className="text-[var(--color-warn-fg)]">{money(k.requiresVerification, cur)}</strong> has none
                        </>
                      )}
                    </>
                  }
                  tone={k.overdueOutstanding > 0.01 ? "bad" : "plain"}
                  href={drillTo(filters, { status: "OVERDUE", currency: k.currency })}
                />
                <Stat
                  label="Needs attention"
                  value={String(k.needsAttention)}
                  sub={`${money(k.needsAttentionAmount, cur)} outstanding`}
                  tone={k.needsAttention ? "warn" : "ok"}
                  href={drillTo(filters, { attention: "1", currency: k.currency })}
                />
                <Stat
                  label="Net outstanding"
                  value={kpiMoney(net, cur)}
                  sub={
                    k.onAccount.entries > 0
                      ? `after ${money(k.onAccount.net, cur)} held on account, not yet attributed`
                      : "nothing held on account"
                  }
                  tone="accent"
                />
              </div>
              {/* the space under the tiles: what came in month by month (owner, 26 Oct 2026) */}
              <MonthlyCollection points={months.points} undated={months.undated} mtd={mtd} cur={cur} />
              </div>
            </div>

            {k.homeRatesKnown > 0 && (
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-xl border border-[var(--color-line)] bg-white px-4 py-2 text-[11px]">
                <span className="font-semibold text-[var(--color-ink-2)]">In {HOME_CURRENCY}</span>
                <span>
                  invoiced <strong className="tabular-nums">{homeMoney(k.homeInvoiceValue)}</strong>
                </span>
                <span>
                  received <strong className="tabular-nums">{homeMoney(k.homeReceived)}</strong>
                </span>
                <span>
                  outstanding <strong className="tabular-nums">{homeMoney(k.homeOutstanding)}</strong>
                </span>
                <span className="text-[var(--color-ink-3)]">
                  {k.homeRatesKnown} of {k.invoices} invoice(s) carry a rate
                </span>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * What lies ahead, per currency: the balance week by week, the ageing (a bar
 * and the cards), the biggest balances and the status chips — each a
 * drill-down into Search Invoices.
 */
export function AgeingSummary({
  kpis,
  filters,
  invoices,
  receiptsFrom,
  onAccount = [],
  customers,
  today,
}: {
  kpis: TrackingKpis[];
  /** The filters in force, carried into every drill-down link. */
  filters: TrackingFilters;
  invoices: TrackedInvoice[];
  /** Every invoice in view, cleared ones too, for the received timeline.
   *  Defaults to `invoices`. */
  receiptsFrom?: TrackedInvoice[];
  /** Money on account, for the received timeline. */
  onAccount?: OnAccountEntry[];
  customers: CustomerSummary[];
  today: string;
}) {
  if (!kpis.length) return null;

  const drill = (extra: Record<string, string>) => drillTo(filters, extra);

  return (
    <div className="mb-6 mt-6 space-y-7">
      {kpis.map((k) => {
        const a = k.ageingSummary;
        const cur = k.currency === "—" ? null : k.currency;
        const weeks = dueByWeek(inCurrency(invoices, k.currency), today);
        const received = receivedByWeek(inCurrency(receiptsFrom ?? invoices, k.currency), inCurrency(onAccount, k.currency), today);
        const total = a.buckets.reduce((s, b) => s + b.amount, 0);

        return (
          <section key={k.currency} className="space-y-4">
            {/* the trends beside the ageing (owner, 26 Oct 2026): what falls due and
                what came in on the left, the ageing and the biggest balances on the right */}
            <div className="grid items-start gap-4 xl:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
            {a.openInvoices > 0 && <DueStrip columns={weeks} currency={k.currency} filters={filters} />}
            {/* what fell due beside what came in (owner, 24 Oct 2026) */}
            {received.some((c) => c.amount > 0.01) && <ReceivedStrip columns={received} currency={k.currency} filters={filters} />}
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <section className="rounded-2xl border border-[var(--color-line)] bg-white p-5">
                {a.openInvoices > 0 && (
                  <div className="mb-4">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
                        Ageing summary
                        {/* away from its KPI tiles, the section says which currency it is */}
                        {` · ${k.currency}`}
                      </h3>
                      <span className="text-[11px] text-[var(--color-ink-3)]">
                        {a.openInvoices} open invoice(s) · {money(a.totalOutstanding, cur)}{" "}
                        outstanding, each in one ageing bucket
                      </span>
                    </div>

                    {total > 0.01 && (
                      <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-[#e8eef4]">
                        {a.buckets
                          .filter((b) => b.amount > 0.01)
                          .map((b) => (
                            <Link
                              key={b.label}
                              href={drill({ ageing: b.label, currency: k.currency })}
                              title={`${b.label}: ${money(b.amount, cur)} on ${b.count} invoice(s)`}
                              className={`${BAR_FILL[toneFor(b.label)]} border-r border-white last:border-r-0 hover:opacity-80`}
                              style={{ width: `${(b.amount / total) * 100}%` }}
                            />
                          ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-stretch gap-3">
                      <AgeingCard
                        label="Nothing received"
                        count={a.nothingReceived.count}
                        amount={kpiMoney(a.nothingReceived.amount, cur)}
                        href={drill({ nilReceived: "1", open: "1", currency: k.currency })}
                        tone="bad"
                      />
                      <div className="hidden w-px self-stretch bg-[var(--color-line)] sm:block" />
                      <div className="flex min-w-0 flex-1 flex-col gap-3">
                        {/* not yet due, overdue and undated kept apart, each card with its share (owner, 26 Oct 2026) */}
                        {[
                          { title: "Not yet due", list: a.buckets.filter((b) => b.label === NOT_YET_DUE) },
                          { title: "Overdue", list: a.buckets.filter((b) => b.label !== NOT_YET_DUE && b.label !== NO_DUE_DATE) },
                          { title: "No due date", list: a.buckets.filter((b) => b.label === NO_DUE_DATE) },
                        ].map((g) => (
                          <div key={g.title}>
                            <div className="mb-1 flex items-baseline justify-between text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
                              <span>{g.title}</span>
                              <span className="font-semibold normal-case tracking-normal tabular-nums">
                                {total > 0.01 ? Math.round((g.list.reduce((s, b) => s + b.amount, 0) / total) * 1000) / 10 : 0}% of the balance
                              </span>
                            </div>
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
                              {g.list.map((b) => (
                                <AgeingCard
                                  key={b.label}
                                  label={b.label}
                                  count={b.count}
                                  amount={kpiMoney(b.amount, cur)}
                                  share={total > 0.01 ? Math.round((b.amount / total) * 1000) / 10 : 0}
                                  href={drill({ ageing: b.label, currency: k.currency })}
                                  tone={toneFor(b.label)}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
                    Status
                  </span>
                  {(Object.entries(k.statuses) as Array<[TrackingStatus, number]>)
                    .sort((x, y) => y[1] - x[1])
                    .map(([status, count]) => (
                      <Link
                        key={status}
                        href={drill({ status, currency: k.currency })}
                        className={`chip ${TONE_CLASS[STATUS_TONE[status]]} hover:opacity-80`}
                      >
                        {STATUS_LABELS[status]} {count}
                      </Link>
                    ))}
                </div>
              </section>

              <TopBalances rows={customers} currency={k.currency} />
            </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

const BAR_FILL: Record<string, string> = {
  plain: "bg-[var(--color-line)]",
  ok: "bg-[var(--color-ok-fg)]",
  info: "bg-[var(--color-info-fg)]",
  warn: "bg-[var(--color-warn-fg)]",
  bad: "bg-[var(--color-bad-fg)]",
};

function toneFor(label: string): "plain" | "warn" | "bad" | "info" | "ok" {
  if (label === "No due date") return "warn";
  if (label === "Not yet due") return "ok";
  if (label.startsWith("1–")) return "info";
  return "bad";
}

function AgeingCard({
  label,
  count,
  amount,
  share,
  href,
  tone,
}: {
  label: string;
  count: number;
  amount: string;
  /** Its share of the outstanding balance, %. */
  share?: number;
  href: string;
  tone: "plain" | "warn" | "bad" | "info" | "ok";
}) {
  const empty = count === 0;
  return (
    <Link
      href={href}
      className={`group relative min-w-[150px] overflow-hidden rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-3 transition-colors hover:border-[#a9c6e8] ${
        empty ? "opacity-60" : ""
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${BAR_FILL[tone]}`} aria-hidden />
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
        {label}
      </div>
      <div className="mt-1 text-[15px] font-semibold tabular-nums">{amount}</div>
      <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)] group-hover:text-[var(--color-brand-2)]">
        {count} invoice{count === 1 ? "" : "s"}
        {share !== undefined && <span className="float-right font-semibold tabular-nums text-[var(--color-ink-2)]">{share}%</span>}
      </div>
    </Link>
  );
}

/**
 * Monthly collection performance (owner, 26 Oct 2026): what came in each of
 * the last twelve months, as bars with their figures; the last full month
 * against the one before it, and this month so far against the same days of
 * last month (monthToDate). No collection target is kept anywhere, so none is
 * drawn — a target line made up here would be a figure nobody set.
 */
function MonthlyCollection({
  points,
  undated,
  mtd,
  cur,
}: {
  points: Array<{ month: string; amount: number }>;
  undated: number;
  mtd: { now: number; before: number; change: number | null; previousMonth: string };
  cur: string | null;
}) {
  const max = Math.max(...points.map((p) => p.amount), 1);
  const [prev, last] = points.slice(-3, -1);
  const growth = prev && last && prev.amount > 0.01 ? Math.round(((last.amount - prev.amount) / prev.amount) * 1000) / 10 : null;
  const dated = points.some((p) => p.amount > 0.01);
  return (
    <section className="rounded-2xl border border-[var(--color-line)] bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Monthly collection performance</Eyebrow>
        <span className="text-[10.5px] text-[var(--color-ink-3)]">receipts by receipt date · no collection target is set</span>
      </div>
      <div className="mt-2 grid gap-3 text-[11px] sm:grid-cols-3">
        <div>
          <div className="text-[var(--color-ink-3)]">This month so far</div>
          <div className="text-[15px] font-semibold tabular-nums">{money(mtd.now, cur)}</div>
          <div className="text-[var(--color-ink-3)]">
            {mtd.change === null
              ? `${monthName(mtd.previousMonth)}: none by this day`
              : `${mtd.change >= 0 ? "▲" : "▼"} ${Math.abs(mtd.change)}% vs same days of ${monthName(mtd.previousMonth)}`}
          </div>
        </div>
        {last && (
          <div>
            <div className="text-[var(--color-ink-3)]">{monthName(last.month)} (last full month)</div>
            <div className="text-[15px] font-semibold tabular-nums">{money(last.amount, cur)}</div>
            <div className={growth === null ? "text-[var(--color-ink-3)]" : growth >= 0 ? "text-[var(--color-ok-fg)]" : "text-[var(--color-bad-fg)]"}>
              {growth === null
                ? `nothing in ${prev ? monthName(prev.month) : "the month before"} to compare`
                : `${growth >= 0 ? "▲" : "▼"} ${Math.abs(growth)}% vs ${monthName(prev!.month)}`}
            </div>
          </div>
        )}
        <div>
          <div className="text-[var(--color-ink-3)]">Last 12 months</div>
          <div className="text-[15px] font-semibold tabular-nums">{money(points.reduce((s, p) => s + p.amount, 0), cur)}</div>
          {undated > 0.01 && <div className="text-[var(--color-warn-fg)]">+ {money(undated, cur)} with no receipt date</div>}
        </div>
      </div>
      {dated ? (
        <div className="mt-3 flex h-24 items-end gap-1" role="img" aria-label="Receipts by month, last 12 months">
          {points.map((p, n) => (
            <div key={p.month} className="flex min-w-0 flex-1 flex-col items-center gap-0.5" title={`${monthName(p.month)}: ${money(p.amount, cur)}`}>
              <div
                className={`w-full rounded-t ${n === points.length - 1 ? "bg-[#9cc5c0]" : "bg-[var(--color-accent)]"}`}
                style={{ height: `${Math.max((p.amount / max) * 80, p.amount > 0.01 ? 2 : 0)}px` }}
              />
              <div className="truncate text-[9px] text-[var(--color-ink-3)]">{monthName(p.month).slice(0, 3)}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">No receipt in the last 12 months carries a date, so there is nothing to chart by month.</p>
      )}
    </section>
  );
}
