/**
 * Payment terms, read as milestones.
 *
 * Self-contained: this file is the whole of the Payment Tracking section's
 * due-date logic and shares nothing with the Accounts Register's rule engine.
 *
 * ---------------------------------------------------------------------------
 * Why milestones rather than a single due date
 * ---------------------------------------------------------------------------
 * A term like "70% Cash Against Documents, Balance 30% at 90 Days" does not
 * describe one due date. Seventy per cent falls due when the documents are
 * presented and the remaining thirty per cent ninety days later, so for three
 * months the invoice is *partly* due. A single date can only say one of two
 * wrong things: that the whole invoice is overdue from day one, or that none of
 * it is until day ninety. Both would be defended to a customer holding the
 * correct figure.
 *
 * So every term resolves to a list of milestones, each with its own percentage,
 * offset in days, and — the part that matters most — its own **date basis**.
 *
 * ---------------------------------------------------------------------------
 * The four bases, and why they are not interchangeable
 * ---------------------------------------------------------------------------
 *   BL_DATE            the bill of lading date: when the goods were shipped.
 *                      Export credit terms are normally counted from here,
 *                      because it is the one date both sides can evidence.
 *   INVOICE_DATE       when the invoice was raised. Usually a few days before
 *                      the BL, so counting a "120 days from BL" term from the
 *                      invoice date makes the invoice fall due early.
 *   ETA                when the vessel arrives. Weeks after the BL on a long
 *                      route, and not a payment date at all unless the term
 *                      says so.
 *   DOCS_PRESENTED     when the documents were presented to the bank. This is
 *                      what CAD and "at sight" actually hinge on, and it is the
 *                      date nobody records on a statement — so a CAD invoice
 *                      without it is reported as *requiring verification*
 *                      rather than given a date.
 *
 * ---------------------------------------------------------------------------
 * What it will not do
 * ---------------------------------------------------------------------------
 * It never invents a basis date. Where the wording is a convention rather than
 * an instruction — "balance 30% at 90 days" does not say ninety days from
 * *what* — the reading is applied and recorded in `assumptions`, so the screen
 * can show it and somebody can correct it.
 */
import { addDays, daysBetween, round2, todayIso } from "../text";

export type DateBasis =
  | "BL_DATE"
  | "INVOICE_DATE"
  | "ETA"
  | "DOCS_PRESENTED"
  | "SHIPPING_BILL_DATE";

export const BASIS_LABELS: Record<DateBasis, string> = {
  BL_DATE: "BL date",
  INVOICE_DATE: "invoice date",
  ETA: "ETA / arrival date",
  DOCS_PRESENTED: "presentation of documents",
  SHIPPING_BILL_DATE: "shipping bill date",
};

/** The dates an invoice can offer a milestone to count from. */
export type BasisDates = Partial<Record<DateBasis, string | null>>;

export interface Milestone {
  seq: number;
  /** Share of the invoice value, 0 < percent <= 100. */
  percent: number;
  /** Calendar days after the basis date. */
  days: number;
  basis: DateBasis;
  /** "70% on presentation of documents" — for the screen. */
  label: string;
}

export interface TermDefinition {
  /** A stable key for grouping and filtering. */
  key: string;
  /** The wording as it was written, kept verbatim. */
  raw: string;
  /** What the system understood it to mean. */
  description: string;
  milestones: Milestone[];
  /** True when the wording could not be understood at all. */
  unknown: boolean;
  /** Readings applied where the wording did not actually say. */
  assumptions: string[];
  /** Set when a rule defined in Settings & Rules supplied this reading. */
  rule?: { id: string; name: string };
}

// ---------------------------------------------------------------------------
// Rules defined by the business
// ---------------------------------------------------------------------------

export const DATE_BASES: DateBasis[] = [
  "BL_DATE",
  "INVOICE_DATE",
  "DOCS_PRESENTED",
  "ETA",
  "SHIPPING_BILL_DATE",
];

export function isDateBasis(v: unknown): v is DateBasis {
  return typeof v === "string" && (DATE_BASES as string[]).includes(v);
}

export interface RuleMilestone {
  percent: number;
  days: number;
  basis: DateBasis;
}

/**
 * A payment-term wording given its meaning in Settings & Rules.
 *
 * Checked before the built-in readings, so it can also correct a wording the
 * engine reads differently from how the customer applies it.
 */
export interface TermRule {
  id: string;
  name: string;
  matchText: string;
  matchMode: "EXACT" | "CONTAINS";
  milestones: RuleMilestone[];
  active: boolean;
}

