/**
 * Matching customers to the main ERP's client list, and reading that list.
 * A wrong currency is worse than none, so matching is exact on a normalised
 * name and never fuzzy.
 */
import { describe, expect, it } from "vitest";

import {
  clientKey,
  matchErpClient,
  parseCsv,
  readClientList,
  toCurrencyCode,
} from "@/lib/payments/erpClients";

describe("client names", () => {
  it("match through case, punctuation and legal forms", () => {
    expect(clientKey("UNIQUE STONE BOUTIQUE LLC,")).toBe(clientKey("Unique Stone Boutique"));
    expect(clientKey("Quartz Surface Mexico S.A. DE C.V.")).toBe("quartz surface mexico");
    expect(clientKey("Stylz Trading Co")).toBe("stylz trading");
    expect(clientKey("M&G IMPORTS LLC")).toBe("m and g imports");
    expect(clientKey("Granit-Pol Spółka")).toBe("granit pol spolka");
  });

  it("do not match different firms", () => {
    expect(clientKey("Blue Planet Inc")).not.toBe(clientKey("Blue Planet Stone Inc"));
    const byKey = new Map([[clientKey("Kerasom"), { nameKey: clientKey("Kerasom"), currency: "EUR" }]]);
    expect(matchErpClient("KERASOM", byKey)?.currency).toBe("EUR");
    expect(matchErpClient("Kerasom Italia", byKey)).toBeNull();
  });
});

describe("currencies as the ERP writes them", () => {
  it("reads symbols and words, and refuses to guess", () => {
    expect(toCurrencyCode("$")).toBe("USD");
    expect(toCurrencyCode("US$")).toBe("USD");
    expect(toCurrencyCode("Euro")).toBe("EUR");
    expect(toCurrencyCode("€")).toBe("EUR");
    expect(toCurrencyCode("aed")).toBe("AED");
    expect(toCurrencyCode("dollars or euro")).toBeNull();
    expect(toCurrencyCode("")).toBeNull();
  });
});

describe("reading an uploaded client list", () => {
  it("finds the header row, and the first currency wins for a repeated name", () => {
    const read = readClientList([
      [
        ["PESPL customer list"],
        [],
        ["Sales Person", "Customer Name", "Country", "Currency", "Payment Terms"],
        ["A", "Imperial Granites", "USA", "$", "90 days from BL"],
        ["B", "Kerasom", "Italy", "Euro", null],
        ["C", "KERASOM", "Italy", "USD", null],
        ["D", "No Currency Ltd", "UK", "", null],
      ],
    ]);
    expect(read.problem).toBeNull();
    expect(read.clients).toHaveLength(3);
    expect(read.clients.find((c) => c.nameKey === "kerasom")?.currency).toBe("EUR");
    expect(read.clients.find((c) => c.name === "Imperial Granites")).toMatchObject({
      currency: "USD",
      country: "USA",
      paymentTerms: "90 days from BL",
    });
    expect(read.duplicates).toBe(1);
    expect(read.withoutCurrency).toBe(1);
  });

  it("says why when no sheet has the columns", () => {
    expect(readClientList([[["Name", "Country"], ["X", "USA"]]]).problem).toMatch(/currency column/);
  });

  it("reads a CSV with quotes, commas inside them and CRLF", () => {
    const csv = ["Customer Name,Currency", '"Stone, Inc",USD', '"Say ""hi""",EUR', ""].join("\r\n");
    expect(parseCsv(csv)).toEqual([
      ["Customer Name", "Currency"],
      ["Stone, Inc", "USD"],
      ['Say "hi"', "EUR"],
    ]);
  });
});
