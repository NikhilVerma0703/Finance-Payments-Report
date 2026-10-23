/**
 * A customer's payment status: one word for where a customer stands, for the
 * customer-wise summary and its export.
 *
 * It is a reading of the customer's figures in one currency, not a stored
 * field, and like an invoice's status the order is the rule — the first that
 * applies wins:
 *
 *   1. no invoices, only money on account     → On account only
 *   2. more received than invoiced            → Overpaid, which needs looking at
 *   3. nothing left to collect                → Fully paid
 *   4. any portion past its due date          → Overdue
 *   5. an open invoice with no due date       → Due date unknown — not late,
 *                                               but nobody can say it is not
 *   6. nothing received at all                → Unpaid, not yet due
 *   7. otherwise                              → Partly paid, not yet due
 */

export type Standing =
  | "ON_ACCOUNT_ONLY"
  | "OVERPAID"
  | "PAID"
  | "OVERDUE"
  | "DUE_DATE_UNKNOWN"
  | "UNPAID"
  | "PARTLY_PAID";

export const STANDING_LABELS: Record<Standing, string> = {
  ON_ACCOUNT_ONLY: "On account only",
  OVERPAID: "Overpaid",
  PAID: "Fully paid",
  OVERDUE: "Overdue",
  DUE_DATE_UNKNOWN: "Due date unknown",
  UNPAID: "Unpaid, not yet due",
  PARTLY_PAID: "Partly paid, not yet due",
};

export const STANDING_TONE: Record<Standing, "ok" | "warn" | "bad" | "info" | "mute"> = {
  ON_ACCOUNT_ONLY: "mute",
  OVERPAID: "warn",
  PAID: "ok",
  OVERDUE: "bad",
  DUE_DATE_UNKNOWN: "warn",
  UNPAID: "info",
  PARTLY_PAID: "info",
};

export function customerStanding(f: {
  invoices: number;
  received: number;
  outstanding: number;
  overdue: number;
  /** Invoices still owing money that have no due date. */
  openWithoutDueDate: number;
}): Standing {
  if (f.invoices === 0) return "ON_ACCOUNT_ONLY";
  if (f.outstanding < -0.01) return "OVERPAID";
  if (f.outstanding <= 0.01) return "PAID";
  if (f.overdue > 0.01) return "OVERDUE";
  if (f.openWithoutDueDate > 0) return "DUE_DATE_UNKNOWN";
  if (f.received <= 0.01) return "UNPAID";
  return "PARTLY_PAID";
}
