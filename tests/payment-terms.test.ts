/**
 * The payment-term engine.
 *
 * The worked example from the brief is the first test, because it is the one a
 * person will check by hand: BL date 30 May 2026 on a "120 days from BL date"
 * term is due 27 September 2026, and overdue days run from today.
 *
 * The rest protects three things:
 *
 *   1. **The bases are not interchangeable.** A term counted from the BL date
 *      must not quietly fall back to the invoice date, which is usually a few
 *      days earlier and would make every invoice fall due early.
 *   2. **CAD needs a presentation date.** Without one there is no due date, and
 *      the invoice says so rather than being given one.
 *   3. **A split term is two due dates.** 70% CAD + 30% at 90 days is only
 *      partly due for three months, and money settles against the earlier
 *      portion first.
 */
import { describe, expect, it } from "vitest";

import {
  BASIS_LABELS,
  buildSchedule,
  readTerm,
  splitByPercent,
  type BasisDates,
} from "@/lib/payments/terms";

const TODAY = "2026-10-09";

describe("the worked example from the brief", () => {
  it("120 days from a BL date of 30-May-2026 is due 27-Sep-2026", () => {
    const s = buildSchedule({
      paymentTerms: "120 Days From BL Date",
      invoiceValue: 100000,
      basisDates: { BL_DATE: "2026-05-30" },
      today: TODAY,
    });
    expect(s.dueDate).toBe("2026-09-27");
    expect(s.dueDateSource).toBe("calculated");
  });

  it("counts overdue days from the current date", () => {
    const s = buildSchedule({
      paymentTerms: "120 Days From BL Date",
      invoiceValue: 100000,
      basisDates: { BL_DATE: "2026-05-30" },
      today: TODAY,
    });
    // 27 Sep to 9 Oct 2026
    expect(s.overdueDays).toBe(12);
    expect(s.overdueAmount).toBe(100000);
  });

  it("counts calendar days, not working days", () => {
    const s = buildSchedule({
      paymentTerms: "90 Days From BL Date",
      invoiceValue: 1000,
      basisDates: { BL_DATE: "2026-01-01" },
      today: TODAY,
    });
    expect(s.dueDate).toBe("2026-04-01");
  });
});

describe("the four spellings of one term are one term", () => {
  const spellings = [
    "120 Days From the Date of BL",
    "120 Days From BL Date",
    "120 Days From The Date Of BL",
    "100% at 120 Days From BL Date",
  ];

  it.each(spellings)("%s → 100%% at 120 days from the BL date", (text) => {
    const t = readTerm(text);
    expect(t.unknown).toBe(false);
    expect(t.milestones).toHaveLength(1);
    expect(t.milestones[0]).toMatchObject({ percent: 100, days: 120, basis: "BL_DATE" });
  });

  it("gives them all the same key, so they group and filter together", () => {
    expect(new Set(spellings.map((s) => readTerm(s).key)).size).toBe(1);
  });

  it("keeps 90 days apart from 120", () => {
    expect(readTerm("90 days From BL Date").milestones[0].days).toBe(90);
    expect(readTerm("90 days From BL Date").key).not.toBe(readTerm("120 Days From BL Date").key);
  });

  it("preserves the wording exactly as it was written", () => {
    expect(readTerm("  120 Days From the Date of BL  ").raw).toBe("120 Days From the Date of BL");
  });
});

describe("the date bases are not interchangeable", () => {
  const dates: BasisDates = {
    INVOICE_DATE: "2026-01-01",
    BL_DATE: "2026-01-09",
    ETA: "2026-02-15",
    DOCS_PRESENTED: "2026-01-20",
  };

  it("uses the BL date for a BL term, not the invoice date", () => {
    const s = buildSchedule({
      paymentTerms: "120 days from BL date",
      invoiceValue: 1000,
      basisDates: dates,
      today: TODAY,
    });
    // 9 Jan + 120, not 1 Jan + 120
    expect(s.dueDate).toBe("2026-05-09");
  });

  it("uses the invoice date when the term says so", () => {
    const s = buildSchedule({
      paymentTerms: "30 days from invoice date",
      invoiceValue: 1000,
      basisDates: dates,
      today: TODAY,
    });
    expect(s.dueDate).toBe("2026-01-31");
  });

  it("uses the ETA when the term says so", () => {
    const s = buildSchedule({
      paymentTerms: "45 days from ETA",
      invoiceValue: 1000,
      basisDates: dates,
      today: TODAY,
    });
    expect(s.dueDate).toBe("2026-04-01");
  });

  it("labels every basis in words, for the screen", () => {
    expect(BASIS_LABELS.BL_DATE).toBe("BL date");
    expect(BASIS_LABELS.DOCS_PRESENTED).toBe("presentation of documents");
  });
});

