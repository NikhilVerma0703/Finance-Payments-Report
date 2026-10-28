// The dashboard's overview: the pieces drawn above and around the hero
// figures — ported from the Pacific ERP's Payment Tracking, which is drawn in
// its Production overview's language.
//
// In the Production overview's own language (owner, 28 Oct 2026: "use the
// same brand guidelines as the production overview dashboard … make it
// intuitive"): the page opens on one white deck with the plant's teal edge —
// a status bar that says what the page is as at, a "needs attention" rail of
// chips to act on, two glass hero tiles — and the strips below are the
// Pulse's tiles, the cards the bento's. Its primitives are the deck's own
// (app/_dashboard/viz.tsx): every figure carries its words for the hover
// bubble (Num, LinkOr's tip; TipLayer on the page), so a reader can rest on a
// number and be told what it is.
//
// Every number comes from the same tracked invoices as the master table —
// nothing here is stored or estimated — and everything that can be clicked
// opens the invoices behind it. Server components; the only client code is the
// currency picker (AutoSelect) and the deck's tip layer.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { LinkOr, Num, TableFold, iv } from "@/components/dash/viz";
import { ROUTES } from "@/lib/routes";
import { monthProgress, type ReceivedColumn, type WeekColumn } from "@/lib/payments/overview";
import { toQuery as filterQuery, type CustomerSummary, type TrackingFilters } from "@/server/payments/query";
import { AutoSelect } from "./AutoSelect";
import { money } from "./bits";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The deck's tile: a paler shade of the white card, as the Production overview's heroes. */
export const TILE = "dash-glass-hi rounded-2xl p-4 sm:p-5";

/** The heading every tile opens with — the Production overview's brand eyebrow. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`text-[11px] font-semibold uppercase tracking-[0.18em] text-brand ${className}`}>{children}</h2>;
}

/** A group of tiles under the deck, headed as the Production overview heads its bento runs. */
export function GroupHead({ children, dot = "#1f6d80" }: { children: ReactNode; dot?: string }) {
  return (
    <h2 className="mb-3 mt-2 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-600">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} aria-hidden />
      {children}
      <span className="h-px flex-1 bg-gradient-to-r from-gray-300 to-transparent" aria-hidden />
    </h2>
  );
}

/** A plain three-letter currency code, or nothing. */
function currencyCode(currency: string | null | undefined): string | null {
  const c = (currency ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/** "$12.4K" — for a figure in a box too small for every digit. Its tip carries them all. */
export function compactMoney(n: number, currency: string | null): string {
  const c = currencyCode(currency);
  const body = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  if (!c) return body;
  const sym = new Intl.NumberFormat("en-US", { style: "currency", currency: c }).formatToParts(0).find((p) => p.type === "currency")?.value ?? c;
  return sym.length <= 2 ? `${sym}${body}` : `${body} ${c}`;
}

/** The time the page was worked out, in India time, as the ERP's screens state it. */
export function asAtTime(): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date());
}

// ---------------------------------------------------------------------------
// The status bar
// ---------------------------------------------------------------------------

