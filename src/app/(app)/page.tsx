/**
 * Dashboard & Master Table.
 *
 * The receivables overview: what needs attention, the KPI cards, the
 * customer-wise summary right below them, what falls due week by week with the
 * ageing and the biggest balances, and every invoice grouped by customer in
 * the full table. Shows every record; a link from the ageing cards or from
 * Search Invoices can carry filters here, and then every figure on the page —
 * tiles, ageing, tables and the summary — is worked out from the filtered
 * records alone.
 */
import Link from "next/link";

import { CustomerSummary } from "@/components/tracking/CustomerSummary";
import { AgeingSummary, Dashboard } from "@/components/tracking/Dashboard";
import { MasterTable } from "@/components/tracking/MasterTable";
import { AttentionStrip, asAtTime, OverviewHead, type AttentionItem } from "@/components/tracking/Overview";
import { Banner, Empty } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { ageingLabels } from "@/lib/payments/money";
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
  onAccountFor,
  summarise,
  toQuery,
  type TrackingFilters,
} from "@/server/payments/query";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = filtersFrom(await searchParams);
  const { invoices, onAccount: allOnAccount, params, today, counts, options } = await loadTracking();

  const visible = filterInvoices(invoices, filters);
  const onAccount = onAccountFor(allOnAccount, filters, visible);
  const grouping = isGrouping(filters.group) ? filters.group : "customer";
  const groups = groupInvoices(visible, grouping);
  const kpis = kpisFrom(visible, params, onAccount);
  const customers = summarise(visible, onAccount);
  const withoutDueDate = visible.filter((i) => i.schedule.dueDate === null).length;

  const query = toQuery(filters);
  const narrowed = activeFilters(filters);
  const time = asAtTime();
  const month = today.slice(0, 7);

  return (
    <>
      <OverviewHead
        today={today}
        time={time}
        invoices={visible.length}
        customers={new Set(visible.map((i) => i.customerId ?? "~none")).size}
        receiptsThisMonth={visible.reduce(
          (n, i) => n + i.receipts.filter((r) => (r.receiptDate ?? "").startsWith(month)).length,
          0,
        )}
        currencies={options.currencies}
        filters={filters}
        actions={
          <>
            <Link href={ROUTES.search} className="btn-ghost btn-sm">
              Search invoices
            </Link>
            <Link href={`${ROUTES.exportView}?${query}`} className="btn btn-sm">
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

          <AttentionStrip
            time={time}
            items={attentionItems({
              filters,
              lastBucket: ageingLabels(params.ageingBuckets).at(-1) ?? "",
              visible,
              customers,
              dueSoonDays: params.dueSoonDays,
            })}
          />

          <Dashboard kpis={kpis} today={today} invoices={visible} onAccount={onAccount} filters={filters} />

          <CustomerSummary
            customers={customers}
            returnTo={`${ROUTES.dashboard}${query ? `?${query}` : ""}#customers`}
          />

          <AgeingSummary kpis={kpis} filters={filters} invoices={visible} customers={customers} today={today} />

          {withoutDueDate > 0 && (
            <Banner tone="warn">
              <strong>{withoutDueDate}</strong> of {visible.length} invoice(s) have no due date and are
              shown as <em>Requires verification</em>. Add the payment terms and the BL date to date
              them.
            </Banner>
          )}

          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
              Master table
            </h2>
            <p className="text-[11px] text-[var(--color-ink-3)]">
              {visible.length} invoice(s) · {counts.customers} customer(s) · {counts.receipts}{" "}
              receipt(s) · {counts.fromExcel} imported, {counts.manual} entered · click a customer&rsquo;s
              name to adjust its payments
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
        </>
      )}
    </>
  );
}

/**
 * The "needs attention" strip: each thing worth acting on today, most pressing
 * first, as a count and a link to exactly those records. Amounts are stated
 * only where one currency is in view — a sum across currencies is not a sum.
 */