describe("CAD hinges on the documents being presented", () => {
  it("is due on presentation when that date is known", () => {
    const s = buildSchedule({
      paymentTerms: "100% Cash Against Document (CAD)",
      invoiceValue: 1000,
      basisDates: { DOCS_PRESENTED: "2026-01-20", BL_DATE: "2026-01-09" },
      today: TODAY,
    });
    expect(s.dueDate).toBe("2026-01-20");
    expect(s.term.milestones[0].basis).toBe("DOCS_PRESENTED");
  });

  it("produces no due date at all when it is not, and says why", () => {
    const s = buildSchedule({
      paymentTerms: "100% At Cash Against Documents (CAD)",
      invoiceValue: 1000,
      basisDates: { BL_DATE: "2026-01-09", INVOICE_DATE: "2026-01-01" },
      today: TODAY,
    });
    expect(s.dueDate).toBeNull();
    expect(s.requiresVerification).toBe(true);
    expect(s.verificationReasons.join(" ")).toMatch(/presentation of documents is not recorded/);
  });

  it("does not silently fall back to the BL date", () => {
    const s = buildSchedule({
      paymentTerms: "100% CAD",
      invoiceValue: 1000,
      basisDates: { BL_DATE: "2026-01-09" },
      today: TODAY,
    });
    expect(s.dueDate).not.toBe("2026-01-09");
    expect(s.dueDate).toBeNull();
  });

  it("reads 'at sight', 'D/P' and 'on presentation' the same way", () => {
    for (const text of ["LC at sight", "D/P", "payment on presentation"]) {
      expect(readTerm(text).milestones[0].basis, text).toBe("DOCS_PRESENTED");
    }
  });

  it("reads documents against acceptance as credit from the BL date", () => {
    const t = readTerm("D/A 60 days");
    expect(t.milestones[0]).toMatchObject({ days: 60, basis: "BL_DATE" });
  });
});

describe("a split term is two due dates", () => {
  const SPLIT = "70% Cash Against Documents (CAD), Balance 30% at 90 Days";
  const dates: BasisDates = { DOCS_PRESENTED: "2026-01-20", BL_DATE: "2026-01-09" };

  it("reads 70% on presentation and 30% ninety days later", () => {
    const t = readTerm(SPLIT);
    expect(t.milestones).toHaveLength(2);
    expect(t.milestones[0]).toMatchObject({ percent: 70, days: 0, basis: "DOCS_PRESENTED" });
    expect(t.milestones[1]).toMatchObject({ percent: 30, days: 90 });
  });

  it("records that the wording never said what the 90 days run from", () => {
    const t = readTerm(SPLIT);
    expect(t.milestones[1].basis).toBe("BL_DATE");
    expect(t.assumptions.join(" ")).toMatch(/does not say what its 90 days run from/);
    expect(t.assumptions.join(" ")).toMatch(/confirm with the customer/i);
  });

  it("splits the invoice value exactly", () => {
    const s = buildSchedule({
      paymentTerms: SPLIT,
      invoiceValue: 26126.33,
      basisDates: dates,
      today: TODAY,
    });
    const amounts = s.milestones.map((m) => m.amount ?? 0);
    expect(amounts[0]).toBeCloseTo(18288.43, 2);
    expect(Math.round((amounts[0] + amounts[1]) * 100) / 100).toBe(26126.33);
  });

  it("counts only the portion that has fallen due as overdue", () => {
    // on 1 Mar 2026 the 70% is late and the 30% (due 9 Apr) is not
    const s = buildSchedule({
      paymentTerms: SPLIT,
      invoiceValue: 100000,
      basisDates: dates,
      settled: 0,
      today: "2026-03-01",
    });
    expect(s.overdueAmount).toBe(70000);
    expect(s.milestones[0].state).toBe("OVERDUE");
    expect(s.milestones[1].state).toBe("NOT_DUE");
  });

  it("settles money against the earlier portion first", () => {
    const s = buildSchedule({
      paymentTerms: SPLIT,
      invoiceValue: 100000,
      basisDates: dates,
      settled: 50000,
      today: "2026-03-01",
    });
    expect(s.milestones[0].settled).toBe(50000);
    expect(s.milestones[0].outstanding).toBe(20000);
    expect(s.milestones[1].settled).toBe(0);
  });

  it("moves the invoice's due date on by itself once the first portion is paid", () => {
    const s = buildSchedule({
      paymentTerms: SPLIT,
      invoiceValue: 100000,
      basisDates: dates,
      settled: 70000,
      today: "2026-03-01",
    });
    expect(s.dueDate).toBe("2026-04-09");
    expect(s.overdueAmount).toBe(0);
  });

  it("gives no date for a portion whose basis is missing, while still dating the other", () => {
    const s = buildSchedule({
      paymentTerms: SPLIT,
      invoiceValue: 100000,
      basisDates: { BL_DATE: "2026-01-09" }, // no presentation date
      today: "2026-03-01",
    });
    expect(s.milestones[0].dueDate).toBeNull();
    expect(s.milestones[1].dueDate).toBe("2026-04-09");
    expect(s.verificationReasons.join(" ")).toMatch(/presentation of documents/);
  });
});

