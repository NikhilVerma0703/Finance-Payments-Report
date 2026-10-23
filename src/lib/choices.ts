/**
 * The fixed lists every dropdown in the application chooses from.
 *
 * A currency or a country typed freely comes back as "US$", "usd", "U.S.A." and
 * "United States" across four records, and none of them groups with the
 * others. Picking from a list removes that whole class of mismatch. A value
 * already on a record that is not on the list is always offered as well, so
 * opening an old record never quietly drops what it says.
 */

/** The currencies these customers are actually invoiced in come first. */
export const CURRENCIES = [
  "USD", "EUR", "GBP", "INR", "AED", "AUD", "CAD", "SGD", "CHF", "JPY", "CNY", "ZAR",
  "SAR", "NZD", "HKD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "TRY", "MXN",
  "BRL", "QAR", "KWD", "OMR", "BHD", "ILS", "KRW", "MYR", "THB", "IDR", "VND", "PHP",
] as const;

/** "USD — US Dollar". The name is the runtime's own, so nothing is hand-typed. */
export function currencyLabel(code: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "currency" }).of(code);
    return name && name !== code ? `${code} — ${name}` : code;
  } catch {
    return code;
  }
}

/** The currency list, with any value already on file that is not in it. */
export function currencyOptions(...current: Array<string | null | undefined>): string[] {
  const extra = current
    .map((c) => (c ?? "").trim().toUpperCase())
    .filter((c) => c && !(CURRENCIES as readonly string[]).includes(c));
  return [...CURRENCIES, ...new Set(extra)];
}

/**
 * ISO 3166 country codes. Only the codes are written here; the names come from
 * `Intl.DisplayNames`, so they are spelt the same everywhere.
 */
const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW " +
  "BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES " +
  "ET FI FJ FM FO FR GA GB GD GE GH GI GL GM GN GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IN " +
  "IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA " +
  "MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NZ OM PA " +
  "PE PF PG PH PK PL PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR " +
  "SS ST SV SX SY SZ TC TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI " +
  "VN VU WS XK YE ZA ZM ZW"
).split(" ");

let countryNames: string[] | null = null;

/** Every country by its English name, A to Z. */
export function countries(): string[] {
  if (countryNames) return countryNames;
  let names: string[];
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    names = COUNTRY_CODES.map((c) => dn.of(c) ?? c);
  } catch {
    names = COUNTRY_CODES;
  }
  countryNames = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  return countryNames;
}

/** The country list, with any value already on file that is not in it. */
export function countryOptions(...current: Array<string | null | undefined>): string[] {
  const list = countries();
  const known = new Set(list.map((c) => c.toLowerCase()));
  const extra = current
    .map((c) => (c ?? "").trim())
    .filter((c) => c && !known.has(c.toLowerCase()));
  return [...new Set(extra), ...list];
}
