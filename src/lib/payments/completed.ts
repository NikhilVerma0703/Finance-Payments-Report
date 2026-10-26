/**
 * Completed invoices (owner, 25 Oct 2026: "mark fully settled invoices as
 * completed and move them out of the active outstanding list without
 * permanently deleting their records … accessible in a separate
 * Completed/Settled Invoices section with their complete history").
 *
 * Being completed is a mark somebody makes on a settled invoice
 * (the pt_completed table) — it changes no figure on the invoice.
 * The loader splits the marked invoices off (splitCompleted), so every active
 * screen — the dashboard, the master table, Search, a customer's page, the
 * exports — works over the rest exactly as before, and the Completed invoices
 * section lists them with their history. A marked invoice leaves the active
 * lists only while it stays settled: if a correction leaves money owed on it
 * again, it is back among them, saying so, until somebody looks.
 *
 * Pure: no database and no React.
 */
import { formatDate } from "../text";
import type { TrackedInvoice } from "./record";

export interface Completion {
  /** When it was marked, ISO. */
  at: string;
  /** Who marked it, as their login reads. */
  by: string | null;
  note: string | null;
}

/** Fully settled: nothing is owed on it, or more than its value came in. */
export function isSettled(i: Pick<TrackedInvoice, "status">): boolean {
  return i.status === "PAID" || i.status === "OVERPAID";
}

/** The active invoices and the completed ones. */
export function splitCompleted(
  invoices: TrackedInvoice[],
  completions: ReadonlyMap<string, Completion>,
): { active: TrackedInvoice[]; completed: TrackedInvoice[] } {
  const active: TrackedInvoice[] = [];
  const completed: TrackedInvoice[] = [];
  for (const i of invoices) {
    const c = completions.get(i.id);
    if (!c) active.push(i);
    else if (isSettled(i)) completed.push({ ...i, completion: c });
    else {
      // marked completed, but owed money again since: back where it can be seen
      const reason = `Marked completed on ${formatDate(c.at.slice(0, 10))}, but money is owed on it again`;
      active.push({ ...i, completion: c, needsAttention: true, attentionReasons: [reason, ...i.attentionReasons] });
    }
  }
  return { active, completed };
}
