/**
 * Dashboard & Master Table.
 *
 * KPIs, the ageing summary, every invoice grouped by customer in the full
 * table, and the customer-wise summary at the bottom. Shows every record; a
 * link from the ageing cards or from Search Invoices can carry filters here,
 * and then every figure on the page — tiles, ageing, tables and the summary —
 * is worked out from the filtered records alone.
 */
import Link from "next/link";

import { CustomerSummary } from "@/components/tracking/CustomerSummary";
import { Dashboard } from "@/components/tracking/Dashboard";
import { MasterTable } from "@/components/tracking/MasterTable";
import { Banner, Empty, PageHead } from "@/components/ui";
import { ROUTES } from "@/lib/routes";
import {
  activeFilters,
  describeFilters,
  filterInvoices,
  filtersFrom,
  groupInvoices,
  isGrouping,
  kpisFrom,
  loadTracking,
  summarise,
  toQuery,
} from "@/server/payments/query";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = filtersFrom(await searchParams);
  const { invoices, params, today, counts } = await loadTracking();

  const visible = filterInvoices(invoices, filters);
  const grouping = isGrouping(filters.group) ? filters.group : "customer";
  const groups = groupInvoices(visible, grouping);
  const kpis = kpisFrom(visible, params);
  const customers = summarise(visible);
  const withoutDueDate = visible.filter((i) => i.schedule.dueDate === null).length;

  const query = toQuery(filters);
  const narrowed = activeFilters(filters);

  return (
    <>
      <PageHead
        title="Dashboard & Master Table"
        lead="Customer-wise and invoice-wise payment position."
        actions={
          <>
            <Link href={ROUTES.search} className="btn-ghost">
              Search invoices
            </Link>
            <Link href={`${ROUTES.exportView}?${query}`} className="btn">
              Export this view
            </Link>
          </>
        }
      />

      {counts.total === 0 ? (
        <Banner tone="info">
          No records yet.{" "}
          <Link href={ROUTES.upload} className="link">
            Upload a customer payment sheet
          </Link>{" "}
          or{" "}
          <Link href={ROUTES.newRecord} className="link">
            enter a record by hand
          </Link>
          .
        </Banner>
      ) : (
        <>
          {narrowed.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#c6dcf3] bg-[var(--color-info-bg)] px-3 py-2 text-[12px]">
              <span className="font-semibold text-[var(--color-info-fg)]">
                Showing {visible.length} of {counts.total} invoice(s) — filtered
              </span>
              <span className="text-[var(--color-ink-2)]">
                {describeFilters(filters).join(" · ")}
              </span>
              <span className="ml-auto flex gap-2">
                <Link href={`${ROUTES.search}?${query}`} className="btn-ghost btn-sm">
                  Change filters
                </Link>
                <Link href={ROUTES.dashboard} className="btn-ghost btn-sm">
                  Show all
                </Link>
              </span>
            </div>
          )}

          <Dashboard kpis={kpis} today={today} filters={filters} />

          {withoutDueDate > 0 && (
            <Banner tone="warn">
              <strong>{withoutDueDate}</strong> of {visible.length} invoice(s) have no due date and are
              shown as <em>Requires verification</em>. Add the payment terms and the BL date to date
              them.
            </Banner>
          )}

          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-semibold">Master table</h2>
            <p className="text-[11px] text-[var(--color-ink-3)]">
              {visible.length} invoice(s) · {counts.customers} customer(s) · {counts.receipts}{" "}
              receipt(s) · {counts.fromExcel} imported, {counts.manual} entered
            </p>
          </div>

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
              basePath={ROUTES.dashboard}
            />
          )}

          <CustomerSummary customers={customers} />
        </>
      )}
    </>
  );
}
