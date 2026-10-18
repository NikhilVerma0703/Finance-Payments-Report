/**
 * Currency formatting: the grouping follows the currency, not the reader.
 *
 * The bug these pin down printed every figure with Indian digit grouping, so a
 * USD total of 1,331,027.96 appeared as 13,31,027.96 — a number a reader
 * transcribes wrongly rather than merely finds ugly.
 */
import { describe, expect, it } from "vitest";

import {
  currencySymbol,
  formatCount,
  formatHome,
  formatMoney,
  formatRate,
  toHome,
} from "@/lib/money";

describe("the grouping follows the currency", () => {
  it("writes USD in thousands with a dollar sign", () => {
    expect(formatMoney(1331027.96, "USD")).toBe("$1,331,027.96");
  });

  it("writes INR in lakhs and crores with a rupee sign", () => {
    expect(formatMoney(1331027.96, "INR")).toBe("₹13,31,027.96");
  });

  it("never gives a USD figure Indian grouping", () => {
    expect(formatMoney(1331027.96, "USD")).not.toContain("13,31,027");
  });

  it("never gives an INR figure international grouping", () => {
    expect(formatMoney(1331027.96, "INR")).not.toContain("1,331,027");
  });

  it("handles the other currencies these invoices use", () => {
    expect(formatMoney(1000, "EUR")).toContain("1.000,00"); // German separators
    expect(formatMoney(1000, "GBP")).toBe("£1,000.00");
  });

  it("drops the decimals on a currency that has none", () => {
    // the yen glyph varies by ICU version, so assert the number, not the sign
    expect(formatMoney(1500, "JPY")).toContain("1,500");
    expect(formatMoney(1500, "JPY")).not.toContain(".00");
  });
});

describe("what it does when the currency is not known", () => {
  it("prints plain grouped digits and no symbol", () => {
    expect(formatMoney(1331027.96, null)).toBe("1,331,027.96");
    expect(formatMoney(1331027.96, "")).toBe("1,331,027.96");
  });

  it("names an unconfigured currency instead of inventing a symbol", () => {
    expect(formatMoney(1000, "KWD")).toBe("1,000.00 KWD");
  });

  it("ignores a currency column holding something that is not a code", () => {
    expect(formatMoney(1000, "US$")).toBe("1,000.00");
    expect(formatMoney(1000, "see note")).toBe("1,000.00");
  });

  it("accepts a lowercase or padded code", () => {
    expect(formatMoney(1000, " usd ")).toBe("$1,000.00");
  });
});

describe("blanks are blank, not zero", () => {
  it("prints an em dash for nothing", () => {
    expect(formatMoney(null, "USD")).toBe("—");
    expect(formatMoney(undefined, "USD")).toBe("—");
    expect(formatRate(null)).toBe("—");
  });

  it("refuses a figure that is not finite", () => {
    expect(formatMoney(Number.NaN, "USD")).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY, "USD")).toBe("—");
  });

  it("takes a different blank where a table wants one", () => {
    expect(formatMoney(null, "USD", { blank: "" })).toBe("");
  });

  it("can drop the symbol for a dense column", () => {
    expect(formatMoney(1331027.96, "USD", { symbol: false })).toBe("1,331,027.96");
    expect(formatMoney(1331027.96, "INR", { symbol: false })).toBe("13,31,027.96");
  });
});

describe("the home-currency equivalent", () => {
  it("is amount × rate", () => {
    expect(toHome(26756.27, 83.25)).toBeCloseTo(2227459.48, 2);
  });

  it("is null, never zero, when the rate is missing", () => {
    expect(toHome(26756.27, null)).toBeNull();
    expect(toHome(26756.27, 0)).toBeNull();
    expect(toHome(26756.27, -5)).toBeNull();
  });

  it("is null when the amount is missing", () => {
    expect(toHome(null, 83.25)).toBeNull();
  });

  it("formats in rupees", () => {
    expect(formatHome(26756.27, 83.25)).toBe("₹22,27,459.48");
  });

  it("shows an em dash rather than ₹0.00 when there is no rate", () => {
    expect(formatHome(26756.27, null)).toBe("—");
  });
});

describe("rates and counts", () => {
  it("keeps four decimals on a rate", () => {
    expect(formatRate(83.2537)).toBe("83.2537");
    expect(formatRate(83.25)).toBe("83.25");
  });

  it("counts whole things", () => {
    expect(formatCount(41)).toBe("41");
    expect(formatCount(null)).toBe("—");
  });

  it("gives a symbol for a column header", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("INR")).toBe("₹");
    expect(currencySymbol(null)).toBe("");
    expect(currencySymbol("KWD")).toBe("KWD");
  });
});
