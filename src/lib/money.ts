/**
 * Formatting money, per currency.
 *
 * One function, because the alternative was the bug this replaces: every figure
 * in the application went through `toLocaleString("en-IN")`, so a USD total was
 * printed with Indian digit grouping — **13,31,027.96 instead of
 * 1,331,027.96** — and no figure anywhere carried a currency symbol. An export
 * total that reads 13,31,027.96 USD is not a formatting blemish; it is a number
 * a reader will transcribe wrongly.
 *
 * The rule is that the grouping follows the currency, not the reader:
 *
 *     USD   $1,331,027.96      lakh/crore grouping would be wrong
 *     INR   ₹13,31,027.96      thousands grouping would be wrong
 *     EUR   €1,331,027.96
 *
 * `Intl.NumberFormat` already knows all of this — the symbol, the separators,
 * the decimal count and where the symbol sits — given the right locale for the
 * currency. So the only thing this file decides is which locale each currency
 * is written in, and it is deliberately a short, explicit list rather than a
 * guess: a currency nobody has configured prints its ISO code beside the number
 * (`1,331,027.96 AED`), which is unambiguous and never wrong, instead of a
 * symbol we invented.
 */

/** The locale each currency's conventions come from. */
const LOCALES: Record<string, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  AED: "en-AE",
  AUD: "en-AU",
  CAD: "en-CA",
  SGD: "en-SG",
  JPY: "ja-JP",
  CNY: "zh-CN",
  CHF: "de-CH",
  ZAR: "en-ZA",
  SAR: "ar-SA",
};

/** Currencies whose smallest unit is the unit — no decimal places. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "IDR", "CLP", "ISK"]);

function clean(currency: string | null | undefined): string | null {
  const c = (currency ?? "").trim().toUpperCase();
  // a currency column can hold "USD", "US$", "$" or a stray note; only a plain
  // three-letter code is trusted to pick a locale
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

export interface MoneyOptions {
  /** Print the symbol or code. Off for a dense table column. */
  symbol?: boolean;
  /** What to print for null. */
  blank?: string;
  /** Force the decimal count, e.g. 0 for a KPI tile. */
  decimals?: number;
  /** A space between a leading symbol and the figure: "$ 195,741.04". */
  spaced?: boolean;
}

/**
 * One amount, formatted for its own currency.
 *
 * With no currency it falls back to plain grouped digits and no symbol, which
 * is the honest rendering of a figure whose currency nobody has recorded — the
 * state most imported invoices start in.
 */
export function formatMoney(
  amount: number | null | undefined,
  currency?: string | null,
  options: MoneyOptions = {},
): string {
  const { symbol = true, blank = "—", decimals, spaced = false } = options;
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return blank;

  const code = clean(currency);
  const locale = code ? (LOCALES[code] ?? "en-US") : "en-US";
  const places = decimals ?? (code && ZERO_DECIMAL.has(code) ? 0 : 2);

  // a currency we have no locale for: group it plainly and name it, rather than
  // borrowing another currency's symbol
  const named = code !== null && !(code in LOCALES);

  if (!code || named || !symbol) {
    const digits = amount.toLocaleString(locale, {
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    });
    return named && symbol ? `${digits} ${code}` : digits;
  }

  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
  if (!spaced) return format.format(amount);

  // "$195,741.04" → "$ 195,741.04"; a symbol already set apart ("1.234,00 €")
  // or written after the figure is left as it is
  const parts = format.formatToParts(amount);
  return parts
    .map((p, i) => {
      const next = parts[i + 1];
      if (p.type === "currency" && next && next.type !== "literal") return `${p.value} `;
      return p.value;
    })
    .join("");
}

/**
 * An exchange rate.
 *
 * Always home-currency convention — INR per one unit of the foreign currency —
 * and always Indian grouping, because the number it describes is in rupees. Up
 * to four decimals, since a rate of 83.2537 is not unusual and rounding it to
 * 83.25 moves a crore-sized balance by thousands.
 */
export function formatRate(n: number | null | undefined, blank = "—"): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return blank;
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** A whole-number count. */
export function formatCount(n: number | null | undefined, blank = "—"): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return blank;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/** Just the symbol, for a column header: "Received ($)". */
export function currencySymbol(currency: string | null | undefined): string {
  const code = clean(currency);
  if (!code) return "";
  if (!(code in LOCALES)) return code;
  const parts = new Intl.NumberFormat(LOCALES[code], {
    style: "currency",
    currency: code,
  }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? code;
}

/**
 * The home currency every INR equivalent is expressed in.
 *
 * Read from the environment on the server and defaulted here, so a company
 * reporting in something other than rupees changes one setting rather than
 * every screen.
 */
export const HOME_CURRENCY = process.env.HOME_CURRENCY?.trim() || "INR";

/**
 * An amount converted to the home currency at a given rate.
 *
 * Returns null when either side is missing — never zero. A missing rate is not
 * a rate of nothing, and a zero in a home-currency column would be added into
 * a total as if the invoice were worth nothing at all.
 */
export function toHome(
  amount: number | null | undefined,
  rate: number | null | undefined,
): number | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  if (rate === null || rate === undefined || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(amount * rate * 100) / 100;
}

/** The home-currency amount, formatted. */
export function formatHome(
  amount: number | null | undefined,
  rate: number | null | undefined,
  options: MoneyOptions = {},
): string {
  return formatMoney(toHome(amount, rate), HOME_CURRENCY, options);
}
