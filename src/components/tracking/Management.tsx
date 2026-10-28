/**
 * The dashboard's working lists (owner, 26 Oct 2026), under the ageing:
 *   * UpcomingSchedule  — what falls due in the next 7, 15 or 30 days,
 *     portion by portion, each row opening its invoice;
 *   * PriorityFollowUps — the customers with money past due, longest late
 *     first, with where chasing them stands and the next action, saved on the
 *     row (pt_follow_ups);
 *   * DataQualityAlerts — what the records are missing, and where they
 *     disagree with the ERP client list, each record one click away.
 * Amounts are never added across currencies: a window's total is one line per
 * currency, and a customer owing in two currencies shows both.
 * The figures are lib/payments/management.ts.
 */
import Link from "next/link";

import {
  FOLLOW_UP_STATUS,
  FOLLOW_UP_TONE,
  type FollowUpStatus,
  type PriorityRow,
  type QualityAlert,
  type ScheduleWindow,
  type UpcomingSchedule as Schedule,
} from "@/lib/payments/management";
import { ROUTES } from "@/lib/routes";
import { saveFollowUpAction } from "@/server/payments/managementActions";
import { day, money, StatusChip, TONE_CLASS } from "./bits";
import { Eyebrow, TILE } from "./Overview";

const cur = (c: string | null) => (c && c !== "—" ? c : null);
const CARD = TILE;
const TH = "whitespace-nowrap px-2 py-2 text-left text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-ink-3)]";
const TD = "px-2 py-2";

