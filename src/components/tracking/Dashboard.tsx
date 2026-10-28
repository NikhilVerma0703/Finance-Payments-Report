// The dashboard: the hero figures and what lies ahead, per
// currency and never across it — adding a USD balance to a EUR one produces
// the only kind of number a receivables figure must not be.
//
// Drawn as the Production overview draws its deck (owner, 28 Oct 2026: "make
// the dashboard UI/UX exceptional … add only useful data points … use the same
// brand guidelines as the production overview dashboard"), and led by what
// the office reads it for ("our main objective in the dashboard is not to see
// what is collected but what is overdue, outstanding, total"):
//
//   * Dashboard — two glass hero tiles, where that page has "Today" and "The
//     running shift": RECEIVABLES (one ring of everything invoiced — what came
//     in pale, what is still owed in teal, what is past due in red, what nobody
//     can date in amber — beside a row each for the total, the outstanding, the
//     overdue, what falls due in 30 days and what has no due date) and OVERDUE
//     (the money past due, how late it is span by span, and the customers it
//     is owed by). The six KPI tiles, the gauge and the ten-figure key-figures
//     panel that stood here said the same things several times over; each
//     figure now appears once, where it is read, and rests with its words for
//     the hover bubble;
//   * AgeingSummary — what lies ahead: the week-by-week strip (the Pulse's
//     tiles, for money), the biggest balances and every invoice's status;
//   * Collections — what came in, this month against last and twelve months
//     of it, a card further down the page.
//
// Overdue still prints its own denominator: it can only be computed for
// invoices whose due date could be established, so what has no due date is an
// arc and a row of its own rather than hidden.
//
// With several currencies each part shows the one with the largest balance
// open and folds the others to a line of their headline figures, one click
// from open. Money with no currency recorded comes last. Every row, bar, tile
// and status opens Search Invoices on those invoices, inside the filters in
// force.
import Link from "next/link";
import type { ReactNode } from "react";

import { ACCENT, Chip, GOOD, LinkOr, Meter, Num, TEAL, WorkingFold, iv } from "@/components/dash/viz";
import { ROUTES } from "@/lib/routes";
import { HOME_CURRENCY } from "@/lib/money";
import { NO_DUE_DATE, NOT_YET_DUE } from "@/lib/payments/money";
import type { OnAccountEntry } from "@/lib/payments/onAccount";
import { dueByWeek, keyFigures, monthToDate, receiptsByMonth, receivedByWeek, type KeyFigures, type MonthPoint } from "@/lib/payments/overview";
import { STATUS_LABELS, STATUS_TONE, type TrackedInvoice, type TrackingStatus } from "@/lib/payments/record";
import { toQuery as filterQuery, type CustomerSummary, type TrackingFilters, type TrackingKpis } from "@/server/payments/query";
import { day, homeMoney, money } from "./bits";
import { compactMoney, Eyebrow, TILE, TopBalances, WeekByWeek } from "./Overview";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

const inCurrency = <T extends { currency: string | null }>(rows: T[], currency: string) => rows.filter((r) => (r.currency ?? "—") === currency);

/** The currencies in the order they are drawn: by balance, as kpisFrom sorts
 *  them, with "no currency recorded" last — it is a gap to fill, not a book. */
function mainFirst(kpis: TrackingKpis[]): TrackingKpis[] {
  return [...kpis.filter((k) => k.currency !== "—"), ...kpis.filter((k) => k.currency === "—")];
}

/** The last day of a YYYY-MM month. */
const monthEnd = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** A share of a whole, to one decimal under 10%, whole above. */
function share(part: number, whole: number): number {
  if (whole <= 0.01) return 0;
  const p = (part / whole) * 100;
  return p < 10 ? Math.round(p * 10) / 10 : Math.round(p);
}

// The arcs and keys of the receivables ring, in the deck's palette: red for
// money past due, amber for money nobody can date, the brand teal light and
// deep for what falls due soon and later, and a pale track for what came in.
const ARC = { overdue: "#dc2626", soon: TEAL[300], later: TEAL[500], nodate: "#d97706", collected: "#e5e7eb" } as const;
/** The overdue spans, paler to deeper red as the money gets older. */
const LATE = ["#f87171", "#ef4444", "#dc2626", "#b91c1c", "#991b1b", "#7f1d1d"];

