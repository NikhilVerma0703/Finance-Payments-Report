/**
 * The dashboard: KPIs and the ageing summary, per currency and never across it,
 * because adding a USD balance to a EUR one produces the only kind of number a
 * receivables figure must not be.
 *
 * Overdue prints its own denominator: it can only be computed for invoices
 * whose due date could be established, so the tile says how much of the book it
 * covers and how much it cannot speak for.
 */
import Link from "next/link";

import { STATUS_LABELS, STATUS_TONE, type TrackingStatus } from "@/lib/payments/record";
import { HOME_CURRENCY } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { toQuery, type TrackingFilters, type TrackingKpis } from "@/server/payments/query";
import { homeMoney, kpiMoney, money, Tile, TONE_CLASS } from "./bits";

export function Dashboard({
  kpis,
  today,
  filters,
}: {
  kpis: TrackingKpis[];
  today: string;
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

  const drill = (extra: Record<string, string>) =>
    `${ROUTES.search}?${toQuery({ ...filters, sort: undefined, dir: undefined }, extra)}`;

  return (
    <div className="mb-6 space-y-7">
      {kpis.length > 1 && home.known > 0 && (
        <section className="rounded-xl border border-[#c6dcf3] bg-[var(--color-info-bg)] p-4">
          <h2 className="mb-2 text-[13px] font-semibold">
            All currencies, in {HOME_CURRENCY}
            <span className="ml-2 font-normal text-[var(--color-ink-3)]">
              each invoice at its own rate · {home.known} of {home.invoices} invoice(s) carry one
            </span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label={`Invoiced (${HOME_CURRENCY})`} value={kpiMoney(home.invoiced, HOME_CURRENCY)} />
            <Tile
              label={`Received (${HOME_CURRENCY})`}
              value={kpiMoney(home.received, HOME_CURRENCY)}
              tone="ok"
            />
            <Tile
              label={`Outstanding (${HOME_CURRENCY})`}
              value={kpiMoney(home.outstanding, HOME_CURRENCY)}
              tone="info"
            />
          </div>
        </section>
      )}

      {kpis.map((k) => {
        const coverage =
          k.totalOutstanding > 0.01 ? Math.round((k.assessable / k.totalOutstanding) * 100) : 100;
        const a = k.ageingSummary;

        return (
          <section key={k.currency}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[13px] font-semibold">
                {k.currency}
                <span className="ml-2 font-normal text-[var(--color-ink-3)]">
                  {k.invoices} invoice(s) · {k.customers} customer(s) · as at {today}
                </span>
              </h2>
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

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Tile label="Total invoice value" value={kpiMoney(k.totalInvoiceValue, k.currency)} />
              <Tile
                label="Total received"
                value={kpiMoney(k.totalReceived, k.currency)}
                sub={`${k.collectionRate}% collected`}
                tone={k.collectionRate >= 75 ? "ok" : k.collectionRate >= 40 ? "warn" : "bad"}
              />
              <Tile
                label="Total outstanding"
                value={kpiMoney(k.totalOutstanding, k.currency)}
                tone="info"
              />
              <Tile
                label="Overdue outstanding"
                value={kpiMoney(k.overdueOutstanding, k.currency)}
                sub={
                  <>
                    {k.overdueInvoices} invoice(s) · {money(k.assessable, k.currency)} assessable (
                    {coverage}%)
                    {k.requiresVerification > 0.01 && (
                      <>
                        {" · "}
                        <strong className="text-[var(--color-warn-fg)]">
                          {money(k.requiresVerification, k.currency)}
                        </strong>{" "}
                        no due date
                      </>
                    )}
                  </>
                }
                tone={k.overdueOutstanding > 0.01 ? "bad" : "plain"}
              />
              <Tile
                label="Needs attention"
                value={String(k.needsAttention)}
                sub={`${money(k.needsAttentionAmount, k.currency)} outstanding`}
                tone={k.needsAttention ? "warn" : "ok"}
              />
            </div>

            {k.homeRatesKnown > 0 && (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg border border-[var(--color-line)] bg-[#fbfdff] px-3 py-2 text-[11px]">
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

            {a.openInvoices > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-2)]">
                    Ageing summary
                  </h3>
                  <span className="text-[11px] text-[var(--color-ink-3)]">
                    {a.openInvoices} open invoice(s) · {money(a.totalOutstanding, k.currency)}{" "}
                    outstanding, each in one ageing bucket
                  </span>
                </div>
                <div className="flex flex-wrap items-stretch gap-3">
                  <AgeingCard
                    label="Nothing received"
                    count={a.nothingReceived.count}
                    amount={kpiMoney(a.nothingReceived.amount, k.currency)}
                    href={drill({ nilReceived: "1", open: "1", currency: k.currency })}
                    tone="bad"
                  />
                  <div className="hidden w-px self-stretch bg-[var(--color-line)] sm:block" />
                  <div className="grid flex-1 grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
                    {a.buckets.map((b) => (
                      <AgeingCard
                        key={b.label}
                        label={b.label}
                        count={b.count}
                        amount={kpiMoney(b.amount, k.currency)}
                        href={drill({ ageing: b.label, currency: k.currency })}
                        tone={toneFor(b.label)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-1.5">
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
        );
      })}
    </div>
  );
}

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
  href,
  tone,
}: {
  label: string;
  count: number;
  amount: string;
  href: string;
  tone: "plain" | "warn" | "bad" | "info" | "ok";
}) {
  const bar: Record<string, string> = {
    plain: "bg-[var(--color-line)]",
    ok: "bg-[var(--color-ok-fg)]",
    info: "bg-[var(--color-info-fg)]",
    warn: "bg-[var(--color-warn-fg)]",
    bad: "bg-[var(--color-bad-fg)]",
  };
  const empty = count === 0;
  return (
    <Link
      href={href}
      className={`group relative min-w-[150px] overflow-hidden rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-3 transition-colors hover:border-[#a9c6e8] ${
        empty ? "opacity-60" : ""
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${bar[tone]}`} aria-hidden />
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
        {label}
      </div>
      <div className="mt-1 text-[15px] font-semibold tabular-nums">{amount}</div>
      <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)] group-hover:text-[var(--color-brand-2)]">
        {count} invoice{count === 1 ? "" : "s"}
      </div>
    </Link>
  );
}