describe("splitting a value by percentage", () => {
  it("adds up exactly, whatever the rounding", () => {
    for (const value of [100, 100.01, 26126.33, 659461.36, 0.03, 7.77]) {
      const pieces = splitByPercent(value, [70, 30]);
      expect(Math.round(pieces.reduce((a, b) => a + b, 0) * 100) / 100, `value ${value}`).toBe(value);
    }
  });

  it("works for a three-way split too", () => {
    const pieces = splitByPercent(100, [33.34, 33.33, 33.33]);
    expect(Math.round(pieces.reduce((a, b) => a + b, 0) * 100) / 100).toBe(100);
  });
});

describe("an entered due date overrides the calculation", () => {
  it("is used in preference, and labelled as entered", () => {
    const s = buildSchedule({
      paymentTerms: "120 Days From BL Date",
      invoiceValue: 1000,
      basisDates: { BL_DATE: "2026-05-30" },
      enteredDueDate: "2026-04-16",
      today: TODAY,
    });
    expect(s.dueDate).toBe("2026-04-16");
    expect(s.dueDateSource).toBe("entered");
    expect(s.dueDateNote).toMatch(/cannot be checked/);
  });

  it("works even with no payment terms at all", () => {
    const s = buildSchedule({
      paymentTerms: null,
      invoiceValue: 1000,
      basisDates: {},
      enteredDueDate: "2026-04-16",
      today: TODAY,
    });
    expect(s.dueDate).toBe("2026-04-16");
    expect(s.requiresVerification).toBe(false);
  });
});

describe("what it refuses to guess", () => {
  it("produces nothing from no terms", () => {
    const s = buildSchedule({ paymentTerms: null, invoiceValue: 1000, basisDates: {}, today: TODAY });
    expect(s.dueDate).toBeNull();
    expect(s.term.unknown).toBe(true);
    expect(s.milestones).toHaveLength(0);
  });

  it("produces nothing from wording it cannot read, and names it", () => {
    const s = buildSchedule({
      paymentTerms: "as agreed verbally",
      invoiceValue: 1000,
      basisDates: { BL_DATE: "2026-01-09" },
      today: TODAY,
    });
    expect(s.dueDate).toBeNull();
    expect(s.term.unknown).toBe(true);
    expect(s.verificationReasons.join(" ")).toMatch(/"as agreed verbally" was not recognised/);
  });

  it("records an assumption when days are given with no basis", () => {
    const t = readTerm("60 days");
    expect(t.milestones[0]).toMatchObject({ days: 60, basis: "BL_DATE" });
    expect(t.assumptions.join(" ")).toMatch(/not what they run from/);
  });

  it("measures an advance from the invoice date, and says why", () => {
    const t = readTerm("100% advance");
    expect(t.milestones[0].basis).toBe("INVOICE_DATE");
    expect(t.assumptions.join(" ")).toMatch(/before shipment/);
  });

  it("has nothing to date when the invoice has no value", () => {
    const s = buildSchedule({
      paymentTerms: "120 Days From BL Date",
      invoiceValue: null,
      basisDates: { BL_DATE: "2026-05-30" },
      today: TODAY,
    });
    expect(s.milestones[0].amount).toBeNull();
    expect(s.dueDate).toBe("2026-09-27");
  });
});

describe("the terms the reference sheets actually contain", () => {
  it.each([
    ["120 Days From the Date of BL", false],
    ["120 Days From BL Date", false],
    ["90 days From BL Date", false],
    ["100% at 120 Days From BL Date", false],
    ["120 Days From The Date Of BL", false],
    ["100% At Cash Against Documents (CAD)", false],
    ["100% Cash Against Document (CAD)", false],
    ["70% Cash Against Documents (CAD), Balance 30% at 90 Days", false],
  ])("reads %s", (text, unknown) => {
    expect(readTerm(text).unknown).toBe(unknown);
  });
});