export function Dashboard({
  kpis,
  today,
  invoices,
  receiptsFrom,
  onAccount,
  filters = {},
}: {
  kpis: TrackingKpis[];
  today: string;
  /** The invoices the KPIs were worked out from. */
  invoices: TrackedInvoice[];
  /** Every invoice in view, cleared ones too, for the key figures — the KPIs
   *  may be over the pending invoices alone. Defaults to `invoices`. */
  receiptsFrom?: TrackedInvoice[];
  onAccount: OnAccountEntry[];
  /** The filters in force, carried into every drill-down link. */
  filters?: TrackingFilters;
}) {
  if (!kpis.length) return null;

  // The one figure that can be added across currencies: each invoice at its
  // own exchange rate. Shown only when more than one currency is in play, and
  // always with how many invoices it covers — a rupee total built from a third
  // of the rates is not the book.
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

  /** Search Invoices on these invoices, inside the filters already applied. */
  const drill = (extra: Record<string, string>) => `${ROUTES.search}?${filterQuery({ ...filters, sort: undefined, dir: undefined }, extra)}`;
  const ordered = mainFirst(kpis);

  return (
    <div className="flex flex-col gap-4">
      {ordered.map((k, index) => {
        const cur = k.currency === "—" ? null : k.currency;
        const figures = keyFigures(inCurrency(receiptsFrom ?? invoices, k.currency), inCurrency(onAccount, k.currency), today);

        return (
          <CurrencyBlock
            key={k.currency}
            several={ordered.length > 1}
            open={index === 0}
            head={
              <Eyebrow>
                {cur ?? "No currency recorded"} · {k.invoices} invoice(s) · {k.customers} customer(s)
              </Eyebrow>
            }
            folded={
              <>
                total <strong className="tabular text-gray-900">{money(k.totalInvoiceValue, cur)}</strong>
                {" · "}outstanding <strong className="tabular text-gray-900">{money(k.totalOutstanding, cur)}</strong>
                {k.overdueOutstanding > 0.01 && (
                  <>
                    {" · "}overdue <strong className="tabular text-red-700">{money(k.overdueOutstanding, cur)}</strong>
                  </>
                )}
              </>
            }
          >
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:gap-5">
              <div className="min-w-0 xl:col-span-7">
                <ReceivablesHero k={k} cur={cur} figures={figures} today={today} drill={drill} />
              </div>
              <div className="min-w-0 xl:col-span-5">
                <OverdueHero k={k} cur={cur} figures={figures} invoices={inCurrency(invoices, k.currency)} drill={drill} />
              </div>
            </div>
          </CurrencyBlock>
        );
      })}

      {kpis.length > 1 && home.known > 0 && (
        <div className="dash-glass flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-xl px-4 py-2.5 text-xs text-gray-600">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">All currencies, in {HOME_CURRENCY}</span>
          <span>
            total <strong className="tabular text-gray-900">{homeMoney(home.invoiced)}</strong>
          </span>
          <span>
            outstanding <strong className="tabular text-gray-900">{homeMoney(home.outstanding)}</strong>
          </span>
          <span>
            received <strong className="tabular text-gray-900">{homeMoney(home.received)}</strong>
          </span>
          <span className="text-gray-500">
            each invoice at its own rate · {home.known} of {home.invoices} invoice(s) carry one
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The receivables hero: total, outstanding, overdue
// ---------------------------------------------------------------------------

/** One row beside a hero's ring: a label, its figure and words, a meter — the whole row opens those invoices. */
function HeroRow({
  href,
  dot,
  label,
  figure,
  figureTip,
  sub,
  meter,
  tone = "text-gray-900",
  big = false,
  i,
}: {
  href: string | null;
  dot?: string;
  label: string;
  figure: string;
  figureTip: string;
  sub?: ReactNode;
  meter?: { value: number; max: number; color: string; label: string };
  tone?: string;
  /** One of the three headline figures: total, outstanding, overdue. */
  big?: boolean;
  i: number;
}) {
  return (
    <LinkOr href={href} className={`-m-0.5 block rounded-xl ${big ? "p-2.5" : "px-2.5 py-1.5"} ${href ? "transition hover:bg-gray-50" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`flex items-center gap-1.5 ${big ? "text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-600" : "text-xs text-gray-600"}`}>
          {dot && <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} aria-hidden />}
          {label}
        </span>
        <Num tip={figureTip} className={`tabular font-semibold tracking-tight ${big ? "text-xl sm:text-2xl" : "text-[13px]"} ${tone}`}>
          {figure}
        </Num>
      </div>
      {meter && <Meter value={meter.value} max={Math.max(meter.max, 1)} color={meter.color} track={TEAL[100]} h={big ? 6 : 4} i={i} label={meter.label} className="mt-1.5" />}
      {sub && <div className="tabular mt-1 text-[11px] text-gray-600">{sub}</div>}
    </LinkOr>
  );
}

/** A ring of segments that add up to the whole: everything invoiced, by where it stands. */
function SegRing({ segs, label, tip, children }: { segs: Array<{ key: string; amount: number; color: string }>; label: string; tip: string; children: ReactNode }) {
  const size = 220;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segs.reduce((s, x) => s + x.amount, 0);
  // a hair between arcs, so two of a ramp read as two
  const gap = segs.filter((s) => s.amount > 0.01).length > 1 ? 3 : 0;
  let at = 0;
  return (
    <Num as="div" tip={tip} className="relative mx-auto grid aspect-square w-[176px] shrink-0 place-items-center sm:w-[200px] xl:w-[220px]">
      <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TEAL[100]} strokeWidth={stroke} />
        {total > 0.01 &&
          segs
            .filter((s) => s.amount > 0.01)
            .map((s, n) => {
              const len = (s.amount / total) * c;
              const arc = (
                <circle
                  key={s.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${Math.max(len - gap, 0.5)} ${c}`}
                  strokeDashoffset={-at}
                  className="dash-reveal"
                  style={iv(n)}
                />
              );
              at += len;
              return arc;
            })}
      </svg>
      <div className="relative grid place-items-center text-center leading-tight">{children}</div>
    </Num>
  );
}