/**
 * Why a rule cannot be saved, or an empty list when it can.
 *
 * The portions must add up to exactly 100%, because the schedule splits the
 * invoice value by them and a value that does not add up to itself would leave
 * money that is never due — or due twice.
 */
export function validateRule(rule: {
  name?: string | null;
  matchText?: string | null;
  milestones: Array<{ percent: number | null; days: number | null; basis: string | null }>;
}): string[] {
  const errors: string[] = [];
  if (!(rule.name ?? "").trim()) errors.push("Give the rule a name.");
  if (!(rule.matchText ?? "").trim()) errors.push("Enter the payment-term wording the rule should recognise.");
  if (!rule.milestones.length) errors.push("Add at least one portion.");

  rule.milestones.forEach((m, i) => {
    const n = i + 1;
    if (m.percent === null || !Number.isFinite(m.percent) || m.percent <= 0 || m.percent > 100) {
      errors.push(`Portion ${n}: the percentage must be more than 0 and at most 100.`);
    }
    if (m.days === null || !Number.isInteger(m.days) || m.days < 0 || m.days > 3650) {
      errors.push(`Portion ${n}: days must be a whole number from 0 to 3650.`);
    }
    if (!isDateBasis(m.basis)) errors.push(`Portion ${n}: choose the date it is counted from.`);
  });

  const total = round2(rule.milestones.reduce((s, m) => s + (m.percent ?? 0), 0));
  if (rule.milestones.length && Math.abs(total - 100) > 0.01) {
    errors.push(`The portions add up to ${total}%. They must add up to exactly 100%.`);
  }
  return errors;
}

/**
 * The rule that applies to a wording, if any.
 *
 * An exact match wins over a "contains" match, and among "contains" rules the
 * longest wording wins — the most specific description of the term.
 */
export function matchRule(raw: string | null | undefined, rules: TermRule[]): TermRule | null {
  const norm = squash(raw ?? "");
  if (!norm) return null;
  const usable = rules.filter((r) => r.active && squash(r.matchText) && r.milestones.length);
  const exact = usable.find((r) => r.matchMode === "EXACT" && squash(r.matchText) === norm);
  if (exact) return exact;
  return (
    usable
      .filter((r) => r.matchMode === "CONTAINS" && norm.includes(squash(r.matchText)))
      .sort((a, b) => squash(b.matchText).length - squash(a.matchText).length)[0] ?? null
  );
}

