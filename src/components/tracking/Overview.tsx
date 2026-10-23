/**
 * The dashboard's overview: the pieces drawn above and around the KPI figures.
 *
 * Modelled on the production overview: a header that says what the page is as
 * at, a "needs attention" strip of things to act on, a gauge for the one ratio
 * that matters most, a strip of weeks instead of hours, and small multiples
 * rather than one crowded chart. Every number on it comes from the same
 * tracked invoices as the master table — nothing here is stored or estimated —
 * and everything that can be clicked opens the invoices behind it.
 *
 * Server components throughout; the only client code is the currency picker.
 */
import Link from "next/link";

import { currencySymbol } from "@/lib/money";
import { monthProgress, type MonthPoint, type WeekColumn } from "@/lib/payments/overview";
import { ROUTES } from "@/lib/routes";
import { toQuery, type CustomerSummary, type TrackingFilters } from "@/server/payments/query";
import { AutoSelect } from "./AutoSelect";
import { kpiMoney, money } from "./bits";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The small letter-spaced heading every panel opens with. */
export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-2)] ${className}`}>
      {children}
    </div>
  );
}

/** "$12.4k" — for a figure in a box too small for every digit. The title carries them all. */
export function compactMoney(n: number, currency: string | null): string {
  const sym = currencySymbol(currency);
  const body = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  return sym && sym.length <= 2 ? `${sym}${body}` : sym ? `${body} ${sym}` : body;
}

/** The time the page was worked out, in India time, as the ERP's screens state it. */
export function asAtTime(): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function OverviewHead({
  today,
  time,
  invoices,
  customers,
  receiptsThisMonth,
  currencies,
  filters,
  actions,
}: {
  today: string;
  time: string;
  invoices: number;
  customers: number;
  receiptsThisMonth: number;
  /** Every currency in the book, for the picker. */
  currencies: string[];
  filters: TrackingFilters;
  actions: React.ReactNode;
}) {
  const d = new Date(`${today}T00:00:00Z`);
  const dateLabel = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const month = monthProgress(today);
  // the picker keeps every other filter in force
  const keep = Object.entries(filters).filter(([k, v]) => v && k !== "currency");

  return (
    <header className="relative mb-5 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-white px-5 pb-5 pt-6 sm:px-6">
      <div
        className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[var(--color-accent)] via-[#3aa69c] to-[var(--color-brand-2)]"
        aria-hidden
      />
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
            <span className="h-2 w-2 rounded-full bg-[#22a06b] shadow-[0_0_0_3px_#d5f0e1]" aria-hidden />
            Live
          </div>
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight sm:text-[28px]">
            Receivables overview <span className="text-[var(--color-accent)]">· {dateLabel}</span>
          </h1>
          <p className="mt-1.5 text-[12px] text-[var(--color-ink-3)]">
            As at <strong className="text-[var(--color-ink-2)]">{time} IST</strong> · {invoices} invoice(s) ·{" "}
            {customers} customer(s) · every figure worked out from the records as they stand
          </p>
        </div>

        <div className="flex flex-wrap items-stretch gap-3">
          <div className="min-w-[200px] rounded-xl border border-[var(--color-line)] px-4 py-3">
            <Eyebrow>{MONTHS_LONG[d.getUTCMonth()]}</Eyebrow>
            <div className="mt-1 text-[15px] font-semibold">
              <span className="text-[var(--color-accent)]">Day {month.day}</span>
              <span className="font-normal text-[var(--color-ink-3)]"> of {month.days}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-[#e3eef0]">
              <div className="h-1.5 rounded-full bg-[var(--color-accent)]" style={{ width: `${month.pct}%` }} />
            </div>
            <div className="mt-1.5 text-[11px] text-[var(--color-ink-3)]">
              {receiptsThisMonth} receipt(s) booked this month
            </div>
          </div>

          <div className="flex flex-col justify-between gap-2">
            {currencies.length > 1 && (
              <form action={ROUTES.dashboard} className="flex items-center gap-2 text-[12px]">
                {keep.map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
                <span className="text-[var(--color-ink-3)]">Currency</span>
                <AutoSelect
                  name="currency"
                  value={filters.currency ?? ""}
                  options={currencies}
                  blankLabel="All currencies"
                  label="Show one currency"
                  className="py-1"
                />
              </form>
            )}
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

export interface AttentionItem {
  key: string;
  tone: "bad" | "warn" | "info";
  urgent?: boolean;
  count: number;
  text: string;
  sub?: string;
  href: string;
}

const BAR: Record<AttentionItem["tone"], string> = {
  bad: "bg-[var(--color-bad-fg)]",
  warn: "bg-[#d9900f]",
  info: "bg-[var(--color-accent)]",
};

export function AttentionStrip({ items, time }: { items: AttentionItem[]; time: string }) {
  const urgent = items.filter((i) => i.urgent).length;
  return (
    <section className="mb-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Eyebrow>Needs attention · {items.length}</Eyebrow>
        {urgent > 0 && (
          <span className="text-[11px] font-semibold text-[var(--color-bad-fg)]">▲ {urgent} urgent</span>
        )}
        <span className="text-[11px] text-[var(--color-ink-3)]">checked {time} IST · from the records in view</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-[#bfe3cc] bg-[var(--color-ok-bg)] px-4 py-3 text-[13px] text-[var(--color-ok-fg)]">
          Nothing needs attention: no overdue money, every invoice has a due date and a currency, and
          nothing is waiting on account.
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => (
            <Link
              key={i.key}
              href={i.href}
              className={`group relative flex items-center gap-3 overflow-hidden rounded-xl border bg-white py-3 pl-5 pr-4 transition-colors hover:bg-[#fafcfe] ${
                i.urgent ? "border-[#f0c9c9]" : "border-[var(--color-line)]"
              }`}
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${BAR[i.tone]}`} aria-hidden />
              <span
                className={`shrink-0 text-[12px] ${i.tone === "bad" ? "text-[var(--color-bad-fg)]" : i.tone === "warn" ? "text-[#d9900f]" : "text-[var(--color-accent)]"}`}
                aria-hidden
              >
                {i.urgent ? "▲" : "●"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug text-[var(--color-ink)]">
                  <strong className="tabular-nums">{i.count}</strong> {i.text}
                </span>
                {i.sub && <span className="block truncate text-[11px] text-[var(--color-ink-3)]">{i.sub}</span>}
              </span>
              <span className="shrink-0 text-[var(--color-ink-3)] transition-transform group-hover:translate-x-0.5" aria-hidden>
                →
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Gauge, sparkline, stat
// ---------------------------------------------------------------------------

export function Ring({ pct, children }: { pct: number; children: React.ReactNode }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative h-[150px] w-[150px] shrink-0">
      <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="66" cy="66" r={r} fill="none" stroke="#dcebea" strokeWidth="12" />
        <circle
          cx="66"
          cy="66"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${(c * p) / 100} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function Sparkline({ points, id }: { points: MonthPoint[]; id: string }) {
  const w = 300;
  const h = 64;
  const pad = 5;
  const max = Math.max(...points.map((p) => p.amount), 1);
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(points.length - 1, 1);
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad - 4);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.amount).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-16 w-full" role="img" aria-label="Receipts by month">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <circle key={p.month} cx={x(i)} cy={y(p.amount)} r="0" fill="transparent">
          <title>{`${p.month}: ${p.amount}`}</title>
        </circle>
      ))}
      {last && (
        <circle
          cx={x(points.length - 1)}
          cy={y(last.amount)}
          r="3.5"
          fill="white"
          stroke="var(--color-accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

export type StatTone = "plain" | "ok" | "info" | "warn" | "bad" | "accent";

const STAT_BAR: Record<StatTone, string> = {
  plain: "bg-[var(--color-line)]",
  ok: "bg-[var(--color-ok-fg)]",
  info: "bg-[var(--color-brand-2)]",
  warn: "bg-[#d9900f]",
  bad: "bg-[var(--color-bad-fg)]",
  accent: "bg-[var(--color-accent)]",
};
const STAT_INK: Record<StatTone, string> = {
  plain: "text-[var(--color-ink)]",
  ok: "text-[var(--color-ok-fg)]",
  info: "text-[var(--color-brand)]",
  warn: "text-[#8a6116]",
  bad: "text-[var(--color-bad-fg)]",
  accent: "text-[var(--color-accent)]",
};

export function Stat({
  label,
  value,
  sub,
  tone = "plain",
  href,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: StatTone;
  href?: string;
}) {
  const body = (
    <>
      <span className={`absolute inset-y-0 left-0 w-1 ${STAT_BAR[tone]}`} aria-hidden />
      <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">{label}</div>
      <div className={`mt-1.5 text-[20px] font-semibold leading-tight tabular-nums ${STAT_INK[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] leading-snug text-[var(--color-ink-3)]">{sub}</div>}
    </>
  );
  const cls =
    "relative block overflow-hidden rounded-xl border border-[var(--color-line)] bg-white py-3.5 pl-5 pr-4";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-[#a9c6e8]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A labelled share bar: "Overdue  $248,913  ███░░ 100%". */
export function ShareBar({
  label,
  value,
  pct,
  tone = "accent",
}: {
  label: string;
  value: string;
  pct: number;
  tone?: "accent" | "bad" | "warn" | "info";
}) {
  const fill = {
    accent: "bg-[var(--color-accent)]",
    bad: "bg-[var(--color-bad-fg)]",
    warn: "bg-[#d9900f]",
    info: "bg-[var(--color-brand-2)]",
  }[tone];
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-[var(--color-ink-2)]">{label}</span>
        <span className="tabular-nums">
          <strong>{value}</strong> <span className="text-[var(--color-ink-3)]">· {Math.round(p)}%</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-[#e8eef4]">
        <div className={`h-1.5 rounded-full ${fill}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Falling due, week by week
// ---------------------------------------------------------------------------

export function DueStrip({
  columns,
  currency,
  filters,
}: {
  columns: WeekColumn[];
  currency: string;
  filters: TrackingFilters;
}) {
  const cur = currency === "—" ? null : currency;
  const max = Math.max(...columns.filter((c) => c.kind !== "nodate").map((c) => c.amount), 1);
  const sum = (kinds: WeekColumn["kind"][]) =>
    columns.filter((c) => kinds.includes(c.kind)).reduce((s, c) => s + c.amount, 0);
  const overdue = sum(["older", "overdue"]);
  const now = sum(["now"]);
  const next4 = columns.filter((c) => c.kind === "ahead").slice(0, 4).reduce((s, c) => s + c.amount, 0);
  const nodate = sum(["nodate"]);

  const base = { ...filters, sort: undefined, dir: undefined, currency: cur ?? filters.currency };
  const hrefFor = (c: WeekColumn): string | null => {
    if (c.amount <= 0.01) return null;
    if (c.kind === "nodate") return `${ROUTES.search}?${toQuery(base, { verify: "1", open: "1" })}`;
    const extra: Record<string, string> = { dateField: "due", open: "1" };
    if (c.from) extra.from = c.from;
    if (c.to) extra.to = c.to;
    return `${ROUTES.search}?${toQuery(base, extra)}`;
  };

  return (
    <section className="rounded-2xl border border-[var(--color-line)] bg-white p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Falling due · week by week · {currency}</Eyebrow>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-ink-3)]">
          <span>
            overdue <strong className="text-[var(--color-bad-fg)]">{money(overdue, cur)}</strong>
          </span>
          <span>
            this week <strong className="text-[var(--color-ink)]">{money(now, cur)}</strong>
          </span>
          <span>
            next 4 weeks <strong className="text-[var(--color-accent)]">{money(next4, cur)}</strong>
          </span>
          {nodate > 0.01 && (
            <span>
              no due date <strong className="text-[var(--color-warn-fg)]">{money(nodate, cur)}</strong>
            </span>
          )}
        </div>
      </div>
      <p className="mb-3 text-[11px] text-[var(--color-ink-3)]">
        The outstanding balance by the week each portion falls (or fell) due, Monday to Sunday. Click a
        week for the invoices due in it.
      </p>

      <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8 xl:grid-cols-15">
        {columns.map((c) => {
          const ratio = c.amount / max;
          const has = c.amount > 0.01;
          let style: React.CSSProperties | undefined;
          let cls = "border border-[var(--color-line)] bg-[#f6f8fb] text-[var(--color-ink-3)]";
          if (has && (c.kind === "older" || c.kind === "overdue")) {
            style = { background: `rgba(176, 42, 42, ${0.14 + 0.66 * ratio})` };
            cls = `border border-transparent ${ratio > 0.45 ? "text-white" : "text-[var(--color-bad-fg)]"}`;
          } else if (has && (c.kind === "ahead" || c.kind === "later" || c.kind === "now")) {
            style = { background: `rgba(15, 118, 110, ${0.14 + 0.7 * ratio})` };
            cls = `border border-transparent ${ratio > 0.45 ? "text-white" : "text-[var(--color-accent)]"}`;
          } else if (has && c.kind === "nodate") {
            cls = "border-2 border-dashed border-[#e2b34d] bg-[var(--color-warn-bg)] text-[var(--color-warn-fg)]";
          }
          if (c.kind === "now") cls += " ring-2 ring-[var(--color-brand)] ring-offset-1";

          const box = (
            <div
              className={`flex h-14 items-center justify-center rounded-lg px-1 text-[12px] font-semibold tabular-nums ${cls}`}
              style={style}
            >
              {has ? compactMoney(c.amount, cur) : c.kind === "now" ? "now" : ""}
            </div>
          );
          const href = hrefFor(c);
          const title = `${c.label}${c.from && c.to ? ` (${c.from} – ${c.to})` : ""}: ${money(c.amount, cur)} on ${c.invoices} invoice(s)`;
          return (
            <div key={c.key} className="min-w-0" title={title}>
              {href ? (
                <Link href={href} className="block transition-transform hover:-translate-y-0.5">
                  {box}
                </Link>
              ) : (
                box
              )}
              <div
                className={`mt-1 truncate text-center text-[10px] ${c.kind === "now" ? "font-bold text-[var(--color-brand)]" : "text-[var(--color-ink-3)]"}`}
              >
                {c.label}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-[var(--color-ink-3)]">
        <Legend swatch="bg-[rgba(176,42,42,0.6)]">overdue</Legend>
        <Legend swatch="ring-2 ring-[var(--color-brand)] bg-white">this week</Legend>
        <Legend swatch="bg-[rgba(15,118,110,0.6)]">falling due</Legend>
        <Legend swatch="border border-dashed border-[#e2b34d] bg-[var(--color-warn-bg)]">no due date</Legend>
        <span>darker = more money</span>
      </div>
    </section>
  );
}

function Legend({ swatch, children }: { swatch: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-3.5 rounded-sm ${swatch}`} aria-hidden />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Biggest balances
// ---------------------------------------------------------------------------

export function TopBalances({ rows, currency }: { rows: CustomerSummary[]; currency: string }) {
  const cur = currency === "—" ? null : currency;
  const top = rows
    .filter((r) => r.currency === currency && r.outstanding > 0.01)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 6);
  const max = Math.max(...top.map((r) => r.outstanding), 1);

  return (
    <section className="rounded-2xl border border-[var(--color-line)] bg-white p-5">
      <Eyebrow className="mb-3">Biggest balances · {currency}</Eyebrow>
      {top.length === 0 ? (
        <p className="text-[12px] text-[var(--color-ink-3)]">Nothing outstanding.</p>
      ) : (
        <ul className="space-y-3">
          {top.map((r) => (
            <li key={`${r.id}-${r.currency}`}>
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                {r.id ? (
                  <Link href={ROUTES.customer(r.id)} className="link truncate">
                    {r.name}
                  </Link>
                ) : (
                  <span className="truncate text-[var(--color-ink-3)]">{r.name}</span>
                )}
                <span className="shrink-0 font-semibold tabular-nums">{kpiMoney(r.outstanding, cur)}</span>
              </div>
              <div className="relative mt-1 h-2 rounded-full bg-[#e8eef4]" title={`${money(r.overdue, cur)} overdue`}>
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)]"
                  style={{ width: `${(r.outstanding / max) * 100}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-bad-fg)]"
                  style={{ width: `${(Math.min(r.overdue, r.outstanding) / max) * 100}%` }}
                />
              </div>
              <div className="mt-0.5 text-[10.5px] text-[var(--color-ink-3)]">
                {r.overdue > 0.01 ? `${money(r.overdue, cur)} overdue · ` : ""}
                {r.collectedPct}% collected
                {Math.abs(r.onAccount) > 0.004 ? ` · ${money(r.onAccount, cur)} on account` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-4 text-[10.5px] text-[var(--color-ink-3)]">
        <Legend swatch="bg-[var(--color-bad-fg)]">overdue part</Legend>
        <Legend swatch="bg-[var(--color-accent)]">not yet overdue</Legend>
      </div>
    </section>
  );
}

