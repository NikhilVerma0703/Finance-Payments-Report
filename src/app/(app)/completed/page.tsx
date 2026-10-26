/**
 * Completed Invoices (owner, 25 Oct 2026: "if a customer has 50 invoices and
 * 10 are fully settled, those 10 should no longer appear in the active
 * outstanding list but must remain accessible in a separate Completed/Settled
 * Invoices section with their complete history").
 *
 * Every invoice marked completed (pt_completed), grouped by customer, in the
 * master table — its columns and its chooser — with when it was marked. Each
 * invoice number opens the invoice with its receipts, notes and correction
 * history, all untouched. Ticking invoices and "Restore to active" puts them
 * back in the active lists. A search box and a customer picker narrow the list
 * (?q=, ?customer=).
 */
import { cookies } from "next/headers";
import Link from "next/link";

import { BulkBar } from "@/components/tracking/BulkBar";
import { columnsFrom, COLUMNS_COOKIE, MasterTable, withColumns } from "@/components/tracking/MasterTable";
import { day } from "@/components/tracking/bits";
import { Done, Empty, PageHead } from "@/components/ui";
import { ROUTES } from "@/lib/routes";
import { restoreActiveAction } from "@/server/payments/managementActions";
import { groupInvoices, loadTracking, toQuery } from "@/server/payments/query";

export const dynamic = "force-dynamic";

export default async function CompletedInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  const q = one(sp.q).toLowerCase();
  const customer = one(sp.customer);
  const { completed } = await loadTracking();

  const customers = [...new Set(completed.map((i) => i.customerName ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const shown = completed
    .filter((i) => !customer || i.customerName === customer)
    .filter((i) => !q || [i.invoiceNo, i.customerName, i.poNo, i.blNo, i.remarks].some((v) => (v ?? "").toLowerCase().includes(q)))
    // most recently completed first
    .sort((a, b) => (b.completion?.at ?? "").localeCompare(a.completion?.at ?? ""));
  const groups = groupInvoices(shown, "customer");
  const chosen = columnsFrom(sp.col, (await cookies()).get(COLUMNS_COOKIE)?.value);
  const query = withColumns(toQuery({}, { ...(q ? { q: one(sp.q) } : {}), ...(customer ? { customer } : {}) }), chosen);
  const latest = completed.reduce<string | null>((m, i) => (i.completion && (!m || i.completion.at > m) ? i.completion.at : m), null);

  return (
    <>
      <PageHead
        title="Completed Invoices"
        lead={`Fully settled invoices marked completed and moved out of the active lists. Nothing about them is changed: open one for its receipts, notes and correction history. Tick invoices and use Restore to active to put them back.${
          latest ? ` Last marked ${day(latest.slice(0, 10))}.` : ""
        }`}
        actions={
          <Link href={ROUTES.masterTable} className="btn-ghost">
            Master Table
          </Link>
        }
      />

      <Done message={sp.done} />

      {!completed.length ? (
        <section className="card">
          <Empty>
            No invoice is completed yet. Tick fully settled invoices in the{" "}
            <Link href={ROUTES.masterTable} className="link">
              Master Table
            </Link>{" "}
            or Search Invoices and choose Mark as completed — or mark one from its invoice page.
          </Empty>
        </section>
      ) : (
        <>
          <form method="get" action={ROUTES.completed} className="mb-4 flex flex-wrap items-end gap-3">
            <div className="w-full min-w-[220px] flex-1 sm:max-w-sm">
              <label className="field-label" htmlFor="cp-q">
                Search
              </label>
              <input id="cp-q" name="q" type="search" defaultValue={one(sp.q)} placeholder="Invoice, customer, PO, BL or remarks" className="input" />
            </div>
            <div className="w-full sm:w-60">
              <label className="field-label" htmlFor="cp-customer">
                Customer
              </label>
              <select id="cp-customer" name="customer" defaultValue={customer} className="input">
                <option value="">All</option>
                {customers.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-ghost">
              Apply
            </button>
            {(q || customer) && (
              <Link href={ROUTES.completed} className="link text-[13px]">
                Reset
              </Link>
            )}
            <span className="ml-auto text-[12px] text-[var(--color-ink-3)]">
              {shown.length} of {completed.length} completed invoice(s)
            </span>
          </form>

          {!groups.length ? (
            <section className="card">
              <Empty>No completed invoice matches.</Empty>
            </section>
          ) : (
            <>
              <BulkBar
                formId="pt-restore"
                action={restoreActiveAction}
                actionLabel="Restore to active"
                hint="Put the ticked invoices back in the active lists; their history says so"
                exportHref={ROUTES.exportView}
                returnTo={query ? `${ROUTES.completed}?${query}` : ROUTES.completed}
              />
              <MasterTable groups={groups} query={query} showHeadings basePath={ROUTES.completed} chosen={chosen} select="pt-restore" chooser />
            </>
          )}
        </>
      )}
    </>
  );
}