function fromRule(text: string, rule: TermRule): TermDefinition {
  const milestones: Milestone[] = rule.milestones.map((m, i) => ({
    seq: i + 1,
    percent: m.percent,
    days: m.days,
    basis: m.basis,
    label: labelOf(m.percent, m.days, m.basis),
  }));
  return {
    key: `RULE_${rule.id}`,
    raw: text,
    description: milestones.map((m) => m.label).join(", then "),
    milestones,
    unknown: false,
    assumptions: [],
    rule: { id: rule.id, name: rule.name },
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const UNKNOWN: Omit<TermDefinition, "raw"> = {
  key: "UNKNOWN",
  description: "No payment terms recorded, so no due date can be worked out.",
  milestones: [],
  unknown: true,
  assumptions: [],
};

/**
 * The standard terms this engine understands, in the wording exporters use.
 *
 * Expressed as recognisers rather than a lookup table, because the same term
 * arrives spelled four different ways — "120 Days From the Date of BL",
 * "120 Days From BL Date", "100% at 120 Days From BL Date" and
 * "120 Days From The Date Of BL" all appear in the reference sheets.
 */
export const SUPPORTED_TERMS: Array<{ example: string; meaning: string }> = [
  { example: "120 Days From BL Date", meaning: "100% due 120 calendar days after the BL date" },
  { example: "90 Days From BL Date", meaning: "100% due 90 calendar days after the BL date" },
  {
    example: "100% CAD (Cash Against Documents)",
    meaning:
      "100% due when the documents are presented to the bank. Needs the presentation date — " +
      "without it the invoice is marked as requiring verification rather than given a date",
  },
  {
    example: "70% CAD + 30% at 90 Days",
    meaning:
      "70% on presentation of documents, 30% ninety days later. The wording does not say ninety " +
      "days from what, so the BL date is used and the assumption is recorded",
  },
  { example: "D/A 60 days", meaning: "Documents against acceptance — 100% due 60 days after the BL date" },
  { example: "D/P / at sight", meaning: "Documents against payment — 100% due on presentation" },
  { example: "30 days from invoice date", meaning: "100% due 30 days after the invoice date" },
  { example: "45 days from ETA", meaning: "100% due 45 days after the vessel's arrival" },
  { example: "100% advance", meaning: "100% due before shipment; measured from the invoice date" },
  { example: "LC at sight", meaning: "100% due on presentation of documents under the letter of credit" },
  { example: "LC 90 days", meaning: "100% due 90 days after the BL date under the letter of credit" },
];

/** Normalise for matching: lower case, single spaces, no punctuation noise. */
function squash(text: string): string {
  return text.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

function basisFrom(segment: string): { basis: DateBasis | null; explicit: boolean } {
  if (/\bfrom (the )?(date of )?b\/?l\b|\bfrom b\/?l( date)?\b|\bbl date\b/.test(segment)) {
    return { basis: "BL_DATE", explicit: true };
  }
  if (/\beta\b|\barrival\b/.test(segment)) return { basis: "ETA", explicit: true };
  if (/\binvoice date\b|\bfrom invoice\b|\bfrom the invoice\b/.test(segment)) {
    return { basis: "INVOICE_DATE", explicit: true };
  }
  if (/\bshipping bill\b|\bs\/?b date\b/.test(segment)) {
    return { basis: "SHIPPING_BILL_DATE", explicit: true };
  }
  if (
    /\bcad\b|cash against document|documents against payment|\bd\/?p\b|at sight|on presentation|against presentation/.test(
      segment,
    )
  ) {
    return { basis: "DOCS_PRESENTED", explicit: true };
  }
  if (/documents against acceptance|\bd\/?a\b|\bafter acceptance\b/.test(segment)) {
    return { basis: "BL_DATE", explicit: false };
  }
  return { basis: null, explicit: false };
}

function daysFrom(segment: string): number | null {
  const m = /(\d{1,3})\s*(?:calendar\s*)?days?/.exec(segment);
  return m ? Number(m[1]) : null;
}

function percentFrom(segment: string): number | null {
  const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(segment);
  return m ? Number(m[1]) : null;
}

/**
 * Split a term into the portions it describes.
 *
 * "70% Cash Against Documents (CAD), Balance 30% at 90 Days" splits on the
 * comma; "50% advance + 50% at 60 days from BL" on the plus. A term with no
 * separator is one portion.
 */
function segmentsOf(text: string): string[] {
  return text
    .split(/,|\+|\band\b|;|\//)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Read a payment term.
 *
 * Returns milestones that add up to 100% of the invoice, or `unknown: true`.
 * The raw wording is always preserved, because an Accounts user needs to see
 * what the customer actually agreed to, not only what the system made of it.
 */
export function readTerm(raw: string | null | undefined, rules: TermRule[] = []): TermDefinition {
  const text = (raw ?? "").trim();
  if (!text) return { ...UNKNOWN, raw: "" };

  const rule = rules.length ? matchRule(text, rules) : null;
  if (rule) return fromRule(text, rule);

  const norm = squash(text);
  const assumptions: string[] = [];
  const advance = /\badvance\b|\bprepaid\b|\bbefore shipment\b/.test(norm);
  const lc = /\bl\/?c\b|letter of credit/.test(norm);

  // ---- split terms: more than one portion, each with its own percentage
  const segments = segmentsOf(norm);
  const pieces: Array<{ percent: number | null; days: number | null; basis: DateBasis | null; explicit: boolean; text: string }> =
    segments.map((seg) => ({
      percent: percentFrom(seg),
      days: daysFrom(seg),
      ...basisFrom(seg),
      text: seg,
    }));

  // a portion is real if it names a percentage below 100, or names a basis/days
  const partial = pieces.filter((p) => p.percent !== null && p.percent > 0 && p.percent < 100);

  if (partial.length >= 1 && pieces.length > 1) {
    const named = round2(partial.reduce((s, p) => s + (p.percent ?? 0), 0));
    const remainder = round2(100 - named);

    // "balance 30%" names its own percentage; "balance at 90 days" does not, and
    // takes whatever is left
    const rest = pieces.filter((p) => !partial.includes(p) && (p.days !== null || p.basis !== null));
    const milestones: Milestone[] = [];
    let seq = 1;

    for (const p of partial) {
      const basis = p.basis ?? inferBasis(p, advance, assumptions, p.percent ?? 0);
      const days = p.days ?? 0;
      milestones.push({
        seq: seq++,
        percent: p.percent ?? 0,
        days,
        basis,
        label: labelOf(p.percent ?? 0, days, basis),
      });
    }

    if (remainder > 0.01 && rest.length) {
      const p = rest[0];
      const days = p.days ?? 0;
      let basis = p.basis;
      if (!basis) {
        // "Balance 30% at 90 Days" — ninety days from *what* is not stated.
        // Export practice counts credit from the BL date, so that is used, and
        // the assumption is recorded rather than hidden.
        basis = "BL_DATE";
        assumptions.push(
          `The wording "${p.text}" gives ${days} days but not what they run from. Counted from the ` +
            "BL date, which is the usual basis for export credit — confirm with the customer.",
        );
      }
      milestones.push({
        seq: seq++,
        percent: remainder,
        days,
        basis,
        label: labelOf(remainder, days, basis),
      });
    } else if (remainder > 0.01) {
      milestones.push({
        seq: seq++,
        percent: remainder,
        days: 0,
        basis: milestones[0].basis,
        label: labelOf(remainder, 0, milestones[0].basis),
      });
      assumptions.push(
        `${remainder}% of the invoice is not described by the wording, so it is treated the same ` +
          "way as the first portion. Confirm with the customer.",
      );
    }

    if (milestones.length > 1) {
      return {
        key: keyOf(milestones, lc),
        raw: text,
        description: milestones.map((m) => m.label).join(", then "),
        milestones,
        unknown: false,
        assumptions,
      };
    }
  }

  // ---- single portion
  const whole = pieces.find((p) => p.basis !== null || p.days !== null) ?? pieces[0];
  const days = whole?.days ?? daysFrom(norm) ?? 0;
  const found = basisFrom(norm);
  let basis = whole?.basis ?? found.basis;

  if (!basis) {
    if (advance) {
      basis = "INVOICE_DATE";
      assumptions.push(
        "An advance payment falls due before shipment; it is measured from the invoice date so " +
          "that it can be tracked at all.",
      );
    } else if (days > 0) {
      basis = "BL_DATE";
      assumptions.push(
        `"${text}" gives ${days} days but not what they run from. Counted from the BL date, which ` +
          "is the usual basis for export credit — confirm with the customer.",
      );
    } else {
      return {
        ...UNKNOWN,
        raw: text,
        description: `"${text}" was not recognised as a payment term, so no due date is calculated.`,
      };
    }
  }

  const milestone: Milestone = { seq: 1, percent: 100, days, basis, label: labelOf(100, days, basis) };
  return {
    key: keyOf([milestone], lc),
    raw: text,
    description: milestone.label,
    milestones: [milestone],
    unknown: false,
    assumptions,
  };
}

function inferBasis(
  p: { days: number | null; text: string },
  advance: boolean,
  assumptions: string[],
  percent: number,
): DateBasis {
  if (advance) return "INVOICE_DATE";
  assumptions.push(
    `The ${percent}% portion ("${p.text}") does not say what its ${p.days ?? 0} days run from. ` +
      "Counted from the BL date — confirm with the customer.",
  );
  return "BL_DATE";
}

function labelOf(percent: number, days: number, basis: DateBasis): string {
  const share = percent >= 99.99 ? "100%" : `${percent}%`;
  if (days === 0) {
    return basis === "DOCS_PRESENTED"
      ? `${share} on presentation of documents`
      : `${share} on the ${BASIS_LABELS[basis]}`;
  }
  return `${share} ${days} days from the ${BASIS_LABELS[basis]}`;
}

function keyOf(milestones: Milestone[], lc: boolean): string {
  const parts = milestones.map((m) => {
    const b =
      m.basis === "BL_DATE" ? "BL" :
      m.basis === "INVOICE_DATE" ? "INV" :
      m.basis === "ETA" ? "ETA" :
      m.basis === "DOCS_PRESENTED" ? "CAD" : "SB";
    return `${Math.round(m.percent)}_${m.days}${b}`;
  });
  return `${lc ? "LC_" : ""}${parts.join("__")}`;
}

// ---------------------------------------------------------------------------
// Resolving a term against one invoice
// ---------------------------------------------------------------------------

export type MilestoneState = "PAID" | "OVERDUE" | "DUE_SOON" | "NOT_DUE" | "NO_DATE";

export interface ResolvedMilestone extends Milestone {
  /** The portion's share of the invoice value. Null without a value. */
  amount: number | null;
  basisDate: string | null;
  dueDate: string | null;
  /** Why there is no due date — or, where the default stands in for one, why
   *  it does. Null when the terms give the date. */
  pending: string | null;
  /** The due date is the default (invoice date + the default credit period),
   *  because the date the portion counts from is not recorded. */
  assumed: boolean;
  settled: number;
  outstanding: number;
  overdueDays: number | null;
  state: MilestoneState;
}

export interface Schedule {
  term: TermDefinition;
  milestones: ResolvedMilestone[];
  /** The invoice's single due date: the next portion that still owes money. */
  dueDate: string | null;
  /** "default": nothing recorded gives a due date, so the invoice falls due
   *  the default credit period after its invoice date. */
  dueDateSource: "entered" | "calculated" | "default" | "none";
  /** One line explaining the due date, for the column's tooltip. */
  dueDateNote: string;
  /** Days past `dueDate`. Negative before it, null without one. */
  overdueDays: number | null;
  /** The part of the outstanding balance whose own due date has passed. */
  overdueAmount: number;
  /** Portions whose basis date is missing, or wording nobody could read. */
  requiresVerification: boolean;
  verificationReasons: string[];
}

/**
 * Work out when an invoice falls due, and how much of it already has.
 *
 * `settled` is what the customer no longer owes — receipts plus credit notes
 * less debit notes — so the milestones can never disagree with the balance on
 * the same row. It is applied to the earliest portion first, which is the
 * universal convention and the only one that makes "what is overdue"
 * answerable.
 *
 * An entered due date wins over a calculated one. That is not a shortcut: the
 * reference sheets carry dates whose basis is not recorded anywhere, and the
 * honest thing is to keep the figure the business is working to while saying it
 * could not be checked.
 */
export function buildSchedule(args: {
  paymentTerms: string | null | undefined;
  invoiceValue: number | null;
  basisDates: BasisDates;
  settled?: number;
  /** A due date typed in or taken from a sheet. Overrides the calculation. */
  enteredDueDate?: string | null;
  dueSoonDays?: number;
  today?: string;
  /** Rules defined in Settings & Rules, checked before the built-in readings. */
  rules?: TermRule[];
  /**
   * The default credit period, in days from the invoice date (Settings &
   * Rules; owner, 24 Oct 2026: "Any invoice over 150 days from the invoice
   * date must be marked as overdue"). It stands in wherever nothing recorded
   * gives a due date — no terms, wording nobody could read, or the date a
   * portion counts from (usually the BL date) not recorded — so such an
   * invoice falls due, and is overdue once that many days have passed, rather
   * than waiting for verification forever. 0 or absent: no default.
   */
  defaultDueDays?: number;
}): Schedule {
  const today = args.today ?? todayIso();
  const dueSoon = args.dueSoonDays ?? 7;
  const term = readTerm(args.paymentTerms, args.rules ?? []);
  const reasons: string[] = [];
  const invoiceDate = args.basisDates.INVOICE_DATE ?? null;
  const defaultDays = args.defaultDueDays && args.defaultDueDays > 0 ? args.defaultDueDays : 0;
  const fallback = defaultDays && invoiceDate ? addDays(invoiceDate, defaultDays) : null;

  const amounts =
    args.invoiceValue === null
      ? term.milestones.map(() => null)
      : splitByPercent(args.invoiceValue, term.milestones.map((m) => m.percent));

  const planned = term.milestones.map((m, i) => {
    const basisDate = args.basisDates[m.basis] ?? null;
    const assumed = !basisDate && fallback !== null;
    const dueDate = basisDate ? addDays(basisDate, m.days) : fallback;
    const pending = basisDate
      ? null
      : assumed
        ? `${m.label} — the ${BASIS_LABELS[m.basis]} is not recorded, so this portion is taken as due ${defaultDays} days after the invoice date (the default).`
        : `${m.label} — the ${BASIS_LABELS[m.basis]} is not recorded, so this portion has no due date.`;
    if (pending) reasons.push(pending);
    return { ...m, amount: amounts[i], basisDate, dueDate, pending, assumed };
  });

  // ---- apply money to the earliest portion first
  let left = Math.max(0, round2(args.settled ?? 0));
  const milestones: ResolvedMilestone[] = planned.map((m) => {
    const amount = m.amount;
    const applied = amount === null ? 0 : Math.min(left, amount);
    left = round2(left - applied);
    const outstanding = amount === null ? 0 : round2(amount - applied);
    const overdueDays = m.dueDate ? daysBetween(m.dueDate, today) : null;

    const state: MilestoneState =
      amount !== null && outstanding <= 0.01
        ? "PAID"
        : m.dueDate === null
          ? "NO_DATE"
          : (overdueDays ?? 0) > 0
            ? "OVERDUE"
            : Math.abs(overdueDays ?? 0) <= dueSoon
              ? "DUE_SOON"
              : "NOT_DUE";

    return { ...m, settled: round2(applied), outstanding, overdueDays, state };
  });

  const overdueAmount = round2(
    milestones.filter((m) => m.state === "OVERDUE").reduce((s, m) => s + m.outstanding, 0),
  );

  // ---- the invoice's single due date
  const entered = args.enteredDueDate ?? null;
  const nextOwing = milestones.find((m) => m.outstanding > 0.01 && m.dueDate !== null);
  const anchor = nextOwing ?? [...milestones].reverse().find((m) => m.dueDate !== null) ?? null;

  let dueDate: string | null;
  let dueDateSource: Schedule["dueDateSource"];
  let dueDateNote: string;

  if (entered) {
    dueDate = entered;
    dueDateSource = "entered";
    dueDateNote =
      "Entered rather than calculated. Whatever date the term implies, this is the date the " +
      "business is working to — and it cannot be checked, because the basis it came from is not recorded.";
  } else if (anchor?.dueDate && anchor.assumed) {
    dueDate = anchor.dueDate;
    dueDateSource = "default";
    dueDateNote =
      `The ${BASIS_LABELS[anchor.basis]} is not recorded, so the default applies: invoice date ${invoiceDate} + ${defaultDays} days.` +
      (milestones.length > 1 ? ` This portion is ${anchor.percent}% of the invoice.` : "");
  } else if (anchor?.dueDate) {
    dueDate = anchor.dueDate;
    dueDateSource = "calculated";
    dueDateNote =
      `${BASIS_LABELS[anchor.basis]} ${anchor.basisDate} + ${anchor.days} days` +
      (milestones.length > 1
        ? ` — ${anchor.outstanding > 0.01 ? "the next portion still owing" : "the last portion"} is ${anchor.percent}% of the invoice.`
        : ".");
  } else if (fallback && !milestones.length) {
    // no portion to date at all: no terms, or wording nobody could read
    dueDate = fallback;
    dueDateSource = "default";
    dueDateNote =
      (term.unknown && args.paymentTerms ? `The payment term "${args.paymentTerms}" was not recognised` : "No payment terms are recorded") +
      `, so the default applies: invoice date ${invoiceDate} + ${defaultDays} days.`;
  } else {
    dueDate = null;
    dueDateSource = "none";
    dueDateNote = term.unknown
      ? term.description
      : reasons[0] ?? "No due date could be worked out from what is recorded.";
  }

  if (term.unknown && args.paymentTerms) {
    reasons.unshift(`The payment term "${args.paymentTerms}" was not recognised.`);
  }

  return {
    term,
    milestones,
    dueDate,
    dueDateSource,
    dueDateNote,
    overdueDays: dueDate ? daysBetween(dueDate, today) : null,
    overdueAmount: entered || (dueDateSource === "default" && !milestones.length)
      ? // with an entered date (or the default, with no portions) there are no portions to speak of; the whole
        // outstanding balance is late once that date has passed. Worked out from
        // the value and what is settled rather than from the portions, because
        // an entered date needs no recognised term — and with no term there are
        // no portions, which used to make a long-overdue invoice report nothing
        // overdue at all.
        dueDate && dueDate < today && args.invoiceValue !== null
          ? Math.max(0, round2(args.invoiceValue - Math.max(0, args.settled ?? 0)))
          : 0
      : overdueAmount,
    requiresVerification: dueDate === null && (term.unknown || reasons.length > 0),
    verificationReasons: [...new Set(reasons)],
  };
}

/**
 * Split a value by percentage so the pieces sum to it exactly.
 *
 * Every piece is rounded to two decimals and the last absorbs the remainder,
 * which is the only way `Σ portions === invoice value` can be guaranteed. An
 * invoice that does not add up to itself is worse than a one-paisa difference
 * on the final portion.
 */
export function splitByPercent(value: number, percents: number[]): number[] {
  if (!percents.length) return [];
  const out: number[] = [];
  let used = 0;
  for (let i = 0; i < percents.length - 1; i += 1) {
    const piece = round2((value * percents[i]) / 100);
    out.push(piece);
    used = round2(used + piece);
  }
  out.push(round2(value - used));
  return out;
}
