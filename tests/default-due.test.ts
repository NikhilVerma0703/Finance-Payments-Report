/**
 * The default credit period (owner, 24 Oct 2026: "Any invoice over 150 days
 * from the invoice date must be marked as overdue. (Default overdue time)").
 *
 * Where nothing recorded gives a due date — no terms, wording nobody could
 * read, or the date the terms count from not recorded — the invoice falls due
 * that many days after its invoice date, and is Overdue after that. It never
 * overrides a due date the terms or an entered date give, and 0 switches it
 * off. TODAY is 12 Oct 2026; the default is 150 days.
 */
import { describe, expect, it } from "vitest";

import { dueByWeek } from "@/lib/payments/overview";
import { TRACKING_DEFAULTS } from "@/lib/payments/record";
import { NO_DEFAULT, TODAY, tracked } from "./helpers";

const DEFAULT = TRACKING_DEFAULTS;

describe("the default credit period", () => {
  it("is 150 days unless Settings & Rules says otherwise", () => {
    expect(TRACKING_DEFAULTS.defaultDueDays).toBe(150);
  });

  it("makes an invoice with no terms overdue 150 days after its invoice date", () => {
    // 1 May + 150 days = 28 Sep; 14 days late on 12 Oct
    const i = tracked({ invoiceDate: "2026-05-01", paymentTerms: null }, [], DEFAULT);
    expect(i.schedule.dueDate).toBe("2026-09-28");
    expect(i.schedule.dueDateSource).toBe("default");
    expect(i.status).toBe("OVERDUE");
    expect(i.overdueDays).toBe(14);
    expect(i.schedule.overdueAmount).toBe(1000);
    expect(i.overdueSince).toBe("2026-09-29");
    expect(i.ageing).not.toBe("No due date");
  });

  it("leaves a younger invoice not yet due, with its due date ahead", () => {
    const i = tracked({ invoiceDate: "2026-08-01", paymentTerms: null }, [], DEFAULT);
    expect(i.schedule.dueDate).toBe("2026-12-29");
    expect(i.status).toBe("UNPAID");
    expect(i.schedule.overdueAmount).toBe(0);
  });

  it("stands in for a missing BL date, portion by portion", () => {
    const i = tracked({ invoiceDate: "2026-05-01", paymentTerms: "90 Days From BL Date", blDate: null }, [], DEFAULT);
    expect(i.schedule.milestones[0].assumed).toBe(true);
    expect(i.schedule.milestones[0].dueDate).toBe("2026-09-28");
    expect(i.schedule.dueDateSource).toBe("default");
    expect(i.status).toBe("OVERDUE");
    expect(i.schedule.requiresVerification).toBe(false);
  });

  it("stands in for terms nobody could read", () => {
    const i = tracked({ invoiceDate: "2026-05-01", paymentTerms: "as agreed with Mr X" }, [], DEFAULT);
    expect(i.schedule.term.unknown).toBe(true);
    expect(i.schedule.dueDate).toBe("2026-09-28");
    expect(i.status).toBe("OVERDUE");
  });

  it("never overrides the terms when their date is recorded", () => {
    const i = tracked({ invoiceDate: "2026-05-01", paymentTerms: "90 Days From BL Date", blDate: "2026-07-01" }, [], DEFAULT);
    expect(i.schedule.dueDate).toBe("2026-09-29");
    expect(i.schedule.dueDateSource).toBe("calculated");
    expect(i.schedule.milestones[0].assumed).toBe(false);
  });

  it("never overrides an entered due date", () => {
    const i = tracked({ invoiceDate: "2026-05-01", enteredDueDate: "2026-12-01" }, [], DEFAULT);
    expect(i.schedule.dueDate).toBe("2026-12-01");
    expect(i.schedule.dueDateSource).toBe("entered");
  });

  it("says so where a reader looks: the due date's note and the attention list", () => {
    const i = tracked({ invoiceDate: "2026-05-01", paymentTerms: null }, [], DEFAULT);
    expect(i.schedule.dueDateNote).toMatch(/default applies: invoice date 2026-05-01 \+ 150 days/);
    expect(i.attentionReasons.some((r) => r.startsWith("Due date assumed"))).toBe(true);
  });

  it("follows the period set in Settings & Rules", () => {
    const i = tracked({ invoiceDate: "2026-05-01", paymentTerms: null }, [], { ...DEFAULT, defaultDueDays: 180 });
    expect(i.schedule.dueDate).toBe("2026-10-28");
    expect(i.status).not.toBe("OVERDUE");
  });

  it("set to 0, gives no due date and Requires verification, as before", () => {
    const i = tracked({ invoiceDate: "2026-05-01", paymentTerms: null }, [], NO_DEFAULT);
    expect(i.schedule.dueDate).toBeNull();
    expect(i.status).toBe("REQUIRES_VERIFICATION");
  });

  it("cannot help an invoice with no invoice date", () => {
    const i = tracked({ invoiceDate: null, paymentTerms: null }, [], DEFAULT);
    expect(i.schedule.dueDate).toBeNull();
    expect(i.status).toBe("REQUIRES_VERIFICATION");
  });

  it("puts a defaulted balance in the week it falls due, not under No date", () => {
    const i = tracked({ invoiceDate: "2026-05-01", paymentTerms: null }, [], DEFAULT);
    const weeks = dueByWeek([i], TODAY);
    expect(weeks.find((w) => w.kind === "nodate")!.amount).toBe(0);
    expect(weeks.find((w) => w.from === "2026-09-28")!.amount).toBe(1000);
  });
});
