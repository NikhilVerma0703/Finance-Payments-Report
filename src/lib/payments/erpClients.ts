/**
 * The main ERP's client list, as a source of customer defaults.
 *
 * Pure: no database. The server keeps a copy of the list (`pt_erp_clients`)
 * and this file decides how a customer here is matched to a client there, and
 * how an uploaded client list is read.
 *
 * Matching is by name, because that is all the two share. Names differ in the
 * ways names do — "UNIQUE STONE BOUTIQUE LLC," against "Unique Stone Boutique
 * LLC" — so both sides are reduced to a key first: lower case, punctuation
 * gone, and a trailing legal form ("LLC", "Inc", "GmbH", "S.A. de C.V.")
 * dropped. Anything looser than that would start matching different firms,
 * and a wrong currency is worse than none, so there is no fuzzy matching.
 */

export interface ErpClient {
  name: string;
  nameKey: string;
  country: string | null;
  currency: string | null;
  paymentTerms: string | null;
}

/** Legal forms dropped from the end of a name before matching, longest first. */
const LEGAL_FORMS = [
  "s a de c v", "sa de cv", "sp z o o", "sp zoo", "pvt ltd", "private limited",
  "s p a", "b v", "s r l", "s a",
  "llc", "inc", "ltd", "limited", "gmbh", "corp", "corporation", "co", "company",
  "spa", "srl", "bv", "kft", "sa", "ag", "plc", "pty", "oy", "ab", "as", "llp", "lp",
];

/** The key two names are compared by. */
export function clientKey(name: string | null | undefined): string {
  let key = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // letters an accent-strip does not reduce: "Spółka", "Ørsted", "Straße"
    .replace(/[łøßæđ]/g, (ch) => ({ ł: "l", ø: "o", ß: "ss", æ: "ae", đ: "d" })[ch] ?? ch)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // "Stone Co Inc" sheds both, but a name is never reduced to nothing
  for (let changed = true; changed; ) {
    changed = false;
    for (const form of LEGAL_FORMS) {
      if (key.endsWith(` ${form}`) && key.length > form.length + 1) {
        key = key.slice(0, -(form.length + 1)).trim();
        changed = true;
      }
    }
  }
  return key;
}

/** The ERP client a customer name matches, if any. */
export function matchErpClient<T extends { nameKey: string }>(
  name: string | null | undefined,
  byKey: ReadonlyMap<string, T>,
): T | null {
  const key = clientKey(name);
  return key ? (byKey.get(key) ?? null) : null;
}

const SYMBOLS: Record<string, string> = {
  $: "USD", us$: "USD", usd: "USD", dollar: "USD", "us dollar": "USD", dollars: "USD",
  "€": "EUR", eur: "EUR", euro: "EUR", euros: "EUR",
  "£": "GBP", gbp: "GBP", pound: "GBP",
  "₹": "INR", inr: "INR", rs: "INR", rupee: "INR", rupees: "INR",
  aed: "AED", dirham: "AED",
};

/**
 * A currency as the ERP's books write it, as a three-letter code.
 *
 * "$", "US$" and "usd" are all USD; "€" and "Euro" are EUR. Anything that is
 * neither a known word nor a plain three-letter code is not a currency and
 * gives null — it is never guessed.
 */
export function toCurrencyCode(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const word = t.toLowerCase().replace(/\.$/, "");
  if (word in SYMBOLS) return SYMBOLS[word];
  return /^[a-z]{3}$/i.test(t) ? t.toUpperCase() : null;
}

/** The columns an uploaded client list is read from. */
const COLUMNS = {
  name: /^(customer|client|party|buyer)( name)?$|^name$|customer name|client name/,
  currency: /currency/,
  country: /country/,
  paymentTerms: /payment terms?/,
};

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v && "text" in v) return String((v as { text: unknown }).text ?? "").trim();
  if (typeof v === "object" && v && "result" in v) return String((v as { result: unknown }).result ?? "").trim();
  return String(v).trim();
}

export interface ClientListRead {
  clients: ErpClient[];
  /** Rows with a name but no currency the reader could recognise. */
  withoutCurrency: number;
  /** Names that appeared more than once; the first one with a currency wins. */
  duplicates: number;
  /** Why nothing was read, when nothing was. */
  problem: string | null;
}

/**
 * Read a client list from rows of cells — every sheet of a workbook, or a CSV.
 *
 * The header row is found rather than assumed: the first row, within the first
 * ten of a sheet, that has a name column and a currency column. The ERP's own
 * "Customer list" sheets ("Customer Name", "Currency", "Country", "Payment
 * Terms") read as they are.
 */
export function readClientList(sheets: unknown[][][]): ClientListRead {
  const byKey = new Map<string, ErpClient>();
  let withoutCurrency = 0;
  let duplicates = 0;
  let headerSeen = false;

  for (const rows of sheets) {
    const headerAt = rows.slice(0, 10).findIndex((r) => {
      const heads = r.map((c) => cell(c).toLowerCase());
      return heads.some((h) => COLUMNS.name.test(h)) && heads.some((h) => COLUMNS.currency.test(h));
    });
    if (headerAt < 0) continue;
    headerSeen = true;

    const heads = rows[headerAt].map((c) => cell(c).toLowerCase());
    const col = (rx: RegExp) => heads.findIndex((h) => rx.test(h));
    const at = { name: col(COLUMNS.name), currency: col(COLUMNS.currency), country: col(COLUMNS.country), terms: col(COLUMNS.paymentTerms) };

    for (const row of rows.slice(headerAt + 1)) {
      const name = cell(row[at.name]);
      if (!name) continue;
      const nameKey = clientKey(name);
      if (!nameKey) continue;
      const currency = toCurrencyCode(cell(row[at.currency]));
      if (!currency) withoutCurrency += 1;

      const client: ErpClient = {
        name,
        nameKey,
        currency,
        country: at.country >= 0 ? cell(row[at.country]) || null : null,
        paymentTerms: at.terms >= 0 ? cell(row[at.terms]) || null : null,
      };
      const seen = byKey.get(nameKey);
      if (seen) {
        duplicates += 1;
        // the first one wins, unless it had no currency and this one does
        if (!seen.currency && client.currency) byKey.set(nameKey, client);
        continue;
      }
      byKey.set(nameKey, client);
    }
  }

  return {
    clients: [...byKey.values()],
    withoutCurrency,
    duplicates,
    problem: headerSeen
      ? byKey.size === 0
        ? "The list has the right columns but no client names under them."
        : null
      : "No sheet has a customer name column and a currency column in its first ten rows.",
  };
}

/** A CSV file as rows of cells. Quoted fields, doubled quotes and CRLF are handled. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const body = text.replace(/^﻿/, "");

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
