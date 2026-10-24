/**
 * The pending-only view of the dashboard and the Master Table (owner, 24 Oct
 * 2026: "Only pending invoices should show as default. On dashboard and in
 * the masters too with a separate table at the bottom (collapsed as default)
 * showing all the invoices (cleared as well as due)").
 *
 *   PendingSwitch  says which view is in force, and switches: pending only
 *                  (the default) or every invoice, cleared ones included.
 *   AllInvoices    every invoice the filters let through, cleared and pending,
 *                  folded under a heading at the foot of the page. A plain
 *                  <details>: nothing to hydrate, open in one click. Its sort
 *                  links carry `all=1`, which opens it again after the page
 *                  reloads in the new order.
 */
import Link from "next/link";

import type { InvoiceGroup } from "@/server/payments/query";
import { MasterTable } from "./MasterTable";

export function PendingSwitch({
  showAll,
  pending,
  total,
  pendingHref,
  allHref,
}: {
  showAll: boolean;
  /** How many invoices are pending, and how many there are in all. */
  pending: number;
  total: number;
  pendingHref: string;
  allHref: string;
}) {
  const tab = (on: boolean) =>
    `rounded-md px-3 py-1.5 text-[12px] font-semibold transition ${
      on ? "bg-[var(--color-brand)] text-white shadow-sm" : "text-[var(--color-ink-2)] hover:bg-white"
    }`;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg border border-[var(--color-line)] bg-[#f3f6f9] p-1" role="group" aria-label="Which invoices to show">
        <Link href={pendingHref} className={tab(!showAll)} aria-current={!showAll ? "page" : undefined}>
          Pending invoices · {pending}
        </Link>
        <Link href={allHref} className={tab(showAll)} aria-current={showAll ? "page" : undefined}>
          All invoices · {total}
        </Link>
      </div>
      <span className="text-[11px] text-[var(--color-ink-3)]">
        {showAll
          ? "Every invoice, cleared ones included."
          : `Only invoices with money still owed. ${total - pending} cleared invoice(s) are in the table at the foot of the page.`}
      </span>
    </div>
  );
}

export function AllInvoices({
  groups,
  count,
  query,
  sort,
  dir,
  basePath,
  open = false,
}: {
  groups: InvoiceGroup[];
  count: number;
  /** The page's query, with `all=1` so a sort reopens the table. */
  query: string;
  sort?: string;
  dir?: string;
  basePath: string;
  open?: boolean;
}) {
  if (!count) return null;
  return (
    <details id="all-invoices" open={open} className="group mt-8 scroll-mt-4 rounded-2xl border border-[var(--color-line)] bg-white">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl px-5 py-4 hover:bg-[#f6f8fb]">
        <span className="text-[var(--color-ink-3)] transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        <span className="text-[15px] font-semibold text-[var(--color-ink)]">All invoices — cleared and pending</span>
        <span className="text-[12px] text-[var(--color-ink-3)]">{count} invoice(s), grouped by customer</span>
        <span className="ml-auto text-[12px] font-semibold text-[var(--color-accent)] group-open:hidden">Show</span>
        <span className="ml-auto hidden text-[12px] font-semibold text-[var(--color-accent)] group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-[var(--color-line)] p-4">
        <MasterTable groups={groups} query={query} sort={sort} dir={dir} showHeadings basePath={basePath} />
      </div>
    </details>
  );
}
