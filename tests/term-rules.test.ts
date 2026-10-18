/**
 * Payment-term rules from Settings & Rules, and the entered-due-date fix.
 */
import { describe, expect, it } from "vitest";

import { buildSchedule, matchRule, readTerm, validateRule, type TermRule } from "@/lib/payments/terms";
import { toTermRule } from "@/server/payments/settings";
import { TODAY, tracked } from "./helpers";

const rule = (over: Partial<TermRule> = {}): TermRule => ({
  id: "r1",
  name: "Advance and BL",
  matchText: "60% advance, balance 40% against BL copy",
  matchMode: "EXACT",
  milestones: [
    { percent: 60, days: 0, basis: "INVOICE_DATE" },
    { percent: 40, days: 15, basis: "BL_DATE" },
  ],
  active: true,
  ...over,
});

describe("validating a rule", () => {
  it("accepts portions adding up to 100%", () => {
    expect(validateRule({ name: "x", matchText: "y", milestones: rule().milestones })).toEqual([]);
  });

  it("refuses portions that do not add up to 100%", () => {
    const errors = validateRule({
      name: "x",
      matchText: "y",
      milestones: [
        { percent: 60, days: 0, basis: "INVOICE_DATE" },
        { percent: 30, days: 15, basis: "BL_DATE" },
      ],
    });
    expect(errors.join(" ")).toMatch(/add up to 90%/);
  });

  it("refuses a missing name, wording, bad days or an unknown basis", () => {
    const errors = validateRule({
      name: "",
      matchText: " ",
      milestones: [{ percent: 100, days: -1, basis: "SOMEDAY" }],
    });
    expect(errors).toHaveLength(4);
  });
});

describe("matching a wording", () => {
  it("exact ignores case and spacing", () => {
    expect(matchRule("60%  Advance, balance 40% against bl copy", [rule()])?.id).toBe("r1");
    expect(matchRule("60% advance", [rule()])).toBeNull();
  });

  it("contains matches inside a longer wording, longest first", () => {
    const short = rule({ id: "s", matchMode: "CONTAINS", matchText: "advance" });
    const long = rule({ id: "l", matchMode: "CONTAINS", matchText: "60% advance" });
    expect(matchRule("Payment: 60% advance then balance", [short, long])?.id).toBe("l");
  });

  it("exact wins over contains, and an inactive rule never applies", () => {
    const contains = rule({ id: "c", matchMode: "CONTAINS", matchText: "advance" });
    expect(matchRule(rule().matchText, [contains, rule()])?.id).toBe("r1");
    expect(matchRule(rule().matchText, [rule({ active: false })])).toBeNull();
  });
});

describe("a rule drives the due date everywhere", () => {
  it("is read before the built-in readings", () => {
    const t = readTerm(rule().matchText, [rule()]);
    expect(t.unknown).toBe(false);
    expect(t.rule?.name).toBe("Advance and BL");
    expect(t.description).toBe("60% on the invoice date, then 40% 15 days from the BL date");
    // without the rule the same wording reads differently
    expect(readTerm(rule().matchText).rule).toBeUndefined();
  });

  it("can override a built-in reading", () => {
    const override = rule({ matchText: "120 Days From BL Date", milestones: [{ percent: 100, days: 90, basis: "BL_DATE" }] });
    const s = buildSchedule({
      paymentTerms: "120 days from bl date",
      invoiceValue: 1000,
      basisDates: { BL_DATE: "2026-05-01" },
      rules: [override],
      today: TODAY,
    });
    expect(s.dueDate).toBe("2026-07-30");
  });

  it("splits the value and dates each portion", () => {
    const i = tracked(
      {
        paymentTerms: rule().matchText,
        invoiceDate: "2026-09-01",
        blDate: "2026-09-10",
        customerInvoiceValue: 1000,
        receipts: [{ seq: 1, amountFcy: 600 }],
      },
      [rule()],
    );
    expect(i.schedule.milestones.map((m) => [m.amount, m.dueDate, m.state])).toEqual([
      [600, "2026-09-01", "PAID"],
      [400, "2026-09-25", "OVERDUE"],
    ]);
    expect(i.schedule.overdueAmount).toBe(400);
    expect(i.status).toBe("OVERDUE");
  });

  it("still invents nothing: no basis date, no due date", () => {
    const i = tracked({ paymentTerms: rule().matchText, invoiceDate: "2026-09-01", customerInvoiceValue: 1000 }, [rule()]);
    expect(i.schedule.milestones[1].dueDate).toBeNull();
  });

  it("a stored rule with a malformed portion loses that portion", () => {
    const parsed = toTermRule({
      id: "x",
      name: "n",
      matchText: "m",
      matchMode: "CONTAINS",
      active: true,
      milestones: JSON.stringify([{ percent: 100, days: 30, basis: "BL_DATE" }, { percent: "x", basis: "NOPE" }]),
    });
    expect(parsed.matchMode).toBe("CONTAINS");
    expect(parsed.milestones).toEqual([{ percent: 100, days: 30, basis: "BL_DATE" }]);
  });
});

describe("an entered due date makes the invoice overdue even without recognised terms", () => {
  it("reports the outstanding as past due once the entered date has passed", () => {
    const i = tracked({
      paymentTerms: null,
      enteredDueDate: "2026-06-01",
      customerInvoiceValue: 1000,
      receipts: [{ seq: 1, amountFcy: 250 }],
    });
    expect(i.schedule.overdueAmount).toBe(750);
    expect(i.status).toBe("OVERDUE");
    expect(i.overdueSince).toBe("2026-06-02");
  });

  it("and nothing past due before it", () => {
    const i = tracked({ enteredDueDate: "2026-12-01", customerInvoiceValue: 1000 });
    expect(i.schedule.overdueAmount).toBe(0);
  });
});
