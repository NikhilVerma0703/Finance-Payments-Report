/**
 * Reports & Downloads Sheets.
 *
 * Choose the records — by customer, invoice number, ageing, PO number or a
 * date range on the invoice, due or overdue date, alone or together — check
 * what was selected, and download it as a formatted Excel report. With no
 * filter, the report covers every record.
 */
import Link from "next/link";

import { CustomerSummary } from "@/components/tracking/CustomerSummary";
import { Filters } from "@/components/tracking/Filters";
import { day, kpiMoney, money, StatusChip } from "@/components/tracking/bits";
import { Empty, PageHead } from "@/components/ui";
import { ROUTES } from "@/lib/routes";
import {
  filterInvoices,
  filtersFrom,
  kpisFrom,
  loadTracking,
  summarise,
  toQuery,
  type TrackingFilters,
} from "@/server/payments/query";

export const dynamic = "force-dynamic";

/** The filters this page offers; anything else in the URL is ignored here. */
const REPORT_KEYS = ["customer", "inv", "ageing", "po", "dateField", "from", "to"] as const;

const PREVIEW_ROWS = 100;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const all = filtersFrom(await searchParams);
  const filters: TrackingFilters = {};
  for (const k of REPORT_KEYS) if (all[k]) filters[k] = all[k];

  const { invoices, params, options, counts } = await loadTracking();
  const rows = filterInvoices(invoices, { ...filters, sort: "invoiceDate", dir: "asc" });
  const kpis = kpisFrom(rows, params);
  const query = toQuery(filters);
  const receipts = rows.reduce((s, i) => s + i.money.receiptCount, 0);
  const notes = rows.reduce((s, i) => s + i.notes.length, 0);

  return (
    <>
      <PageHead
        title="Reports & Downloads Sheets"
        lead="Choose the records, check them here, and download a formatted Excel report."
        actions={
          <>
            <Link href={ROUTES.ageing} className="btn-ghost">
              Ageing analysis &amp; customer payment performance
            </Link>
            <Link href={`${ROUTES.exportReport}?${query}`} className="btn">
              Export Sheet
            </Link>
          </>
        }
      />

      <Filters
        filters={filters}
        options={{ ...options, invoiceNos: [...new Set(invoices.map((i) => i.invoiceNo ?? "").filter(Boolean))].sort() }}
        buckets={params.ageingBuckets}
        action={ROUTES.reports}
        variant="reports"
        matched={rows.length}
        total={counts.total}
      />

      <section className="card mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="card-title">The report will contain</h2>
            <ul className="space-y-1 text-[12px] text-[var(--color-ink-2)]">
              <li>
                <strong>Invoices</strong> — {rows.length} invoice(s), every field: customer, dates, values,
                exchange rates, terms, due and overdue dates, ageing, status, received, CN/DN, balances,
                shipping details, remarks, and each receipt side by side
              </li>
              <li>
                <strong>Receipts</strong> — {receipts} receipt(s), one per row, with rate difference and
                forex gain/loss
              </li>
              <li>
                <strong>CN &amp; DN</strong> — {notes} credit/debit note(s)
              </li>
              <li>
                <strong>Customer Summary</strong> and <strong>Ageing Summary</strong> — totals per
                customer, per currency and per ageing category
              </li>
              <li>
                <strong>About This Report</strong> — the date, the filters and how every figure is
                calculated
              </li>
            </ul>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Link href={`${ROUTES.exportReport}?${query}`} className="btn">
              Export Sheet
            </Link>
            <Link
              href={`${ROUTES.exportReport}?${toQuery(filters, { format: "csv" })}`}
              className="text-[11px] text-[var(--color-ink-3)] hover:underline"
            >
              or the invoice list as CSV
            </Link>
          </div>
        </div>
      </section>

      {kpis.length > 0 && (
        <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {kpis.map((k) => (
            <div key={k.currency} className="kpi">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                {k.currency} · {k.invoices} invoice(s)
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                <span className="text-[var(--color-ink-3)]">Invoiced</span>
                <strong className="text-right tabular-nums">{kpiMoney(k.totalInvoiceValue, k.currency)}</strong>
                <span className="text-[var(--color-ink-3)]">Received</span>
                <strong className="text-right tabular-nums">{kpiMoney(k.totalReceived, k.currency)}</strong>
                <span className="text-[var(--color-ink-3)]">Outstanding</span>
                <strong className="text-right tabular-nums text-[var(--color-brand)]">
                  {kpiMoney(k.totalOutstanding, k.currency)}
                </strong>
                <span className="text-[var(--color-ink-3)]">Overdue</span>
                <strong className="text-right tabular-nums text-[var(--color-bad-fg)]">
                  {kpiMoney(k.overdueOutstanding, k.currency)}
                </strong>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="card">
        <h2 className="card-title">
          Records in this report{rows.length > PREVIEW_ROWS ? ` — first ${PREVIEW_ROWS} of ${rows.length}` : ""}
        </h2>
        {rows.length === 0 ? (
          <Empty>No records match these filters.</Empty>
        ) : (
          <div className="tablewrap">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
                  <th className="px-3 py-2">Invoice No.</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Invoice date</th>
                  <th className="px-3 py-2">PO No.</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-right">Received</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                  <th className="px-3 py-2">Due date</th>
                  <th className="px-3 py-2">Overdue date</th>
                  <th className="px-3 py-2 text-right">Overdue days</th>
                  <th className="px-3 py-2">Ageing</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PREVIEW_ROWS).map((i) => (
                  <tr key={i.id} className="border-t border-[var(--color-line)]">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      <Link href={ROUTES.invoice(i.id)} className="link">
                        {i.invoiceNo ?? "(no number)"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{i.customerName ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{day(i.invoiceDate)}</td>
                    <td className="px-3 py-2">{i.poNo ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(i.customerInvoiceValue, i.currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(i.money.totalReceived, i.currency)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {money(i.money.calculatedOutstanding, i.currency)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{day(i.schedule.dueDate)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{day(i.overdueSince)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {i.overdueSince ? i.overdueDays : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{i.ageing}</td>
                    <td className="px-3 py-2">
                      <StatusChip status={i.status} note={i.statusNote} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CustomerSummary customers={summarise(rows)} />
    </>
  );
}
