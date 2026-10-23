/**
 * The small shared pieces of the Payment Tracking interface.
 *
 * Kept in one file because they are each a few lines and they only make sense
 * together: the money format, the status chip, the KPI tile and the field row
 * used by every form in the section.
 */
import { formatDate } from "@/lib/text";
import { formatMoney, formatRate, HOME_CURRENCY } from "@/lib/money";
import { STATUS_LABELS, STATUS_TONE, type TrackingStatus } from "@/lib/payments/record";

export const TONE_CLASS: Record<string, string> = {
  ok: "bg-[var(--color-ok-bg)] text-[var(--color-ok-fg)]",
  warn: "bg-[var(--color-warn-bg)] text-[var(--color-warn-fg)]",
  bad: "bg-[var(--color-bad-bg)] text-[var(--color-bad-fg)]",
  info: "bg-[var(--color-info-bg)] text-[var(--color-info-fg)]",
  mute: "bg-[var(--color-mute-bg)] text-[var(--color-mute-fg)]",
};

/**
 * An amount in its own currency.
 *
 * The currency argument is not decoration: it chooses the digit grouping as
 * well as the symbol, and USD grouped the Indian way reads as a different
 * number. Omit it only where the currency genuinely is not known — then the
 * figure prints as plain grouped digits with no symbol, which is honest.
 */
export function money(n: number | null | undefined, currency?: string | null): string {
  return formatMoney(n, currency);
}

/**
 * An amount already in the home currency.
 *
 * Forex gain/loss and every "home value" are rupee figures however the invoice
 * is denominated — the rate is rupees per unit of foreign currency, so the
 * product is rupees. Printing them with the invoice's symbol would be wrong.
 */
export function homeMoney(n: number | null | undefined): string {
  return formatMoney(n, HOME_CURRENCY);
}

/** A headline figure: the symbol set apart from the number, "$ 195,741.04". */
export function kpiMoney(n: number | null | undefined, currency?: string | null): string {
  return formatMoney(n, currency, { spaced: true });
}

/** A rate: rupees per one unit of the foreign currency. */
export function rate(n: number | null | undefined): string {
  return formatRate(n);
}

export function day(iso: string | null | undefined): string {
  return iso ? formatDate(iso) : "—";
}

export function StatusChip({ status, note }: { status: TrackingStatus; note?: string }) {
  return (
    <span className={`chip ${TONE_CLASS[STATUS_TONE[status]]}`} title={note}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export type TileTone = "plain" | "info" | "ok" | "warn" | "bad";

export function Tile({
  label,
  value,
  sub,
  tone = "plain",
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: TileTone;
}) {
  const ring: Record<TileTone, string> = {
    plain: "border-[var(--color-line)]",
    info: "border-[#c6dcf3]",
    ok: "border-[#bfe3cc]",
    warn: "border-[#efd9a1]",
    bad: "border-[#f0c9c9]",
  };
  const ink: Record<TileTone, string> = {
    plain: "text-[var(--color-ink)]",
    info: "text-[var(--color-brand)]",
    ok: "text-[var(--color-ok-fg)]",
    warn: "text-[#8a6116]",
    bad: "text-[var(--color-bad-fg)]",
  };
  return (
    <div className={`rounded-xl border bg-white p-4 ${ring[tone]}`}>
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${ink[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] leading-snug text-[var(--color-ink-3)]">{sub}</div>}
    </div>
  );
}

/**
 * One form field.
 *
 * Never marked required — there is no required field anywhere in this section —
 * and `hint` is where a field explains what it unlocks, which is how a person
 * learns that the BL date is worth filling in without being refused for leaving
 * it out.
 */
export function Field({
  name,
  label,
  type = "text",
  value,
  placeholder,
  hint,
  width = "",
  list,
  options,
  blankLabel = "— not set —",
}: {
  name: string;
  label: string;
  type?: "text" | "date" | "number";
  value?: string | number | null;
  placeholder?: string;
  hint?: string;
  width?: string;
  list?: string;
  /**
   * Makes the field a dropdown of these values, with a blank first so nothing
   * is ever forced. Each is a value, or [value, label].
   */
  options?: ReadonlyArray<string | readonly [string, string]>;
  /** The blank first choice's wording; null leaves it out. */
  blankLabel?: string | null;
}) {
  const id = `f-${name}`;
  return (
    <div className={width || "min-w-[180px] flex-1"}>
      <label className="field-label" htmlFor={id} title={hint}>
        {label}
      </label>
      {options ? (
        <select id={id} name={name} defaultValue={value ?? ""} className="input">
          {blankLabel !== null && <option value="">{blankLabel}</option>}
          {options.map((o) => {
            const [v, l] = typeof o === "string" ? [o, o] : o;
            return (
              <option key={v} value={v}>
                {l}
              </option>
            );
          })}
        </select>
      ) : (
        <input
          id={id}
          name={name}
          type={type === "number" ? "text" : type}
          inputMode={type === "number" ? "decimal" : undefined}
          defaultValue={value ?? ""}
          placeholder={placeholder}
          list={list}
          className="input"
          autoComplete="off"
        />
      )}
      {hint && <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-ink-3)]">{hint}</p>}
    </div>
  );
}

/** A two-column definition list — the shape every detail panel uses. */
export function Facts({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1 text-[12px]">
      {rows.map(([k, v], i) => (
        <div key={`${k}-${i}`} className="col-span-2 grid grid-cols-subgrid border-b border-dashed border-[var(--color-line)] pb-1">
          <dt className="text-[var(--color-ink-3)]">{k}</dt>
          <dd className="text-[var(--color-ink-2)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
