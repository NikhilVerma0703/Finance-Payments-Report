/**
 * Dashboard & Master Table.
 *
 * Pending invoices only, by default (owner, 24 Oct 2026: "Only pending
 * invoices should show as default"): every figure, the summary and the ageing
 * are over the invoices still owing, a switch at the top takes in every
 * invoice instead, and every invoice — cleared and pending — is in a folded
 * table at the foot of the page. What came in (the receipts by month and the
 * received timeline) is always over every invoice: a receipt on an invoice
 * since cleared is still money that came in. `?show=all` is the switch.
 *
 * The receivables overview: what needs attention, the KPI cards, the
 * customer-wise summary right below them, and what falls due week by week
 * with the ageing and the biggest balances. The master table is a section of
 * its own now, right after this one (master/page.tsx), and the header links to
 * it with the same filters. Shows every record; a link from the ageing cards or from
 * Search Invoices can carry filters here, and then every figure on the page —
 * tiles, ageing, tables and the summary — is worked out from the filtered
 * records alone.
 */
import Link from "next/link";

import { CustomerSummary, DEFAULT_SUMMARY_SORT, isSummarySort } from "@/components/tracking/CustomerSummary";
import { TipLayer } from "@/components/dash/client/TipLayer";
import { AgeingSummary, Collections, Dashboard } from "@/components/tracking/Dashboard";
import { AttentionStrip, asAtTime, GroupHead, OverviewHead, type AttentionItem } from "@/components/tracking/Overview";
import { DataQualityAlerts, PriorityFollowUps, UpcomingSchedule } from "@/components/tracking/Management";
import { AllInvoices, PendingSwitch } from "@/components/tracking/PendingView";
import { fillCurrenciesAction } from "@/server/payments/currencyActions";
import { Banner } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { dataQuality, isScheduleWindow, priorityFollowUps, upcomingSchedule, type ScheduleWindow } from "@/lib/payments/management";
import { ageingLabels } from "@/lib/payments/money";
import { addDays } from "@/lib/text";
import { ROUTES } from "@/lib/routes";
import {
  activeFilters,
  describeFilters,
  filterInvoices,
  filtersFrom,
  groupInvoices,
  isPending,
  kpisFrom,
  loadTracking,
  onAccountFor,
  showsAll,
  summarise,
  toQuery,
  type TrackingFilters,
} from "@/server/payments/query";
import { lastDataChange } from "@/server/payments/lastChange";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = filtersFrom(sp);
  // the customer-wise summary's own order, kept apart from the filters
  // newest payment first unless another order is picked (owner, 24 Oct 2026)
  const csort = isSummarySort(sp.csort) ? sp.csort : DEFAULT_SUMMARY_SORT;
  const cq = typeof sp.cq === "string" ? sp.cq : "";
  const [{ invoices, onAccount: allOnAccount, params, today, counts, options, followUps, clientCurrencies }, updated] = await Promise.all([
    loadTracking(),
    // when the figures last changed — the status bar says it in place of "Live"
    lastDataChange(),
  ]);
  // the upcoming schedule's window, its own key beside the filters
  const sched: ScheduleWindow = isScheduleWindow(sp.sched) ? (Number(sp.sched) as ScheduleWindow) : 15;
  // what a save on this page did (the follow-up form)
  const done = typeof sp.done === "string" ? sp.done : null;

  const showAll = showsAll(sp.show);
  // every invoice the filters let through, and of those the ones still owing
  const inView = filterInvoices(invoices, filters);
  const pending = inView.filter(isPending);
  const visible = showAll ? inView : pending;
  // money on account belongs to its customer whether or not anything is pending
  const onAccount = onAccountFor(allOnAccount, filters, inView);
  const kpis = kpisFrom(visible, params, onAccount);
  // each customer's latest payment comes from every invoice in view
  const customers = summarise(visible, onAccount, inView);
  const withoutDueDate = visible.filter((i) => i.schedule.dueDate === null).length;
  // invoices from a sheet with no currency of their own (a customer or client-list
  // default may stand in until then): their kept file can say
  const noCurrency = invoices.filter((i) => i.currencySource !== "invoice" && i.sourceFile).length;
  const currencyNote = typeof sp.currencies === "string" ? sp.currencies : null;
  const defaulted = visible.filter((i) => i.schedule.dueDateSource === "default" && isPending(i)).length;

  const query = toQuery(filters);
  // the export takes what is shown
  const exportQuery = toQuery(filters, showAll ? {} : { open: "1" });
  const narrowed = activeFilters(filters);
  const time = asAtTime();
  const keepView: Record<string, string> = showAll ? { show: "all" } : {};
  const searchOn = (extra: Record<string, string>) => `${ROUTES.search}?${toQuery({ ...filters, sort: undefined, dir: undefined }, extra)}`;
  // where a follow-up save comes back to: this view, without the last message
  const hereQuery = toQuery(filters, { ...keepView, ...(sp.sched ? { sched: String(sched) } : {}) });
  const here = `${ROUTES.dashboard}${hereQuery ? `?${hereQuery}` : ""}#follow-ups`;
  const month = today.slice(0, 7);

  return (
    <div className="dash-scope">
      {/* Hover, focus or press-and-hold a figure: what it is (the Production overview's one island). */}
      <TipLayer />
      {/* THE DECK — one white card with the teal edge, as the Pacific ERP's
          Production overview opens (owner, 28 Oct 2026): what the page is as
          at, what needs attention, and the two heroes — total, outstanding and
          overdue, and what is late, by how much and owed by whom. */}
      <div className="dash-deck mb-6 rounded-2xl p-3 text-gray-900 sm:p-5 xl:p-6 print:p-0">
        <div className="flex flex-col gap-5">
      <OverviewHead
        today={today}
        updated={updated}
        invoices={visible.length}
        customers={new Set(visible.map((i) => i.customerId ?? "~none")).size}
        receiptsThisMonth={inView.reduce(
          (n, i) => n + i.receipts.filter((r) => (r.receiptDate ?? "").startsWith(month)).length,
          0,
        )}
        currencies={options.currencies}
        filters={filters}
        actions={
          <>
            <Link href={`${ROUTES.masterTable}${query ? `?${query}` : ""}`} className="btn-ghost btn-sm">
              Master Table
            </Link>
            <Link href={ROUTES.search} className="btn-ghost btn-sm">
              Search invoices
            </Link>
            <Link href={`${ROUTES.exportView}?${exportQuery}`} className="btn btn-sm">
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
          <PendingSwitch
            showAll={showAll}
            pending={pending.length}
            total={inView.length}
            pendingHref={`${ROUTES.dashboard}${query ? `?${query}` : ""}`}
            allHref={`${ROUTES.dashboard}?${toQuery(filters, { show: "all" })}`}
          />

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

          {/* the currency is read from the uploaded sheets (owner, 25 Oct 2026);
              sheets uploaded before the reader looked past the invoice-value
              column are read again from the files kept with them */}
          {(noCurrency > 0 || currencyNote) && (
            <div id="currencies" className="mb-4 scroll-mt-4">
              {currencyNote && (
                <div className="mb-2">
                  <Banner tone="ok">{currencyNote}</Banner>
                </div>
              )}
              {noCurrency > 0 && (
                <Banner tone="warn">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span>
                      <strong>{noCurrency}</strong> invoice(s) from uploaded sheets have no currency of their own. The sheets are kept, and
                      their amounts are formatted in a currency — read it from them; nothing that has a currency already is
                      changed.
                    </span>
                    <form action={fillCurrenciesAction} className="ml-auto">
                      <button type="submit" className="btn btn-sm">
                        Read currencies from the uploaded sheets
                      </button>
                    </form>
                  </div>
                </Banner>
              )}
            </div>
          )}

          <Dashboard kpis={kpis} today={today} invoices={visible} receiptsFrom={inView} onAccount={onAccount} filters={filters} />
        </>
      )}
        </div>
      </div>

      {counts.total > 0 && (
        <>

          <CustomerSummary
            customers={customers}
            today={today}
            sort={{
              value: csort,
              keep: {
                ...(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>),
                ...(showAll ? { show: "all" } : {}),
              },
            }}
            search={cq}
          />

          <section className="mb-6 mt-6">
            <GroupHead>What lies ahead</GroupHead>
            <AgeingSummary
              kpis={kpis}
              filters={filters}
              invoices={visible}
              receiptsFrom={inView}
              onAccount={onAccount}
              customers={customers}
              today={today}
            />
            <div className="mt-2 text-right text-[12px]">
              <Link href={ROUTES.ageing} className="link">
                Full ageing analysis — by customer, by status, customer payment performance →
              </Link>
            </div>
          </section>

          {/* the working lists (owner, 26 Oct 2026): what falls due next, who to
              chase first and what the records are missing — and what came in */}
          <GroupHead dot="#2dd4bf">Plan and chase</GroupHead>
          <div className="mb-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-12 xl:gap-5">
            <div className="min-w-0 xl:col-span-7">
              <UpcomingSchedule
                schedule={upcomingSchedule(visible, today)}
                window={sched}
                windowHref={(d) => `${ROUTES.dashboard}?${toQuery(filters, { ...keepView, sched: String(d) })}#upcoming`}
                dueHref={(d) => searchOn({ dateField: "due", from: today, to: addDays(today, d), open: "1" })}
              />
            </div>
            <div className="min-w-0 xl:col-span-5">
              <Collections kpis={kpis} today={today} receiptsFrom={inView} onAccount={onAccount} filters={filters} />
            </div>
          </div>

          {done && (
            <Banner tone={/saved/i.test(done) ? "ok" : "info"}>{done}</Banner>
          )}
          <div className="mb-6 grid items-start gap-4 xl:grid-cols-2">
            <PriorityFollowUps rows={priorityFollowUps(visible, followUps, inView)} returnTo={here} />
            <DataQualityAlerts alerts={dataQuality(inView, clientCurrencies)} missingHref={(key) => searchOn({ missing: key, open: "1" })} />
          </div>

          {defaulted > 0 && (
            <Banner tone="info">
              <strong>{defaulted}</strong> pending invoice(s) are dated by the default credit period —{" "}
              {params.defaultDueDays} days after the invoice date — because their payment terms, or the date
              the terms count from (usually the BL date), are not recorded. Each is marked{" "}
              <em>default</em> at its due date; add the terms or the BL date to date it properly. The
              period is set in Settings &amp; Rules.
            </Banner>
          )}

          {withoutDueDate > 0 && (
            <Banner tone="warn">
              <strong>{withoutDueDate}</strong> of {visible.length} invoice(s) have no due date and are
              shown as <em>Requires verification</em>. Add the payment terms and the BL date to date
              them.
            </Banner>
          )}

          {/* every invoice, cleared ones too, folded until asked for */}
          <AllInvoices
            groups={groupInvoices(inView, "customer")}
            count={inView.length}
            query={toQuery(filters, { all: "1", ...(showAll ? { show: "all" } : {}) })}
            sort={filters.sort}
            dir={filters.dir}
            basePath={ROUTES.dashboard}
            open={sp.all === "1"}
          />

          <div className="mt-8 text-center">
            <Link href={`${ROUTES.masterTable}${query ? `?${query}` : ""}`} className="btn">
              Open the Master Table — pending invoices, grouped by customer →
            </Link>
          </div>
        </>
      )}
    </div>
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
    sub: "read it from their uploaded sheets, or set it on the customer's page",
    href: `${ROUTES.dashboard}#currencies`,
  });

  return items;
}