export function UpcomingSchedule({
  schedule,
  window,
  windowHref,
  dueHref,
  limit = 25,
}: {
  schedule: Schedule;
  window: ScheduleWindow;
  /** The page with another window picked. */
  windowHref: (days: ScheduleWindow) => string;
  /** Search Invoices on what falls due in a window. */
  dueHref: (days: ScheduleWindow) => string;
  limit?: number;
}) {
  const rows = schedule.rows.filter((r) => r.inDays <= window);
  const shown = rows.slice(0, limit);
  return (
    <section id="upcoming" className={`${CARD} mb-6 scroll-mt-4`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Upcoming payment schedule</Eyebrow>
        <span className="text-[11px] text-[var(--color-ink-3)]">from today, portion by portion — overdue money is in the follow-ups</span>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-3" role="group" aria-label="How far ahead">
        {schedule.windows.map((w) => (
          <Link
            key={w.days}
            href={windowHref(w.days)}
            aria-current={w.days === window ? "true" : undefined}
            className={`rounded-xl px-3 py-2 transition ${w.days === window ? "bg-brand-50 ring-2 ring-inset ring-brand-500" : "dash-glass hover:bg-gray-50"}`}
          >
            <div className="text-[11px] font-semibold text-[var(--color-ink-2)]">Next {w.days} days</div>
            {w.totals.length === 0 ? (
              <div className="text-[13px] text-[var(--color-ink-3)]">Nothing falls due</div>
            ) : (
              w.totals.map((t) => (
                <div key={t.currency} className="text-[14px] font-semibold tabular-nums">
                  {money(t.amount, cur(t.currency))}
                </div>
              ))
            )}
            <div className="text-[10.5px] text-[var(--color-ink-3)]">{w.invoices} invoice(s)</div>
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-[var(--color-ink-3)]">Nothing falls due in the next {window} days.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="border-b border-[var(--color-line)]">
                <tr>
                  <th className={TH}>Due date</th>
                  <th className={TH}>Customer</th>
                  <th className={TH}>Invoice no.</th>
                  <th className={`${TH} text-right`}>Falls due</th>
                  <th className={`${TH} text-right`}>Outstanding</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.invoiceId}-${r.due}`} className="border-b border-[#f0f3f7] last:border-0">
                    <td className={`${TD} whitespace-nowrap`}>
                      {day(r.due)}
                      <span className="ml-1.5 text-[10.5px] text-[var(--color-ink-3)]">{r.inDays === 0 ? "today" : `in ${r.inDays} d`}</span>
                      {r.assumed && (
                        <span
                          className="ml-1.5 text-[10.5px] text-[var(--color-warn-fg)]"
                          title="Dated by the default credit period: the terms or the date they count from are not recorded"
                        >
                          default
                        </span>
                      )}
                    </td>
                    <td className={`${TD} max-w-[14rem] truncate`}>
                      {r.customerId ? (
                        <Link href={ROUTES.customer(r.customerId)} className="link">
                          {r.customer}
                        </Link>
                      ) : (
                        <span className="text-[var(--color-ink-3)]">No customer recorded</span>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <Link href={ROUTES.invoice(r.invoiceId)} className="link">
                        {r.invoiceNo ?? "(no number)"}
                      </Link>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-right font-semibold tabular-nums`}>{money(r.amount, cur(r.currency))}</td>
                    <td className={`${TD} whitespace-nowrap text-right tabular-nums text-[var(--color-ink-2)]`}>{money(r.outstanding, cur(r.currency))}</td>
                    <td className={TD}>
                      <StatusChip status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-[var(--color-ink-3)]">
            <span>{rows.length > shown.length ? `The first ${shown.length} of ${rows.length} dates.` : `${rows.length} date(s).`}</span>
            <Link href={dueHref(window)} className="link">
              These invoices in Search →
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

export function PriorityFollowUps({ rows, returnTo, limit = 10 }: { rows: PriorityRow[]; returnTo: string; limit?: number }) {
  const shown = rows.slice(0, limit);
  return (
    <section id="follow-ups" className={`${CARD} min-w-0 scroll-mt-4`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Priority follow-ups</Eyebrow>
        <span className="text-[11px] text-[var(--color-ink-3)]">customers with money past due, longest late first</span>
      </div>
      {shown.length === 0 ? (
        <p className="text-[12px] text-[var(--color-ink-3)]">No customer has money past its due date.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {shown.map((r) => (
            <li key={r.customerId} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <Link href={ROUTES.customer(r.customerId)} className="link min-w-0 truncate font-semibold">
                  {r.customer}
                </Link>
                <span className="flex flex-wrap gap-x-2 text-[13px] font-semibold tabular-nums text-[var(--color-bad-fg)]">
                  {r.overdue.map((o) => (
                    <span key={o.currency}>{money(o.amount, cur(o.currency))}</span>
                  ))}
                  <span className="font-normal text-[var(--color-ink-3)]">overdue</span>
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-ink-3)]">
                <span>
                  Oldest:{" "}
                  <Link href={ROUTES.invoice(r.oldest.id)} className="link">
                    {r.oldest.invoiceNo ?? "(no number)"}
                  </Link>{" "}
                  · <strong className="text-[var(--color-ink-2)]">{r.oldest.days} days</strong> overdue
                </span>
                <span>{r.overdueInvoices} overdue invoice(s)</span>
                <span>Last payment: {r.lastPayment ? day(r.lastPayment) : "no dated receipt"}</span>
                <span className={`chip ${TONE_CLASS[FOLLOW_UP_TONE[r.followUp.status]]}`}>{FOLLOW_UP_STATUS[r.followUp.status]}</span>
              </div>
              {(r.followUp.nextAction || r.followUp.nextDate) && (
                <div className="mt-1 text-[11.5px] text-[var(--color-ink-2)]">
                  Next: {r.followUp.nextAction ?? "—"}
                  {r.followUp.nextDate ? ` · by ${day(r.followUp.nextDate)}` : ""}
                  {r.followUp.by ? <span className="text-[var(--color-ink-3)]"> — {r.followUp.by}</span> : null}
                </div>
              )}
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[11.5px] font-semibold text-[var(--color-brand-2)] hover:underline">Update follow-up</summary>
                <form action={saveFollowUpAction} className="mt-2 grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_9.5rem_auto] sm:items-end">
                  <input type="hidden" name="customerId" value={r.customerId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <label className="text-[11px] text-[var(--color-ink-3)]">
                    Status
                    <select name="status" defaultValue={r.followUp.status} className="input mt-0.5 w-full">
                      {(Object.keys(FOLLOW_UP_STATUS) as FollowUpStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {FOLLOW_UP_STATUS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] text-[var(--color-ink-3)]">
                    Next action
                    <input
                      name="nextAction"
                      defaultValue={r.followUp.nextAction ?? ""}
                      maxLength={500}
                      placeholder="e.g. call the buyer about the BL copy"
                      className="input mt-0.5 w-full"
                    />
                  </label>
                  <label className="text-[11px] text-[var(--color-ink-3)]">
                    By
                    <input type="date" name="nextDate" defaultValue={r.followUp.nextDate ?? ""} className="input mt-0.5 w-full" />
                  </label>
                  <button type="submit" className="btn btn-sm">
                    Save
                  </button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown.length && <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">The {shown.length} longest late of {rows.length} customers.</p>}
    </section>
  );
}

const ALERT_DOT: Record<QualityAlert["tone"], string> = {
  bad: "bg-[var(--color-bad-fg)]",
  warn: "bg-[var(--color-warn-fg)]",
  info: "bg-[var(--color-info-fg)]",
};

export function DataQualityAlerts({ alerts, missingHref }: { alerts: QualityAlert[]; missingHref: (key: string) => string }) {
  return (
    <section id="data-quality" className={`${CARD} min-w-0 scroll-mt-4`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Data quality alerts</Eyebrow>
        <span className="text-[11px] text-[var(--color-ink-3)]">open invoices · nothing here is filled in for you</span>
      </div>
      {alerts.length === 0 ? (
        <p className="text-[12px] text-[var(--color-ink-3)]">Nothing missing on the open invoices.</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.key}>
              <details className="group rounded-xl border border-[var(--color-line)]">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[12.5px] hover:bg-[var(--color-shell)]">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${ALERT_DOT[a.tone]}`} aria-hidden />
                  <span className="font-semibold tabular-nums">{a.count}</span>
                  <span className="min-w-0 flex-1 text-[var(--color-ink-2)]">{a.title}</span>
                  <span className="text-[11px] text-[var(--color-brand-2)] group-open:hidden">Show</span>
                </summary>
                <div className="border-t border-[var(--color-line)] px-3 py-2">
                  <p className="mb-1.5 text-[11px] text-[var(--color-ink-3)]">{a.why}</p>
                  <ul className="space-y-1 text-[11.5px]">
                    {a.records.map((r, n) => (
                      <li key={`${r.invoiceId ?? r.customerId}-${n}`} className="flex flex-wrap justify-between gap-x-2">
                        {r.invoiceId ? (
                          <Link href={ROUTES.editInvoice(r.invoiceId)} className="link">
                            {r.label}
                          </Link>
                        ) : r.customerId ? (
                          <Link href={ROUTES.customer(r.customerId)} className="link">
                            {r.label}
                          </Link>
                        ) : (
                          <span>{r.label}</span>
                        )}
                        {r.detail && <span className="text-[var(--color-ink-3)]">{r.detail}</span>}
                      </li>
                    ))}
                  </ul>
                  {(a.count > a.records.length || a.missing) && (
                    <div className="mt-1.5 text-[11px] text-[var(--color-ink-3)]">
                      {a.count > a.records.length && `${a.count - a.records.length} more. `}
                      {a.missing && (
                        <Link href={missingHref(a.missing)} className="link">
                          Every invoice missing it, in Search →
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
