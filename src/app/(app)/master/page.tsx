/**
 * Master Table: every invoice in the full table, grouped by customer — a
 * section of its own, right after the dashboard.
 *
 * It was the dashboard's lower half. A customer's name — the group heading and
 * every row — opens that customer at "Adjust payment of this customer", and
 * each customer's "Edit / Add extra information" opens its invoices with what
 * each is missing. The filters, sort and grouping are the URL, as on the
 * dashboard and Search Invoices, and the export carries them.
 */
import Link from "next/link";

import { MasterTable } from "@/components/tracking/MasterTable";
import { Empty } from "@/components/ui";
import { ROUTES } from "@/lib/routes";
import {
  activeFilters,
  describeFilters,
  filterInvoices,
  filtersFrom,
  groupInvoices,
  isGrouping,
  loadTracking,
  toQuery,
} from "@/server/payments/query";

export const dynamic = "force-dynamic";

export default async function MasterTablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = filtersFrom(await searchParams);
  const { invoices, counts } = await loadTracking();

  const visible = filterInvoices(invoices, filters);
  const grouping = isGrouping(filters.group) ? filters.group : "customer";
  const groups = groupInvoices(visible, grouping);
  const query = toQuery(filters);
  const narrowed = activeFilters(filters);
  const customers = new Set(visible.map((i) => i.customerId ?? "~none")).size;

  return (
    <>
      {/* set apart so nobody misses where the table begins */}
      <div className="mb-6 text-center">
        <div className="flex items-center gap-4">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#c9d6e3]" aria-hidden />
          <h1 className="text-[26px] font-bold tracking-tight text-[var(--color-brand)] sm:text-[30px]">
            Master Table
          </h1>
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#c9d6e3]" aria-hidden />
        </div>
        <p className="mt-1.5 text-[12px] text-[var(--color-ink-3)]">
          {visible.length} invoice(s) · {customers} customer(s) · {counts.receipts} receipt(s) ·{" "}
          {counts.fromExcel} imported, {counts.manual} entered · click a customer&rsquo;s name to adjust
          its payments
        </p>
        {counts.total > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Link href={`${ROUTES.search}${query ? `?${query}` : ""}`} className="btn-ghost btn-sm">
              Search invoices
            </Link>
            <Link href={`${ROUTES.exportView}?${query}`} className="btn btn-sm">
              Export this view
            </Link>
          </div>
        )}
      </div>

      {counts.total === 0 ? (
        <section className="card">
          <Empty>
            No records yet.{" "}
            <Link href={ROUTES.upload} className="link">
              Upload a customer payment sheet
            </Link>{" "}
            or{" "}
            <Link href={ROUTES.newRecord} className="link">
              enter a record by hand
            </Link>
            .
          </Empty>
        </section>
      ) : (
        <>
          {narrowed.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#c6dcf3] bg-[var(--color-info-bg)] px-3 py-2 text-[12px]">
              <span className="font-semibold text-[var(--color-info-fg)]">
                Showing {visible.length} of {counts.total} invoice(s) — filtered
              </span>
              <span className="text-[var(--color-ink-2)]">{describeFilters(filters).join(" · ")}</span>
              <span className="ml-auto flex gap-2">
                <Link href={`${ROUTES.search}?${query}`} className="btn-ghost btn-sm">
                  Change filters
                </Link>
                <Link href={ROUTES.masterTable} className="btn-ghost btn-sm">
                  Show all
                </Link>
              </span>
            </div>
          )}

          {groups.length === 0 ? (
            <section className="card">
              <Empty>No invoices match these filters.</Empty>
            </section>
          ) : (
            <MasterTable
              groups={groups}
              query={query}
              sort={filters.sort}
              dir={filters.dir}
              showHeadings={grouping !== "none"}
              basePath={ROUTES.masterTable}
            />
          )}
        </>
      )}
    </>
  );
}
