/** Parsing and date helpers: pure functions, no business rules. */

// ---------------------------------------------------------------- text
const WS_RE = /\s+/g;

export function clean(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isNaN(value)) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    // ExcelJS rich text / formula cells
    const obj = value as Record<string, unknown>;
    if ("result" in obj) return clean(obj.result);
    if ("richText" in obj && Array.isArray(obj.richText)) {
      return clean((obj.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join(""));
    }
    if ("text" in obj) return clean(obj.text);
    if ("error" in obj) return "";
  }
  return String(value).replace(/ /g, " ").replace(/​/g, "").replace(WS_RE, " ").trim();
}

// ---------------------------------------------------------------- numbers
const CURRENCY_PREFIX_RE = /^(?:[A-Z]{3}|US\$|RS\.?|[$€£₹])\s*/i;

/**
 * Parse a spreadsheet / PDF numeric value. Strict on purpose: text such as
 * "Container No. MSNU 1968136" must NOT come back as 0.1968136.
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return null;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("result" in obj) return toNumber(obj.result);
  }
  let s = clean(value).replace(/−/g, "-");
  if (!s) return null;
  s = s.replace(CURRENCY_PREFIX_RE, "").trim();
  s = s.replace(/\s*%$/, "");
  const negative = s.startsWith("(") && s.endsWith(")");
  if (negative) s = s.slice(1, -1).trim();
  s = s.replace(/,/g, "").replace(/\s/g, "");
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------- dates
const MONTHS: Record<string, number> = {};
[
  ["jan", "january"],
  ["feb", "february"],
  ["mar", "march"],
  ["apr", "april"],
  ["may", "may"],
  ["jun", "june"],
  ["jul", "july"],
  ["aug", "august"],
  ["sep", "september"],
  ["oct", "october"],
  ["nov", "november"],
  ["dec", "december"],
].forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)));

const DMY_RE = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/;
const YMD_RE = /\b(\d{4})[./-](\d{1,2})[./-](\d{1,2})\b/;
const D_MON_Y_RE = /\b(\d{1,2})[\s-]([A-Za-z]{3,9})[\s\-,]+(\d{2,4})\b/;
const MON_D_Y_RE = /\b([A-Za-z]{3,9})[\s-](\d{1,2})[\s\-,]+(\d{2,4})\b/;

function fullYear(y: number): number {
  if (y < 100) return y < 70 ? 2000 + y : 1900 + y;
  return y;
}

function makeIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Parse a date to an ISO yyyy-mm-dd string. Ambiguous d/m vs m/d is resolved by
 * `dayFirst`, unless one component is > 12, which settles it unambiguously.
 */
export function toIsoDate(value: unknown, dayFirst = true): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("result" in obj) return toIsoDate(obj.result, dayFirst);
  }
  const s = clean(value);
  if (!s) return null;

  let m = YMD_RE.exec(s);
  if (m) return makeIso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = DMY_RE.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(Number(m[3]));
    let d: number;
    let mo: number;
    if (a > 12 && b <= 12) [d, mo] = [a, b];
    else if (b > 12 && a <= 12) [d, mo] = [b, a];
    else [d, mo] = dayFirst ? [a, b] : [b, a];
    return makeIso(y, mo, d);
  }

  m = D_MON_Y_RE.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return makeIso(fullYear(Number(m[3])), MONTHS[m[2].toLowerCase()], Number(m[1]));
  }

  m = MON_D_Y_RE.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) {
    return makeIso(fullYear(Number(m[3])), MONTHS[m[1].toLowerCase()], Number(m[2]));
  }
  return null;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getUTCDate()).padStart(2, "0")}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- columns
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || "A";
}