function ReceivablesHero({
  k,
  cur,
  figures,
  today,
  drill,
}: {
  k: TrackingKpis;
  cur: string | null;
  figures: KeyFigures;
  today: string;
  drill: (extra: Record<string, string>) => string;
}) {
  const here = { currency: k.currency };
  const total = Math.max(k.totalInvoiceValue, 0);
  const owed = Math.max(k.totalOutstanding, 0);
  const overdue = Math.min(k.overdueOutstanding, owed);
  const noDate = Math.min(Math.max(owed - k.assessable, 0), owed - overdue);
  const soon = Math.min(figures.dueSoon.amount, Math.max(owed - overdue - noDate, 0));
  const later = Math.max(owed - overdue - noDate - soon, 0);
  // the ring is the whole book: what came in is its pale part
  const collected = Math.max(total - owed, 0);
  const net = k.totalOutstanding - k.onAccount.net;

  return (
    <div className={`${TILE} dash-glint h-full`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Receivables · total, outstanding, overdue</Eyebrow>
          <p className="text-xs text-gray-600">
            {cur ?? "No currency recorded"} ·{" "}
            <Num tip="invoices in view the figures are worked out from">{k.invoices}</Num> invoice(s) ·{" "}
            <Num tip="customers with those invoices">{k.customers}</Num> customer(s)
            {k.forexGainLoss !== null && (
              <>
                {" · "}forex{" "}
                <Num
                  tip={`exchange gain or loss on the receipts so far, in ${HOME_CURRENCY}: each receipt's rate against its invoice's`}
                  className={`font-semibold ${k.forexGainLoss >= 0 ? "text-emerald-700" : "text-red-700"}`}
                >
                  {k.forexGainLoss >= 0 ? "gain" : "loss"} {homeMoney(Math.abs(k.forexGainLoss))}
                </Num>
              </>
            )}
          </p>
        </div>
        <WorkingFold label="total, outstanding and overdue">
          <p>
            <b>Total.</b> The invoice value of every invoice in view.
          </p>
          <p className="mt-2">
            <b>Outstanding.</b> Each invoice&apos;s value less its receipts and credit notes, plus debit notes.
          </p>
          <p className="mt-2">
            <b>Overdue.</b> The part of the outstanding whose own due date has passed — portion by portion where the terms split an invoice, so 30% due
            now and 70% in ninety days are counted apart.
          </p>
          <p className="mt-2">
            <b>No due date.</b> Money on invoices whose terms, or the date they count from (usually the BL date), are not recorded — nobody can say
            whether it is late.
          </p>
        </WorkingFold>
      </div>

      <div className="dash-cq mt-3">
        <div className="dash-hero">
          <SegRing
            label={`Total ${money(total, cur)}: ${money(overdue, cur)} overdue, ${money(soon + later, cur)} not yet due, ${money(noDate, cur)} with no due date, ${money(collected, cur)} received`}
            tip={`${money(total, cur)} invoiced: red is past due, teal not yet due (light within 30 days), amber has no due date, grey has been received`}
            segs={[
              { key: "overdue", amount: overdue, color: ARC.overdue },
              { key: "soon", amount: soon, color: ARC.soon },
              { key: "later", amount: later, color: ARC.later },
              { key: "nodate", amount: noDate, color: ARC.nodate },
              { key: "collected", amount: collected, color: ARC.collected },
            ]}
          >
            <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-600">outstanding</span>
            <span className="tabular block text-4xl font-semibold tracking-tight text-gray-900 xl:text-[44px] xl:leading-[1.05]">{compactMoney(owed, cur)}</span>
            <span className="tabular mt-1 block text-xs text-gray-600">of {compactMoney(total, cur)} total</span>
            {overdue > 0.01 ? (
              <span className="tabular mt-1.5 inline-block rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-inset ring-red-600/20">
                ▲ {share(overdue, owed)}% overdue
              </span>
            ) : (
              <span className="mt-1.5 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                ✓ nothing overdue
              </span>
            )}
          </SegRing>

          <div className="min-w-0 space-y-1">
            <HeroRow
              big
              i={1}
              href={drill({ ...here })}
              label="Total invoiced"
              figure={money(total, cur)}
              figureTip="the invoice value of every invoice in view"
              sub={
                <>
                  <Num tip="invoices in view">{k.invoices}</Num> invoice(s) · <Num tip="every receipt on these invoices">{money(k.totalReceived, cur)}</Num> received ({k.collectionRate}%)
                </>
              }
            />
            <HeroRow
              big
              i={2}
              href={drill({ open: "1", ...here })}
              dot={ARC.later}
              label="Outstanding"
              figure={money(owed, cur)}
              figureTip="invoice value less receipts and credit notes, plus debit notes"
              tone="text-brand-600"
              meter={{ value: owed, max: total, color: ACCENT, label: "Outstanding, of the total" }}
              sub={
                <>
                  {share(owed, total)}% of the total · <Num tip="customers who owe">{k.customers}</Num> customer(s)
                  {k.onAccount.entries > 0 && (
                    <>
                      {" · "}
                      <Num tip="outstanding less the money customers paid on account that is not yet put against an invoice">{money(net, cur)}</Num> net of money on account
                    </>
                  )}
                </>
              }
            />
            <HeroRow
              big
              i={3}
              href={overdue > 0.01 ? drill({ status: "OVERDUE", ...here }) : null}
              dot={ARC.overdue}
              label="Overdue"
              figure={money(overdue, cur)}
              figureTip="the part of the outstanding whose own due date has passed"
              tone={overdue > 0.01 ? "text-red-700" : "text-gray-900"}
              meter={{ value: overdue, max: owed, color: ARC.overdue, label: "Overdue, of what is outstanding" }}
              sub={
                overdue > 0.01 ? (
                  <>
                    {share(overdue, owed)}% of the outstanding · <Num tip="invoices with money past their due date">{k.overdueInvoices}</Num> invoice(s)
                  </>
                ) : (
                  "nothing is past its due date"
                )
              }
            />
            <div className="grid gap-x-3 pt-1 sm:grid-cols-2">
              <HeroRow
                i={4}
                href={soon > 0.01 ? drill({ dateField: "due", from: today, to: figures.dueSoon.to, open: "1", ...here }) : null}
                dot={ARC.soon}
                label="Due in 30 days"
                figure={money(soon, cur)}
                figureTip={`portions falling due from today to ${figures.dueSoon.to}, on ${figures.dueSoon.invoices} invoice(s)`}
              />
              {noDate > 0.01 ? (
                <HeroRow
                  i={5}
                  href={drill({ verify: "1", ...here })}
                  dot={ARC.nodate}
                  label="No due date"
                  figure={money(noDate, cur)}
                  figureTip={`owed on ${k.requiresVerificationInvoices} invoice(s) whose payment terms, or the date they count from, are not recorded`}
                  tone="text-amber-700"
                />
              ) : (
                <HeroRow i={5} href={null} dot={ARC.later} label="Due later" figure={money(later, cur)} figureTip="what falls due after the next 30 days" />
              )}
            </div>
          </div>
        </div>
      </div>

      {k.homeRatesKnown > 0 && (
        <div className="tabular mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-gray-200/70 pt-2.5 text-[11px] text-gray-600">
          <span className="font-semibold uppercase tracking-[0.14em] text-gray-500">In {HOME_CURRENCY}</span>
          <span>
            total <span className="font-semibold text-gray-900">{homeMoney(k.homeInvoiceValue)}</span>
          </span>
          <span>
            outstanding <Num tip="what is outstanding, each invoice at its own exchange rate" className="font-semibold text-gray-900">{homeMoney(k.homeOutstanding)}</Num>
          </span>
          <span className="text-gray-500">
            {k.homeRatesKnown} of {k.invoices} invoice(s) carry a rate
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The overdue hero: how much, how late, owed by whom
// ---------------------------------------------------------------------------

function OverdueHero({
  k,
  cur,
  figures,
  invoices,
  drill,
}: {
  k: TrackingKpis;
  cur: string | null;
  figures: KeyFigures;
  /** The invoices of this currency the KPIs were worked out from. */
  invoices: TrackedInvoice[];
  drill: (extra: Record<string, string>) => string;
}) {
  const here = { currency: k.currency };
  const owed = Math.max(k.totalOutstanding, 0);
  const late = invoices.filter((i) => i.schedule.overdueAmount > 0.01);
  const overdue = late.reduce((s, i) => s + i.schedule.overdueAmount, 0);

  // the overdue money by how late its invoice is — the ageing's own spans,
  // in their order, and only the past-due part of each invoice, so the spans
  // add up to the figure above them
  const order = k.ageingSummary.buckets.map((b) => b.label).filter((l) => l !== NOT_YET_DUE && l !== NO_DUE_DATE);
  const spans = order.map((label) => {
    const list = late.filter((i) => i.ageing === label);
    return { label, amount: list.reduce((s, i) => s + i.schedule.overdueAmount, 0), invoices: list.length };
  });
  const spanMax = Math.max(...spans.map((s) => s.amount), 1);

  // who it is owed by, the most first
  const byCustomer = new Map<string, { id: string | null; name: string; amount: number; invoices: number; days: number }>();
  for (const i of late) {
    const key = i.customerId ?? `~${i.customerName ?? ""}`;
    const row = byCustomer.get(key) ?? { id: i.customerId, name: i.customerName ?? "No customer recorded", amount: 0, invoices: 0, days: 0 };
    row.amount += i.schedule.overdueAmount;
    row.invoices += 1;
    row.days = Math.max(row.days, i.overdueDays ?? 0);
    byCustomer.set(key, row);
  }
  const who = [...byCustomer.values()].sort((a, b) => b.amount - a.amount);

  return (
    <div className={`${TILE} flex h-full flex-col`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Overdue · what is late</Eyebrow>
          <p className="text-xs text-gray-600">past its due date, by how late and by whom</p>
        </div>
        <WorkingFold label="the overdue money">
          <p>
            Only the part of each invoice whose own due date has passed — a split payment term is counted portion by portion — put in the span its
            invoice&apos;s days overdue fall in, so the spans add up to the figure above them.
          </p>
          <p className="mt-2">
            <b>Days late on average.</b> Each overdue invoice&apos;s days past its due date, weighted by how much of it is overdue.
          </p>
        </WorkingFold>
      </div>

      {late.length === 0 ? (
        <div className="mt-6 flex flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-emerald-50/70 p-6 text-center ring-1 ring-inset ring-emerald-600/15">
          <span className="text-3xl text-emerald-600" aria-hidden>
            ✓
          </span>
          <p className="text-sm font-medium text-emerald-800">Nothing is past its due date.</p>
          <p className="text-xs text-emerald-700">Every portion still owed falls due later — or has no due date to judge it by.</p>
        </div>
      ) : (
        <>
          <LinkOr href={drill({ status: "OVERDUE", ...here })} className="mt-2 block rounded-xl p-1 transition hover:bg-gray-50">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Num tip="the part of the outstanding whose own due date has passed" className="tabular text-[32px] font-semibold leading-tight tracking-tight text-red-700">
                {money(overdue, cur)}
              </Num>
              <span className="text-xs text-gray-600">past due</span>
            </div>
            <Meter value={overdue} max={Math.max(owed, overdue, 1)} color="#dc2626" track="#fee2e2" h={8} i={1} label="Overdue, of what is outstanding" className="mt-1.5" />
            <div className="tabular mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-gray-600">
              <span>
                <b className="text-gray-900">{share(overdue, owed)}%</b> of the outstanding
              </span>
              <Num tip="invoices with money past their due date">{late.length} invoice(s)</Num>
              <Num tip="customers who owe money past its due date">{who.length} customer(s)</Num>
              {figures.avgDaysOverdue !== null && (
                <Num tip="each overdue invoice's days past its due date, weighted by how much of it is overdue" className="font-medium text-red-700">
                  {figures.avgDaysOverdue} days late on average
                </Num>
              )}
            </div>
          </LinkOr>

          <div className="mt-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">How late</div>
            <ul className="space-y-0.5">
              {spans.map((s, n) => (
                <li key={s.label}>
                  <LinkOr
                    href={s.amount > 0.01 ? drill({ ageing: s.label, ...here }) : null}
                    className={`grid grid-cols-[5.75rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg px-1.5 py-1 text-xs ${s.amount > 0.01 ? "transition hover:bg-gray-50" : "opacity-55"}`}
                  >
                    <span className="truncate text-gray-700">{s.label}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-red-50" aria-hidden>
                      <span className="dash-grow-x block h-full rounded-full" style={iv(n, { width: `${(s.amount / spanMax) * 100}%`, background: LATE[Math.min(n, LATE.length - 1)] })} />
                    </span>
                    <Num tip={`past due on ${s.invoices} invoice(s) ${s.label.toLowerCase()} overdue`} className="tabular text-right font-semibold text-gray-900">
                      {money(s.amount, cur)}
                      <span className="ml-1.5 font-normal text-gray-500">{share(s.amount, overdue)}%</span>
                    </Num>
                  </LinkOr>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Owed by</div>
            <ul className="space-y-0.5">
              {who.slice(0, 4).map((c) => (
                <li key={c.id ?? c.name}>
                  <LinkOr
                    href={c.id ? ROUTES.customer(c.id) : null}
                    className={`flex items-baseline justify-between gap-2 rounded-lg px-1.5 py-1 text-xs ${c.id ? "transition hover:bg-gray-50" : ""}`}
                  >
                    <span className="min-w-0 truncate font-medium text-gray-900">{c.name}</span>
                    <span className="tabular shrink-0 text-gray-600">
                      <Num tip={`past due from ${c.name}, on ${c.invoices} invoice(s)`} className="font-semibold text-red-700">
                        {money(c.amount, cur)}
                      </Num>{" "}
                      · {c.days} d
                    </span>
                  </LinkOr>
                </li>
              ))}
            </ul>
            {who.length > 4 && <p className="mt-1 px-1.5 text-[11px] text-gray-500">and {who.length - 4} more customer(s) — every one is in the follow-ups below.</p>}
          </div>

          {figures.largestOverdue && (
            <LinkOr
              href={ROUTES.invoice(figures.largestOverdue.id)}
              className="group mt-auto flex items-center gap-3 border-t border-gray-200/70 pt-3 text-xs text-gray-600"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">Largest</span>
              <span className="font-semibold text-brand-500">{figures.largestOverdue.invoiceNo ?? "no number"}</span>
              <span className="min-w-0 truncate">{figures.largestOverdue.customer ?? ""}</span>
              <Num tip="the invoice with the most money past its due date" className="tabular ml-auto shrink-0 font-semibold text-red-700">
                {money(figures.largestOverdue.amount, cur)}
              </Num>
              <span className="text-gray-500 transition group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden>
                →
              </span>
            </LinkOr>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One currency's part of a section
// ---------------------------------------------------------------------------

/**
 * Alone, a currency is drawn as it is. With several, each is a <details> — the
 * first open, the rest folded to their heading and a line of figures — so
 * nothing is hidden more than a click away and no client code is needed.
 */
function CurrencyBlock({
  several,
  open,
  head,
  folded,
  children,
}: {
  several: boolean;
  open: boolean;
  head: ReactNode;
  /** What the folded line says beside the heading. */
  folded: ReactNode;
  children: ReactNode;
}) {
  if (!several) return <>{children}</>;
  return (
    <details open={open} className="group/cur">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg px-1 py-1 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
        <span className="text-xs text-gray-500 transition-transform group-open/cur:rotate-90" aria-hidden>
          ▸
        </span>
        <div className="min-w-0">{head}</div>
        <span className="text-xs text-gray-600 group-open/cur:hidden">{folded}</span>
        <span className="ml-auto text-xs font-medium text-brand group-open/cur:hidden">Show</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// What lies ahead
// ---------------------------------------------------------------------------

/**
 * What lies ahead, per currency: the week-by-week strip, the biggest balances,
 * and every invoice's status with the ageing's few figures the heroes do not
 * carry — each a drill-down into Search Invoices. A link from the "no
 * currency" group carries currency "—", which the filter reads as "no
 * currency recorded".
 */
export function AgeingSummary({
  kpis,
  filters = {},
  invoices,
  receiptsFrom,
  onAccount = [],
  customers,
  today,
}: {
  kpis: TrackingKpis[];
  /** The filters in force, carried into every drill-down link. */
  filters?: TrackingFilters;
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

  const drill = (extra: Record<string, string>) => `${ROUTES.search}?${filterQuery({ ...filters, sort: undefined, dir: undefined }, extra)}`;
  const ordered = mainFirst(kpis);

  return (
    <div className="flex flex-col gap-6">
      {ordered.map((k, index) => {
        const a = k.ageingSummary;
        const cur = k.currency === "—" ? null : k.currency;
        const weeks = dueByWeek(inCurrency(invoices, k.currency), today);
        const received = receivedByWeek(inCurrency(receiptsFrom ?? invoices, k.currency), inCurrency(onAccount, k.currency), today);
        const figures = keyFigures(inCurrency(receiptsFrom ?? invoices, k.currency), inCurrency(onAccount, k.currency), today);

        return (
          <CurrencyBlock
            key={k.currency}
            several={ordered.length > 1}
            open={index === 0}
            head={<Eyebrow>What lies ahead · {cur ?? "No currency recorded"}</Eyebrow>}
            folded={
              <>
                {a.openInvoices} open invoice(s) · <strong className="tabular text-gray-900">{money(a.totalOutstanding, cur)}</strong> outstanding
              </>
            }
          >
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12 xl:gap-5">
              <div className="min-w-0 xl:col-span-8">
                <WeekByWeek due={weeks} received={received} currency={k.currency} filters={filters} />
              </div>
              <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
                <TopBalances rows={customers} currency={k.currency} topThree={figures.topThree} />
                <StatusCard k={k} cur={cur} figures={figures} drill={drill} />
              </div>
            </div>
          </CurrencyBlock>
        );
      })}
    </div>
  );
}

/**
 * Every invoice's payment status as chips, and the ageing's figures the heroes
 * do not carry: what has had nothing at all received, the oldest open invoice
 * and how old the balance is.
 */
function StatusCard({ k, cur, figures, drill }: { k: TrackingKpis; cur: string | null; figures: KeyFigures; drill: (extra: Record<string, string>) => string }) {
  const a = k.ageingSummary;
  const here = { currency: k.currency };
  return (
    <div className={TILE}>
      <Eyebrow className="mb-2">Invoice status · {k.currency}</Eyebrow>
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.entries(k.statuses) as Array<[TrackingStatus, number]>)
          .sort((x, y) => y[1] - x[1])
          .map(([status, count]) => (
            <Link key={status} href={drill({ status, ...here })} className="transition hover:opacity-80">
              <Chip tone={STATUS_TONE[status]}>
                {STATUS_LABELS[status]} {count}
              </Chip>
            </Link>
          ))}
      </div>
      {a.nothingReceived.count > 0 && (
        <Link
          href={drill({ nilReceived: "1", open: "1", ...here })}
          className="mt-3 flex items-baseline justify-between gap-2 rounded-lg bg-red-50/60 px-2.5 py-1.5 text-[12px] text-red-800 ring-1 ring-inset ring-red-600/15 transition hover:bg-red-50"
        >
          <span>
            <b className="tabular">{a.nothingReceived.count}</b> open invoice(s) with nothing received
          </span>
          <span className="tabular font-semibold">{money(a.nothingReceived.amount, cur)}</span>
        </Link>
      )}
      {(figures.oldestOpen || figures.avgOpenAge !== null) && (
        <dl className="mt-3 grid gap-x-4 gap-y-1.5 border-t border-gray-200/70 pt-3 text-[11px] sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {figures.oldestOpen && (
            <div className="min-w-0">
              <dt className="text-gray-500">Oldest open invoice</dt>
              <dd className="truncate">
                <Link href={ROUTES.invoice(figures.oldestOpen.id)} className="font-semibold text-brand hover:underline">
                  {figures.oldestOpen.invoiceNo ?? "no number"}
                </Link>{" "}
                <span className="tabular text-gray-700">· {figures.oldestOpen.days} days old</span>
              </dd>
            </div>
          )}
          {figures.avgOpenAge !== null && (
            <div>
              <dt className="text-gray-500">Average age of the balance</dt>
              <dd>
                <Num tip="each open invoice's days since its invoice date, weighted by what it still owes" className="tabular font-semibold text-gray-900">
                  {figures.avgOpenAge} days
                </Num>
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collections — what came in, further down the page
// ---------------------------------------------------------------------------

/** A signed change as the deck's DeltaChip draws one: glyph, words, never colour alone. */
function Change({ pct, against, tip }: { pct: number | null; against: string; tip: string }) {
  const tone =
    pct === null || pct === 0 ? "bg-gray-50 text-gray-600 ring-gray-500/20" : pct > 0 ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-red-50 text-red-700 ring-red-600/20";
  const text = pct === null ? `nothing to compare ${against}` : pct === 0 ? `no change ${against}` : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% ${against}`;
  return (
    <Num tip={tip} className={`tabular inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone}`}>
      {text}
    </Num>
  );
}

/**
 * What came in, per currency: this month so far against the same days of last
 * month, the twelve months as bars, how fast and how punctually customers pay,
 * and the month before. Every receipt counts, on cleared invoices too, and
 * money booked on account. No collection target is kept anywhere, so none is
 * drawn.
 */
export function Collections({
  kpis,
  today,
  receiptsFrom,
  onAccount,
  filters = {},
}: {
  kpis: TrackingKpis[];
  today: string;
  /** Every invoice in view, cleared ones too: a receipt on an invoice since cleared is still money that came in. */
  receiptsFrom: TrackedInvoice[];
  onAccount: OnAccountEntry[];
  filters?: TrackingFilters;
}) {
  if (!kpis.length) return null;
  const drill = (extra: Record<string, string>) => `${ROUTES.search}?${filterQuery({ ...filters, sort: undefined, dir: undefined }, extra)}`;
  const ordered = mainFirst(kpis);
  return (
    <div className="flex flex-col gap-4">
      {ordered.map((k, index) => {
        const cur = k.currency === "—" ? null : k.currency;
        const list = inCurrency(receiptsFrom, k.currency);
        const held = inCurrency(onAccount, k.currency);
        const months = receiptsByMonth(list, held, today);
        return (
          <CurrencyBlock
            key={k.currency}
            several={ordered.length > 1}
            open={index === 0}
            head={<Eyebrow>Collections · {cur ?? "No currency recorded"}</Eyebrow>}
            folded={<>{money(monthToDate(list, held, today).now, cur)} this month</>}
          >
            <CollectionsCard
              k={k}
              cur={cur}
              points={months.points}
              undated={months.undated}
              mtd={monthToDate(list, held, today)}
              figures={keyFigures(list, held, today)}
              today={today}
              drill={drill}
            />
          </CurrencyBlock>
        );
      })}
    </div>
  );
}

function CollectionsCard({
  k,
  cur,
  points,
  undated,
  mtd,
  figures,
  today,
  drill,
}: {
  k: TrackingKpis;
  cur: string | null;
  points: MonthPoint[];
  undated: number;
  mtd: { now: number; before: number; change: number | null; previousMonth: string };
  figures: KeyFigures;
  today: string;
  drill: (extra: Record<string, string>) => string;
}) {
  const here = { currency: k.currency };
  const dayOfMonth = Number(today.slice(8, 10));
  const monthIdx = Number(today.slice(5, 7)) - 1;
  const max = Math.max(...points.map((p) => p.amount), 1);
  const [prev, last] = points.slice(-3, -1);
  const growth = prev && last && prev.amount > 0.01 ? Math.round(((last.amount - prev.amount) / prev.amount) * 1000) / 10 : null;
  const dated = points.some((p) => p.amount > 0.01);
  const fy = figures.financialYear;
  const year = points.reduce((s, p) => s + p.amount, 0);

  return (
    <div className={`${TILE} flex h-full flex-col`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Collections · {k.currency}</Eyebrow>
          <p className="tabular text-xs text-gray-600">
            {MONTHS_LONG[monthIdx]} 1–{dayOfMonth} · every dated receipt, money on account included · no collection target is set
          </p>
        </div>
        <WorkingFold label="the collections">
          <p>
            <b>This month.</b> Every receipt dated from the 1st to today, on any invoice in view — cleared ones too — and money booked on account.
            Against it, the same days of last month.
          </p>
          <p className="mt-2">
            <b>Days to collect.</b> For each paid invoice, the days from its invoice date to its last receipt, averaged; a payment in advance counts as 0.
          </p>
          <p className="mt-2">
            <b>Paid on time.</b> Of the paid invoices with a due date, how many had their last receipt on or before it.
          </p>
        </WorkingFold>
      </div>

      <LinkOr
        href={mtd.now > 0.01 ? drill({ dateField: "receipt", from: `${today.slice(0, 8)}01`, to: today, ...here }) : null}
        className={`mt-2 block rounded-xl p-1 ${mtd.now > 0.01 ? "transition hover:bg-gray-50" : ""}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Num tip={`received from ${MONTHS_LONG[monthIdx]} 1 to today, by receipt date`} className="tabular text-2xl font-semibold tracking-tight text-gray-900">
            {money(mtd.now, cur)}
          </Num>
          <span className="text-xs text-gray-600">received this month</span>
          <span className="ml-auto">
            <Change
              pct={mtd.change}
              against={`vs ${monthName(mtd.previousMonth)} to day ${dayOfMonth}`}
              tip={`${money(mtd.now, cur)} this month so far against ${money(mtd.before, cur)} over the same days of ${monthName(mtd.previousMonth)}`}
            />
          </span>
        </div>
        <Meter value={mtd.now} max={Math.max(mtd.before, mtd.now, 1)} color={mtd.now >= mtd.before ? GOOD : ACCENT} track={TEAL[100]} h={6} i={1} label="This month so far against the same days of last month" className="mt-1.5" />
      </LinkOr>

      <div className="mt-3">
        <div className="mb-1 flex items-baseline justify-between text-[11px] text-gray-600">
          <span>Received · last 12 months</span>
          <Num tip="every dated receipt over the twelve months shown, this one so far included" className="tabular">
            {money(year, cur)}
          </Num>
        </div>
        {dated ? (
          <ol className="flex h-16 items-end gap-1" aria-label="Received by month, last 12 months">
            {points.map((p, n) => (
              <Num
                as="li"
                key={p.month}
                tip={`${money(p.amount, cur)} received in ${monthName(p.month)}${n === points.length - 1 ? " so far" : ""}`}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-0.5"
              >
                <span
                  className={`dash-grow-y w-full rounded-t ${n === points.length - 1 ? "bg-brand-300" : "bg-brand-500"}`}
                  style={iv(n, { height: `${Math.max((p.amount / max) * 48, p.amount > 0.01 ? 3 : 0)}px` })}
                  aria-hidden
                />
                <span className="text-[9px] text-gray-500">{MONTHS[Number(p.month.slice(5, 7)) - 1].slice(0, 1)}</span>
              </Num>
            ))}
          </ol>
        ) : (
          <p className="rounded-lg bg-gray-50 px-3 py-3 text-center text-[11px] text-gray-500">No receipt in the last 12 months carries a date, so there is nothing to chart by month.</p>
        )}
        {undated > 0.01 && (
          <p className="mt-1 text-[11px] text-amber-700">
            + <Num tip="receipts with no receipt date: they cannot be placed in a month">{money(undated, cur)}</Num> received with no date — not in these figures
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniStat
          label="Days to collect"
          value={figures.daysToCollect ? `${figures.daysToCollect.days}` : "—"}
          unit={figures.daysToCollect ? "days" : ""}
          tip={figures.daysToCollect ? `invoice date to last receipt, averaged over ${figures.daysToCollect.invoices} paid invoice(s)` : "no paid invoice with both dates yet"}
        />
        <MiniStat
          label="Paid on time"
          value={figures.onTime ? `${figures.onTime.pct}%` : "—"}
          unit={figures.onTime ? `${figures.onTime.paid}/${figures.onTime.of}` : ""}
          tone={!figures.onTime ? undefined : figures.onTime.pct >= 75 ? "text-emerald-700" : figures.onTime.pct >= 40 ? "text-amber-700" : "text-red-700"}
          tip={figures.onTime ? `${figures.onTime.paid} of ${figures.onTime.of} paid invoice(s) with a due date were cleared by it` : "no paid invoice with a due date yet"}
        />
        <MiniStat
          label={`In ${fy.label}`}
          value={compactMoney(fy.received, cur)}
          unit=""
          tip={`every dated receipt from ${day(fy.from)} to today; ${fy.lastYear > 0.01 ? `${money(fy.lastYear, cur)} over the same days last year` : "nothing over the same days last year"}`}
        />
      </div>

      {last && (
        <LinkOr
          href={last.amount > 0.01 ? drill({ dateField: "receipt", from: `${last.month}-01`, to: monthEnd(last.month), ...here }) : null}
          className="group mt-auto flex items-center gap-3 border-t border-gray-200/70 pt-3 text-xs text-gray-600"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">Last month</span>
          <span className="font-semibold text-brand-500">{monthName(last.month)}</span>
          <Num tip={`received in ${monthName(last.month)}, the last full month`} className="tabular font-semibold text-gray-900">
            {money(last.amount, cur)}
          </Num>
          {prev && (
            <span className={`tabular ${growth === null ? "text-gray-500" : growth >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {growth === null ? `nothing in ${monthName(prev.month)} to compare` : `${growth >= 0 ? "▲" : "▼"} ${Math.abs(growth)}% vs ${monthName(prev.month)}`}
            </span>
          )}
          {last.amount > 0.01 && (
            <span className="ml-auto text-gray-500 transition group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden>
              →
            </span>
          )}
        </LinkOr>
      )}
    </div>
  );
}

function MiniStat({ label, value, unit, tip, tone = "text-gray-900" }: { label: string; value: string; unit: string; tip: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-white/80 px-3 py-2 ring-1 ring-inset ring-gray-200">
      <div className="truncate text-[11px] text-gray-600">{label}</div>
      <div className="flex items-baseline gap-1">
        <Num tip={tip} className={`tabular text-base font-semibold ${tone}`}>
          {value}
        </Num>
        {unit && <span className="tabular text-[11px] text-gray-500">{unit}</span>}
      </div>
    </div>
  );
}