function attentionItems(args: {
  filters: TrackingFilters;
  lastBucket: string;
  visible: Awaited<ReturnType<typeof loadTracking>>["invoices"];
  customers: ReturnType<typeof summarise>;
  dueSoonDays: number;
}): AttentionItem[] {
  const { filters, lastBucket, visible, customers, dueSoonDays } = args;
  const drill = (extra: Record<string, string>) =>
    `${ROUTES.search}?${toQuery({ ...filters, sort: undefined, dir: undefined }, extra)}`;
  const currencies = new Set(visible.map((i) => i.currency ?? "—"));
  const one = currencies.size === 1 ? [...currencies][0] : null;
  const amount = (n: number) => (one && one !== "—" ? formatMoney(n, one) : null);
  const owing = (i: (typeof visible)[number]) => i.money.calculatedOutstanding ?? 0;

  const items: AttentionItem[] = [];
  const push = (
    item: Omit<AttentionItem, "sub"> & { total?: number; sub?: string },
  ) => {
    if (item.count <= 0) return;
    const money = item.total !== undefined ? amount(item.total) : null;
    items.push({ ...item, sub: [money, item.sub].filter(Boolean).join(" · ") || undefined });
  };

  const oldest = visible.filter((i) => i.ageing === lastBucket);
  push({
    key: "oldest",
    tone: "bad",
    urgent: true,
    count: oldest.length,
    text: `invoice(s) overdue ${lastBucket.toLowerCase()}`,
    total: oldest.reduce((s, i) => s + owing(i), 0),
    href: drill({ ageing: lastBucket }),
  });

  const overdue = visible.filter((i) => i.status === "OVERDUE");
  push({
    key: "overdue",
    tone: "bad",
    count: overdue.length,
    text: "invoice(s) overdue",
    total: overdue.reduce((s, i) => s + i.schedule.overdueAmount, 0),
    sub: "past due",
    href: drill({ status: "OVERDUE" }),
  });

  const soon = visible.filter((i) => i.status === "DUE_SOON");
  push({
    key: "soon",
    tone: "warn",
    count: soon.length,
    text: `invoice(s) falling due within ${dueSoonDays} days`,
    total: soon.reduce((s, i) => s + owing(i), 0),
    href: drill({ status: "DUE_SOON" }),
  });

  const verify = visible.filter((i) => i.status === "REQUIRES_VERIFICATION");
  push({
    key: "verify",
    tone: "warn",
    count: verify.length,
    text: "invoice(s) with no due date",
    total: verify.reduce((s, i) => s + owing(i), 0),
    sub: "add the terms and the BL date",
    href: drill({ verify: "1" }),
  });

  const nil = visible.filter((i) => owing(i) > 0.01 && i.money.totalReceived <= 0.01);
  push({
    key: "nil",
    tone: "warn",
    count: nil.length,
    text: "open invoice(s) with nothing received",
    total: nil.reduce((s, i) => s + owing(i), 0),
    href: drill({ nilReceived: "1", open: "1" }),
  });

  const held = customers.filter((c) => c.id && Math.abs(c.onAccount) > 0.004);
  push({
    key: "on-account",
    tone: "info",
    count: held.length,
    text: "customer(s) with money on account to attribute",
    sub: held
      .slice(0, 3)
      .map((c) => `${c.name} ${formatMoney(c.onAccount, c.currency === "—" ? null : c.currency)}`)
      .join(" · "),
    href: held.length === 1 ? `${ROUTES.customer(held[0].id!)}#on-account` : `${ROUTES.dashboard}#customers`,
  });

  const noCurrency = new Set(visible.filter((i) => i.customerId && !i.currency).map((i) => i.customerId));
  push({
    key: "currency",
    tone: "warn",
    count: noCurrency.size,
    text: "customer(s) with no currency",
    sub: "set it in the Customer-wise summary, or load the ERP client list in Settings",
    href: `${ROUTES.dashboard}#customers`,
  });

  return items;
}