/**
 * What the page is, as at when — the Production overview's status bar. Beside
 * it, where that page has the running shift, the month being collected and how
 * far through it the office is.
 */
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
  actions: ReactNode;
}) {
  const d = new Date(`${today}T00:00:00Z`);
  const dateLabel = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const month = monthProgress(today);
  // the picker keeps every other filter in force
  const keep = Object.entries(filters).filter(([k, v]) => v && k !== "currency" && k !== "page") as Array<[string, string]>;

  return (
    <div className="dash-cq">
      <div className="dash-rise dash-statusrow">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
            <span className="dash-live inline-block h-2 w-2 rounded-full bg-emerald-600 shadow-[0_0_0_3px_rgba(5,150,105,0.18)]" aria-hidden />
            Live
          </div>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-gray-900 sm:text-[32px]">
            Payment tracking <span className="font-normal text-gray-500">·</span>{" "}
            <span className="whitespace-nowrap bg-gradient-to-r from-brand-700 via-brand-500 to-brand-400 bg-clip-text text-transparent print:text-gray-900">{dateLabel}</span>
          </h1>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
            <span>
              As at <span className="tabular font-medium text-gray-900">{time}</span> IST ·{" "}
              <Num tip="invoices the figures below are worked out from: the filters in force, pending only unless every invoice is asked for" className="tabular font-medium text-gray-900">
                {invoices}
              </Num>{" "}
              invoice(s) ·{" "}
              <Num tip="customers with at least one of those invoices" className="tabular font-medium text-gray-900">
                {customers}
              </Num>{" "}
              customer(s)
            </span>
            <span className="text-gray-600">every figure worked out from the records as they stand</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {actions}
            {currencies.length > 1 && (
              <form action={ROUTES.dashboard} className="flex items-center gap-2 text-xs">
                {keep.map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
                <span className="text-gray-600">Currency</span>
                <AutoSelect name="currency" value={filters.currency ?? ""} options={currencies} blankLabel="All currencies" label="Show one currency" className="py-1" />
              </form>
            )}
          </div>
        </div>

        <div className="dash-status-side flex min-w-0 items-center gap-4">
          <div className="shrink-0 rounded-2xl px-3.5 py-2 dash-glass-hi">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-600">Collecting</div>
            <div className="tabular whitespace-nowrap text-lg font-semibold text-gray-900">
              <span className="text-brand-500">{MONTHS_LONG[d.getUTCMonth()]}</span> · day {month.day}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={month.pct} aria-label="How far through the month">
              <div className="dash-grow-x h-full rounded-full bg-brand-500" style={iv(1, { width: `${month.pct}%` })} />
            </div>
            <div className="tabular mt-1.5 text-[11px] text-gray-600">
              day {month.day} of {month.days} ·{" "}
              <Num tip="receipts dated this calendar month on the invoices in view, cleared invoices included">{receiptsThisMonth}</Num> receipt(s) booked
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Needs attention — the Production overview's alert rail
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

const GLYPH: Record<AttentionItem["tone"], string> = { bad: "▲", warn: "●", info: "◆" };
// On the deck's white card: the bars hold 3:1 against white as a graphic, the glyphs 4.5:1 as text.
const RAIL: Record<AttentionItem["tone"], string> = { bad: "bg-red-500", warn: "bg-amber-600", info: "bg-brand-500" };
const GLYPH_CLS: Record<AttentionItem["tone"], string> = { bad: "text-red-600", warn: "text-amber-700", info: "text-brand-500" };
const SEV_WORD: Record<AttentionItem["tone"], string> = { bad: "urgent", warn: "attention", info: "for information" };

export function AttentionStrip({ items, time }: { items: AttentionItem[]; time: string }) {
  const urgent = items.filter((i) => i.urgent).length;
  return (
    <div className="dash-cq">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Eyebrow>
          Needs attention · <span className="tabular text-gray-900">{items.length}</span>
        </Eyebrow>
        {urgent > 0 && <span className="text-[11px] font-medium text-red-700">▲ {urgent} urgent</span>}
        <span className="text-[11px] text-gray-600">checked {time} IST · from the records in view</span>
      </div>
      {items.length === 0 ? (
        <div className="dash-rise inline-flex min-h-[44px] items-center gap-3 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
          <span aria-hidden>✓</span> Nothing needs attention: no overdue money, every invoice has a due date and a currency, and nothing waits on account.
        </div>
      ) : (
        <ul className="dash-alertlist">
          {items.map((i, n) => (
            <li key={i.key} className="dash-rise" style={iv(n)}>
              <Link
                href={i.href}
                className={`group relative flex h-full min-h-[44px] items-center gap-3 rounded-xl py-2 pl-4 pr-3 transition hover:bg-gray-50 dash-glass ${i.urgent ? "dash-breathe" : ""}`}
              >
                <span className={`absolute bottom-2 left-1.5 top-2 w-[3px] rounded-full ${RAIL[i.tone]}`} aria-hidden />
                <span className={`text-sm ${GLYPH_CLS[i.tone]}`} aria-hidden>
                  {GLYPH[i.tone]}
                </span>
                <span className="sr-only">{SEV_WORD[i.tone]}: </span>
                <span className="min-w-0 flex-1 text-[13px] leading-snug text-gray-700">
                  <b className="tabular text-[15px] font-semibold text-gray-900">{i.count}</b> {i.text}
                  {i.sub && <span className="block truncate text-[11px] text-gray-500">{i.sub}</span>}
                </span>
                <span className="text-gray-500 transition group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden>
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A small figure tile — the customer page and the ageing analysis use it
// ---------------------------------------------------------------------------

export type StatTone = "plain" | "ok" | "info" | "warn" | "bad" | "accent";

const STAT_BAR: Record<StatTone, string> = {
  plain: "bg-gray-200",
  ok: "bg-emerald-600",
  info: "bg-brand",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  accent: "bg-brand-500",
};
const STAT_INK: Record<StatTone, string> = {
  plain: "text-gray-900",
  ok: "text-emerald-700",
  info: "text-brand",
  warn: "text-amber-700",
  bad: "text-red-700",
  accent: "text-brand-500",
};

export function Stat({ label, value, sub, tone = "plain", href }: { label: string; value: string; sub?: ReactNode; tone?: StatTone; href?: string }) {
  const body = (
    <>
      <span className={`absolute bottom-2 left-1.5 top-2 w-[3px] rounded-full ${STAT_BAR[tone]}`} aria-hidden />
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-600">{label}</div>
      <div className={`tabular mt-1 text-xl font-semibold leading-tight tracking-tight ${STAT_INK[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] leading-snug text-gray-600">{sub}</div>}
    </>
  );
  const cls = "dash-glass relative block overflow-hidden rounded-xl py-3 pl-5 pr-4";
  return href ? (
    <Link href={href} className={`${cls} transition hover:bg-gray-50`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Key({ cls, style, children }: { cls: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-4 rounded ${cls}`} style={style} aria-hidden />
      {children}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Week by week — the Pulse's tiles, for money
// ---------------------------------------------------------------------------

/** The rgb of each band's ramp: red for money past due, the brand teal for money falling due, emerald for money in. */
const RED = "220, 38, 38";
const TEAL = "31, 109, 128";
const GREEN = "5, 150, 105";

type TileKind = "past" | "due" | "in" | "nodate" | "empty";

/** A tile's look: a pale-to-deep ramp ("darker = more money"), the running week ringed and breathing as the Pulse's now. */
function tileLook(kind: TileKind, ratio: number, now: boolean): { cls: string; style?: CSSProperties } {
  const deep = ratio > 0.45;
  const ramp = (rgb: string) => ({ background: `rgba(${rgb}, ${Math.round((0.14 + 0.72 * Math.min(1, ratio)) * 100) / 100})` });
  if (now && kind === "empty") return { cls: "dash-now bg-brand-50 text-brand-700 ring-2 ring-inset ring-brand-500" };
  const ring = now ? " dash-now ring-2 ring-inset ring-brand-500" : "";
  if (kind === "past") return { cls: `${deep ? "text-white" : "text-red-800"}${ring}`, style: ramp(RED) };
  if (kind === "due") return { cls: `${deep ? "text-white" : "text-brand-700"}${ring}`, style: ramp(TEAL) };
  if (kind === "in") return { cls: `${deep ? "text-white" : "text-emerald-800"}${ring}`, style: ramp(GREEN) };
  if (kind === "nodate") return { cls: "bg-amber-50 text-amber-800 outline-dashed outline-2 -outline-offset-2 outline-amber-500" };
  return { cls: "bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-300" };
}

function Tile({
  label,
  body,
  tip,
  href,
  look,
  i,
  strong,
}: {
  label: string;
  body: string;
  tip: string;
  href: string | null;
  look: { cls: string; style?: CSSProperties };
  i: number;
  strong?: boolean;
}) {
  const box = (
    <div className={`dash-rise flex h-10 items-center justify-center rounded-lg px-0.5 text-[11.5px] font-semibold tabular sm:h-11 ${look.cls}`} style={{ ...iv(i % 8), ...look.style }}>
      <span className="truncate">{body}</span>
    </div>
  );
  return (
    <Num as="li" className="min-w-0" tip={tip}>
      {href ? (
        <Link href={href} prefetch={false} className="block rounded-lg transition-transform hover:-translate-y-0.5">
          {box}
        </Link>
      ) : (
        box
      )}
      <div className={`tabular mt-1 truncate text-center text-[10px] ${strong ? "font-semibold text-brand" : "text-gray-600"}`}>{label}</div>
    </Num>
  );
}

/**
 * What falls due and what came in, week by week, Monday to Sunday — the
 * Production overview's Pulse, for money. Two bands of tiles on one card:
 * "Falling due" (red for weeks gone by with money still owed, the brand teal
 * for weeks ahead, an amber dashed tile for money with no due date) and "Came
 * in" (emerald: every receipt, cleared invoices too, and money booked on
 * account). Darker is more money; this week is ringed. Each tile opens the
 * invoices behind it, and rests with its figures in words; the table under
 * the strip says the same for a screen reader or a phone.
 */
export function WeekByWeek({ due, received, currency, filters }: { due: WeekColumn[]; received: ReceivedColumn[]; currency: string; filters: TrackingFilters }) {
  const cur = currency === "—" ? null : currency;
  const fmt = (n: number) => money(n, cur);

  // falling due
  const dueMax = Math.max(...due.filter((c) => c.kind !== "nodate").map((c) => c.amount), 1);
  const sumDue = (kinds: WeekColumn["kind"][]) => due.filter((c) => kinds.includes(c.kind)).reduce((s, c) => s + c.amount, 0);
  const overdue = sumDue(["older", "overdue"]);
  const thisWeek = sumDue(["now"]);
  const next4 = due.filter((c) => c.kind === "ahead").slice(0, 4).reduce((s, c) => s + c.amount, 0);
  const dueBase = { ...filters, sort: undefined, dir: undefined, currency };
  const dueHref = (c: WeekColumn): string | null => {
    if (c.amount <= 0.01) return null;
    if (c.kind === "nodate") return `${ROUTES.search}?${filterQuery(dueBase, { verify: "1", open: "1" })}`;
    const extra: Record<string, string> = { dateField: "due", open: "1" };
    if (c.from) extra.from = c.from;
    if (c.to) extra.to = c.to;
    return `${ROUTES.search}?${filterQuery(dueBase, extra)}`;
  };

  // came in — a receipt belongs to its invoice however it stands now, so no "outstanding only"
  const inShown = received.filter((c) => c.kind !== "later" || c.amount > 0.01);
  const inWeeks = received.filter((c) => c.kind === "past" || c.kind === "now");
  const inMax = Math.max(...inWeeks.map((c) => c.amount), 1);
  const last4 = inWeeks.slice(-4).reduce((s, c) => s + c.amount, 0);
  const inBase = { ...filters, sort: undefined, dir: undefined, open: undefined, currency };
  const inHref = (c: ReceivedColumn): string | null => {
    if (c.amount <= 0.01 || !c.invoices || c.kind === "nodate") return null;
    const extra: Record<string, string> = { dateField: "receipt" };
    if (c.from) extra.from = c.from;
    if (c.to) extra.to = c.to;
    return `${ROUTES.search}?${filterQuery(inBase, extra)}`;
  };
  const span = (c: { label: string; from: string | null; to: string | null }) =>
    c.from && c.to ? `in the week ${c.from} to ${c.to}` : c.label === "No date" ? "with no date" : c.from ? `from ${c.from} on` : c.to ? `up to ${c.to}` : c.label;

  return (
    <div className={`${TILE} h-full`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <Eyebrow>Week by week · {currency}</Eyebrow>
          <p className="text-xs text-gray-600">What falls due each week, Monday to Sunday, and what came in — rest the pointer on a week for its figures, click it for the invoices.</p>
        </div>
        <dl className="tabular flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <div className="flex gap-1.5">
            <dt className="text-gray-600">overdue</dt>
            <Num as="dd" className={`font-semibold ${overdue > 0.01 ? "text-red-700" : "text-gray-900"}`} tip="the part of the balance whose own due date has passed, portion by portion">
              {fmt(overdue)}
            </Num>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-gray-600">this week</dt>
            <Num as="dd" className="font-semibold text-gray-900" tip="what falls due this week, Monday to Sunday">
              {fmt(thisWeek)}
            </Num>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-gray-600">next 4 weeks</dt>
            <Num as="dd" className="font-semibold text-brand-500" tip="what falls due in the four weeks after this one">
              {fmt(next4)}
            </Num>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-gray-600">in, last 4 weeks</dt>
            <Num as="dd" className="font-semibold text-emerald-700" tip="every receipt dated in the last four weeks, this one included, money on account too">
              {fmt(last4)}
            </Num>
          </div>
        </dl>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <div className="mb-1.5 flex items-baseline gap-2 border-b border-gray-200 pb-1 text-[11px]">
            <span className="text-sm font-bold text-brand-500">Falling due</span>
            <span className="truncate text-gray-600">the balance by the week each portion falls (or fell) due</span>
          </div>
          <ol className="grid grid-cols-[repeat(auto-fill,minmax(3.05rem,1fr))] gap-1">
            {due.map((c, n) => {
              const has = c.amount > 0.01;
              const kind: TileKind = !has ? "empty" : c.kind === "nodate" ? "nodate" : c.kind === "older" || c.kind === "overdue" ? "past" : "due";
              return (
                <Tile
                  key={c.key}
                  i={n}
                  label={c.label}
                  strong={c.kind === "now"}
                  body={has ? compactMoney(c.amount, cur) : c.kind === "now" ? "now" : ""}
                  look={tileLook(kind, c.amount / dueMax, c.kind === "now")}
                  href={dueHref(c)}
                  tip={`${fmt(c.amount)} ${c.kind === "older" || c.kind === "overdue" ? "still owed that fell due" : c.kind === "nodate" ? "owed" : "falling due"} ${span(c)}, on ${c.invoices} invoice(s)`}
                />
              );
            })}
          </ol>
        </div>

        {inShown.some((c) => c.amount > 0.01) && (
          <div>
            <div className="mb-1.5 flex items-baseline gap-2 border-b border-gray-200 pb-1 text-[11px]">
              <span className="text-sm font-bold text-emerald-700">Came in</span>
              <span className="truncate text-gray-600">every receipt by the week it was received, cleared invoices and money on account too</span>
            </div>
            <ol className="grid grid-cols-[repeat(auto-fill,minmax(3.05rem,1fr))] gap-1">
              {inShown.map((c, n) => {
                const has = c.amount > 0.01;
                const kind: TileKind = !has ? "empty" : c.kind === "nodate" ? "nodate" : "in";
                const ratio = c.kind === "earlier" || c.kind === "later" ? 0.2 : c.amount / inMax;
                return (
                  <Tile
                    key={c.key}
                    i={n}
                    label={c.label}
                    strong={c.kind === "now"}
                    body={has ? compactMoney(c.amount, cur) : c.kind === "now" ? "now" : ""}
                    look={tileLook(kind, ratio, c.kind === "now")}
                    href={inHref(c)}
                    tip={`${fmt(c.amount)} received ${span(c)}, in ${c.receipts} receipt(s)${c.invoices ? ` against ${c.invoices} invoice(s)` : ""}`}
                  />
                );
              })}
            </ol>
          </div>
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-gray-600">
        <Key cls="" style={{ background: `rgba(${RED}, 0.6)` }}>
          past due, still owed
        </Key>
        <Key cls="" style={{ background: `rgba(${TEAL}, 0.6)` }}>
          falling due
        </Key>
        <Key cls="" style={{ background: `rgba(${GREEN}, 0.6)` }}>
          came in
        </Key>
        <Key cls="bg-amber-50 outline-dashed outline-2 -outline-offset-2 outline-amber-500">no date</Key>
        <Key cls="bg-brand-50 ring-2 ring-inset ring-brand-500 shadow-[0_0_0_2px_rgba(31,109,128,0.35),0_0_8px_1px_rgba(31,109,128,0.3)]">this week</Key>
        <li>darker = more money</li>
      </ul>

      <TableFold label="View as table — each week's money">
        <table className="tabular w-full text-right text-xs text-gray-700">
          <thead className="sticky top-0 bg-gray-50 text-gray-600">
            <tr>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Week
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Falls due
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Invoices
              </th>
            </tr>
          </thead>
          <tbody>
            {due.map((c) => (
              <tr key={c.key} className={`border-t border-gray-100 ${c.kind === "now" ? "font-semibold text-brand-700" : ""}`}>
                <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-medium text-gray-900">
                  {c.label}
                  {c.from && c.to ? <span className="font-normal text-gray-500"> · {c.from} – {c.to}</span> : null}
                </th>
                <td className={`px-2 py-1 ${(c.kind === "older" || c.kind === "overdue") && c.amount > 0.01 ? "text-red-700" : ""}`}>{fmt(c.amount)}</td>
                <td className="px-2 py-1">{c.invoices}</td>
              </tr>
            ))}
          </tbody>
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Week
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Came in
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Receipts
              </th>
            </tr>
          </thead>
          <tbody>
            {inShown.map((c) => (
              <tr key={c.key} className={`border-t border-gray-100 ${c.kind === "now" ? "font-semibold text-brand-700" : ""}`}>
                <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-medium text-gray-900">
                  {c.label}
                  {c.from && c.to ? <span className="font-normal text-gray-500"> · {c.from} – {c.to}</span> : null}
                </th>
                <td className="px-2 py-1">{fmt(c.amount)}</td>
                <td className="px-2 py-1">{c.receipts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFold>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Biggest balances
// ---------------------------------------------------------------------------

/**
 * The customers who owe the most, each as a bar of what it owes with the part
 * past due in red — and, from the key figures, how much of the balance the
 * three largest hold between them.
 */
export function TopBalances({ rows, currency, topThree }: { rows: CustomerSummary[]; currency: string; topThree?: { pct: number; customers: number } | null }) {
  const cur = currency === "—" ? null : currency;
  const top = rows
    .filter((r) => r.currency === currency && r.outstanding > 0.01)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 6);
  const max = Math.max(...top.map((r) => r.outstanding), 1);

  return (
    <div className={TILE}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Biggest balances · {currency}</Eyebrow>
        {topThree && (
          <Num
            tip={`how much of the outstanding balance the three customers who owe the most hold between them; ${topThree.customers} customer(s) owe in all`}
            className="text-[11px] text-gray-600"
          >
            top 3 hold <b className="tabular text-gray-900">{topThree.pct}%</b>
          </Num>
        )}
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing outstanding.</p>
      ) : (
        <ul className="space-y-1.5">
          {top.map((r, n) => (
            <li key={`${r.id}-${r.currency}`}>
              <LinkOr href={r.id ? ROUTES.customer(r.id) : null} className={`-mx-1.5 block rounded-lg px-1.5 py-1 ${r.id ? "transition hover:bg-gray-50" : ""}`}>
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className={`truncate font-medium ${r.id ? "text-gray-900" : "text-gray-500"}`}>{r.name}</span>
                  <Num tip={`what ${r.name} owes in ${currency}: invoice value less receipts and credit notes, plus debit notes`} className="tabular shrink-0 font-semibold text-gray-900">
                    {money(r.outstanding, cur)}
                  </Num>
                </div>
                <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-brand-100" aria-hidden>
                  <div className="dash-grow-x absolute inset-y-0 left-0 rounded-full bg-brand-500" style={iv(n, { width: `${(r.outstanding / max) * 100}%` })} />
                  <div className="dash-grow-x absolute inset-y-0 left-0 rounded-full bg-red-500" style={iv(n, { width: `${(Math.min(r.overdue, r.outstanding) / max) * 100}%` })} />
                </div>
                <div className="tabular mt-0.5 text-[11px] text-gray-600">
                  {r.overdue > 0.01 ? <span className="text-red-700">{money(r.overdue, cur)} overdue</span> : "nothing overdue"} · {r.collectedPct}% collected
                  {Math.abs(r.onAccount) > 0.004 ? ` · ${money(r.onAccount, cur)} on account` : ""}
                </div>
              </LinkOr>
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-3 flex gap-4 text-[11px] text-gray-600">
        <Key cls="bg-red-500">past due</Key>
        <Key cls="bg-brand-500">not yet due</Key>
      </ul>
    </div>
  );
}
