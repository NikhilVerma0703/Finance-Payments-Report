/**
 * Search Invoices.
 *
 * Every filter the master table ever had, on a page of its own: any one alone
 * or any combination, with every record shown when none is applied. The
 * results use the same detailed table, and an invoice opens to its full record
 * where every field can be edited.
 */
import { cookies } from "next/headers";
import Link from "next/link";

import { Filters } from "@/components/tracking/Filters";
import { BulkBar } from "@/components/tracking/BulkBar";
import { columnsFrom, COLUMNS_COOKIE, MasterTable, withColumns } from "@/components/tracking/MasterTable";
import { money } from "@/components/tracking/bits";
import { Done, Empty, PageHead } from "@/components/ui";
import { ROUTES } from "@/lib/routes";
import {
  activeFilters,
  filterInvoices,
  filtersFrom,
  groupInvoices,
  isGrouping,
  kpisFrom,
  loadTracking,
  toQuery,
} from "@/server/payments/query";
import { markCompletedAction } from "@/server/payments/managementActions";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = filtersFrom(sp);
  const { invoices, params, options, counts } = await loadTracking();
  // columns chosen one by one: the URL's, else the ones remembered in this browser
  const chosen = columnsFrom(sp.col, (await cookies()).get(COLUMNS_COOKIE)?.value);

  const visible = filterInvoices(invoices, filters);
  const grouping = isGrouping(filters.group) ? filters.group : "none";
  const groups = groupInvoices(visible, grouping);
  const totals = kpisFrom(visible, params);
  const query = toQuery(filters);
  const narrowed = activeFilters(filters).length > 0;

  return (
    <>
      <PageHead
        title="Search Invoices"
        lead="Find invoices by number, customer, status, ageing, PO, payment terms or a date range."
        actions={
          <>
            {narrowed && (
              <Link href={`${ROUTES.dashboard}?${query}`} className="btn-ghost">
                Show on dashboard
              </Link>
            )}
            <Link href={`${ROUTES.exportView}?${query}`} className="btn">
              Export results
            </Link>
          </>
        }
      />

      <Done message={sp.done} />

      <Filters
        filters={filters}
        options={{ ...options, countries: [...new Set(invoices.map((i) => i.country?.trim() ?? "").filter(Boolean))].sort() }}
        buckets={params.ageingBuckets}
        action={ROUTES.search}
        matched={visible.length}
        total={counts.total}
      />

      {totals.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3">
          {totals.map((t) => (
            <div
              key={t.currency}
              className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg border border-[var(--color-line)] bg-white px-4 py-2.5 text-[12px]"
            >
              <span className="font-semibold">{t.currency}</span>
              <span>
                {t.invoices} invoice(s)
              </span>
              <span>
                invoiced <strong className="tabular-nums">{money(t.totalInvoiceValue, t.currency)}</strong>
              </span>
              <span>
                received <strong className="tabular-nums">{money(t.totalReceived, t.currency)}</strong>
              </span>
              <span>
                outstanding{" "}
                <strong className="tabular-nums text-[var(--color-brand)]">
                  {money(t.totalOutstanding, t.currency)}
                </strong>
              </span>
              {t.overdueOutstanding > 0.01 && (
                <span className="text-[var(--color-bad-fg)]">
                  overdue <strong className="tabular-nums">{money(t.overdueOutstanding, t.currency)}</strong>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <section className="card">
          <Empty>
            No invoices match these filters.{" "}
            <Link href={ROUTES.search} className="link">
              Reset
            </Link>
          </Empty>
        </section>
      ) : (
        <>
          {/* tick invoices for a bulk action (owner, 25 Oct 2026) */}
          <BulkBar
            formId="pt-bulk"
            action={markCompletedAction}
            actionLabel="Mark as completed"
            hint="Fully settled invoices move to Completed invoices; any other ticked one is left as it is"
            exportHref={ROUTES.exportView}
            returnTo={`${ROUTES.search}?${withColumns(query, chosen)}`}
          />
          <MasterTable
            groups={groups}
            query={withColumns(query, chosen)}
            sort={filters.sort}
            dir={filters.dir}
            showHeadings={grouping !== "none"}
            basePath={ROUTES.search}
            chosen={chosen}
            select="pt-bulk"
            chooser
          />
        </>
      )}
    </>
  );
}
