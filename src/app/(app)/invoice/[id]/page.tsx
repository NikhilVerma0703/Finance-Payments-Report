/**
 * One invoice, in full.
 *
 * Everything about it on one screen: the figures as calculated, the payment
 * milestones with the basis date each was counted from, every receipt with its
 * own rate difference and forex, the credit and debit notes, and the editable
 * record underneath. **Add Receipt** has no limit.
 *
 * The milestone table is the part worth reading twice. It shows which date each
 * portion was counted from, so a due date is never a number the system simply
 * asserts — a reader can see that 120 days was added to the BL date of 30 May
 * and arrive at the same answer.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Facts,
  Field,
  homeMoney,
  money,
  rate,
  StatusChip,
  TONE_CLASS,
  day,
} from "@/components/tracking/bits";
import { HistoryPanel } from "@/components/tracking/History";
import { Banner, Empty, PageHead } from "@/components/ui";
import { BASIS_LABELS } from "@/lib/payments/terms";
import { SUPPORTED_TERMS } from "@/lib/payments/terms";
import { INVOICE_FIELD_GROUPS } from "@/lib/payments/form";
import {
  deleteInvoiceAction,
  deleteNoteAction,
  deleteReceiptAction,
  saveInvoiceAction,
  saveNoteAction,
  saveReceiptAction,
} from "@/server/payments/actions";
import { invoiceHistory } from "@/server/payments/audit";
import { ROUTES } from "@/lib/routes";
import { loadInvoice } from "@/server/payments/query";

export const dynamic = "force-dynamic";

/** Format hints, only where the expected input is not obvious. */
const HINTS: Record<string, string> = {
  exchangeRate: "Home currency per unit of foreign currency",
  paymentTerms: "e.g. 120 Days From BL Date",
  enteredDueDate: "Overrides the calculated due date",
};

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const { invoice, customers, today, siblings } = await loadInvoice(id);
  if (!invoice) notFound();

  const history = await invoiceHistory(id);

  const m = invoice.money;
  const s = invoice.schedule;
  const values = invoice as unknown as Record<string, string | number | null>;

  return (
    <>
      <PageHead
        title={invoice.invoiceNo ?? "Invoice (no number)"}
        lead={
          invoice.customerName
            ? `${invoice.customerName}${invoice.currency ? ` · ${invoice.currency}` : ""}`
            : "No customer recorded"
        }
        actions={
          <>
            {invoice.customerId && (
              <Link href={ROUTES.customer(invoice.customerId)} className="btn-ghost">
                Customer
              </Link>
            )}
            <Link href={ROUTES.dashboard} className="btn-ghost">
              Dashboard
            </Link>
            <Link href={ROUTES.editInvoice(invoice.id)} className="btn">
              EDIT OR ADD EXTRA INFORMATIONS
            </Link>
          </>
        }
      />

      {saved && (
        <Banner tone="ok">
          {saved === "created" ? "Record saved." : "Changes saved."} Every figure below has been
          recalculated, and the dashboard, search and reports show the same.
        </Banner>
      )}

      {/* ------------------------------------------------- the position */}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <section className="card">
          <h2 className="card-title">Position</h2>
          <Facts
            rows={[
              ["Status", <StatusChip key="s" status={invoice.status} note={invoice.statusNote} />],
              ["Invoice value", <span key="v" className="tabular-nums">{money(invoice.customerInvoiceValue, invoice.currency)}</span>],
              ["Received", <span key="r" className="tabular-nums">{money(m.totalReceived, invoice.currency)} over {m.receiptCount} receipt(s)</span>],
              ["Credit notes", <span key="cn" className="tabular-nums">{money(m.creditNotes, invoice.currency)}</span>],
              ["Debit notes", <span key="dn" className="tabular-nums">{money(m.debitNotes, invoice.currency)}</span>],
              [
                "Outstanding",
                <strong key="o" className="tabular-nums">
                  {money(m.calculatedOutstanding, invoice.currency)}
                </strong>,
              ],
              ["Collected", m.collectedPct === null ? "—" : `${m.collectedPct}%`],
              [
                "As per books",
                m.booksBalance === null ? (
                  "not entered"
                ) : (
                  <span key="b" className="tabular-nums">
                    {money(m.booksBalance, invoice.currency)}
                    {m.booksDifference !== null && Math.abs(m.booksDifference) > 0.01 && (
                      <strong className="ml-1 text-[var(--color-bad-fg)]">
                        differs by {money(m.booksDifference, invoice.currency)}
                      </strong>
                    )}
                  </span>
                ),
              ],
            ]}
          />
        </section>

        <section className="card">
          <h2 className="card-title">Dates</h2>
          <Facts
            rows={[
              ["Invoice date", day(invoice.invoiceDate)],
              ["BL date", day(invoice.blDate)],
              ["Shipping bill", `${invoice.shippingBillNo ?? "—"} · ${day(invoice.shippingBillDate)}`],
              ["ETA / arrival", day(invoice.eta)],
              ["Documents presented", day(invoice.docsPresentedDate)],
              [
                "Due date",
                s.dueDate ? (
                  <span key="d" title={s.dueDateNote}>
                    {day(s.dueDate)}{" "}
                    <span className="text-[var(--color-ink-3)]">
                      ({s.dueDateSource === "entered" ? "entered" : "calculated"})
                    </span>
                  </span>
                ) : (
                  <span key="d" className="text-[var(--color-warn-fg)]">
                    requires verification
                  </span>
                ),
              ],
              [
                "Overdue days",
                invoice.overdueDays === null
                  ? "—"
                  : invoice.overdueDays > 0
                    ? `${invoice.overdueDays} day(s) past due`
                    : `${Math.abs(invoice.overdueDays)} day(s) to go`,
              ],
              ["Invoice age", invoice.invoiceAge === null ? "—" : `${invoice.invoiceAge} day(s)`],
              ["Ageing", invoice.ageing],
              ["Today", today],
            ]}
          />
        </section>

        <section className="card">
          <h2 className="card-title">Forex</h2>
          <Facts
            rows={[
              ["Invoice rate", rate(invoice.exchangeRate)],
              ["Home value", <span key="h" className="tabular-nums">{homeMoney(m.homeInvoiceValue)}</span>],
              ["Home received", <span key="hr" className="tabular-nums">{homeMoney(m.homeReceived)}</span>],
              [
                "Gain / loss",
                m.totalForexGainLoss === null ? (
                  "not calculable"
                ) : (
                  <strong
                    key="f"
                    className={`tabular-nums ${m.totalForexGainLoss >= 0 ? "text-[var(--color-ok-fg)]" : "text-[var(--color-bad-fg)]"}`}
                  >
                    {homeMoney(m.totalForexGainLoss)} {m.totalForexGainLoss >= 0 ? "gain" : "loss"}
                  </strong>
                ),
              ],
            ]}
          />
          {m.forexNote && (
            <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">{m.forexNote}</p>
          )}
        </section>
      </div>

      {invoice.needsAttention && (
        <Banner tone="warn">
          <ul className="list-disc space-y-0.5 pl-5">
            {invoice.attentionReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Banner>
      )}

      {/* ------------------------------------------------- milestones */}
      <section className="card mb-5 mt-4">
        <h2 className="card-title">Payment milestones</h2>
        <p className="mb-3 text-[12px] text-[var(--color-ink-2)]">
          {s.term.raw ? (
            <>
              <strong>&ldquo;{s.term.raw}&rdquo;</strong> — read as {s.term.description}.
            </>
          ) : (
            "No payment terms recorded, so no due date can be worked out."
          )}
        </p>

        {s.milestones.length > 0 ? (
          <div className="tablewrap">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
                  <th className="px-3 py-2">Portion</th>
                  <th className="px-3 py-2 text-right">%</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Counted from</th>
                  <th className="px-3 py-2">Basis date</th>
                  <th className="px-3 py-2 text-right">+ days</th>
                  <th className="px-3 py-2">Due date</th>
                  <th className="px-3 py-2 text-right">Settled</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                  <th className="px-3 py-2">State</th>
                </tr>
              </thead>
              <tbody>
                {s.milestones.map((ms) => (
                  <tr key={ms.seq} className="border-t border-[var(--color-line)]">
                    <td className="px-3 py-2">{ms.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{ms.percent}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(ms.amount, invoice.currency)}</td>
                    <td className="px-3 py-2">{BASIS_LABELS[ms.basis]}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {ms.basisDate ? (
                        day(ms.basisDate)
                      ) : (
                        <span className="text-[var(--color-warn-fg)]">not recorded</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{ms.days}</td>
                    <td className="whitespace-nowrap px-3 py-2" title={ms.pending ?? undefined}>
                      {ms.dueDate ? (
                        <strong>{day(ms.dueDate)}</strong>
                      ) : (
                        <span className="text-[var(--color-warn-fg)]">requires verification</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(ms.settled, invoice.currency)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {money(ms.outstanding, invoice.currency)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`chip ${
                          ms.state === "PAID"
                            ? TONE_CLASS.ok
                            : ms.state === "OVERDUE"
                              ? TONE_CLASS.bad
                              : ms.state === "DUE_SOON"
                                ? TONE_CLASS.warn
                                : ms.state === "NO_DATE"
                                  ? TONE_CLASS.mute
                                  : TONE_CLASS.info
                        }`}
                      >
                        {ms.state.replace("_", " ").toLowerCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{s.dueDateNote}</Empty>
        )}

        {s.term.assumptions.length > 0 && (
          <div className="mt-3">
            <h3 className="text-[12px] font-semibold text-[var(--color-warn-fg)]">
              Assumptions applied
            </h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] text-[var(--color-ink-2)]">
              {s.term.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        {s.verificationReasons.length > 0 && (
          <div className="mt-3">
            <h3 className="text-[12px] font-semibold">No due date</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] text-[var(--color-ink-2)]">
              {s.verificationReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
          {money(s.overdueAmount, invoice.currency)} of {money(m.calculatedOutstanding, invoice.currency)} outstanding is past due.
        </p>
      </section>

      {/* ------------------------------------------------- receipts */}
      <section className="card mb-5">
        <h2 className="card-title">Receipts</h2>
        {m.receipts.length === 0 ? (
          <Empty>No receipts recorded yet.</Empty>
        ) : (
          <div className="tablewrap">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2 text-right">Amount (FCY)</th>
                  <th className="px-2 py-2 text-right">Exchange rate</th>
                  <th className="px-2 py-2 text-right">Rate difference</th>
                  <th className="px-2 py-2 text-right">Forex gain / loss</th>
                  <th className="px-2 py-2 text-right">Home value</th>
                  <th className="px-2 py-2">Bank reference</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {m.receipts.map((r) => (
                  <tr key={r.seq} className="border-t border-[var(--color-line)] align-top">
                    <td className="px-2 py-2 font-medium">{r.seq}</td>
                    <td className="px-2 py-2">
                      {/*
                        Every one of a receipt's five fields is on this row,
                        including Remarks. That is not tidiness: a form that
                        shows four of five used to write a blank over the fifth,
                        because "not on the form" and "cleared by the user" look
                        the same in a FormData. The save path now only writes
                        what it was given — and this row gives it everything.
                      */}
                      <form action={saveReceiptAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <input
                          type="hidden"
                          name="receiptId"
                          value={r.id ?? ""}
                        />
                        <input
                          name="receiptDate"
                          type="date"
                          defaultValue={r.receiptDate ?? ""}
                          className="input w-36"
                          aria-label={`Receipt ${r.seq} date`}
                        />
                        <input
                          name="amountFcy"
                          defaultValue={r.amountFcy ?? ""}
                          className="input w-32 text-right"
                          inputMode="decimal"
                          aria-label={`Receipt ${r.seq} amount`}
                        />
                        <input
                          name="exchangeRate"
                          defaultValue={r.exchangeRate ?? ""}
                          className="input w-28 text-right"
                          inputMode="decimal"
                          aria-label={`Receipt ${r.seq} exchange rate`}
                        />
                        <input
                          name="bankRef"
                          defaultValue={r.bankRef ?? ""}
                          className="input w-40"
                          placeholder="Bank reference"
                          aria-label={`Receipt ${r.seq} bank reference`}
                        />
                        <input
                          name="remarks"
                          defaultValue={r.remarks ?? ""}
                          className="input w-56"
                          placeholder="Remarks"
                          aria-label={`Receipt ${r.seq} remarks`}
                        />
                        <button type="submit" className="btn-ghost">
                          Save
                        </button>
                      </form>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(r.amountFcy, invoice.currency)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{rate(r.exchangeRate)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{rate(r.rateDifference)}</td>
                    <td
                      className={`px-2 py-2 text-right tabular-nums ${
                        r.forexGainLoss === null
                          ? "text-[var(--color-ink-3)]"
                          : r.forexGainLoss >= 0
                            ? "text-[var(--color-ok-fg)]"
                            : "text-[var(--color-bad-fg)]"
                      }`}
                      title={r.note ?? undefined}
                    >
                      {homeMoney(r.forexGainLoss)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-[var(--color-ink-3)]">
                      {homeMoney(r.homeValue)}
                    </td>
                    <td className="px-2 py-2 text-[11px] text-[var(--color-ink-3)]">
                      {r.bankRef ?? "—"}
                      {r.remarks && <div className="italic">{r.remarks}</div>}
                    </td>
                    <td className="px-2 py-2">
                      <form action={deleteReceiptAction}>
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <input
                          type="hidden"
                          name="receiptId"
                          value={r.id ?? ""}
                        />
                        <button type="submit" className="btn-danger">
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--color-line)] bg-[#f7f9fc] font-semibold">
                  <td className="px-2 py-2" colSpan={2}>
                    {m.receiptCount} receipt(s)
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(m.totalReceived, invoice.currency)}</td>
                  <td className="px-2 py-2" colSpan={2} />
                  <td className="px-2 py-2 text-right tabular-nums">{homeMoney(m.totalForexGainLoss)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{homeMoney(m.homeReceived)}</td>
                  <td className="px-2 py-2" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <form action={saveReceiptAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <div className="pt-5 text-[12px] font-semibold">Add receipt {m.receiptCount + 1}</div>
          <Field name="receiptDate" label="Date" type="date" width="w-40" />
          <Field name="amountFcy" label="Amount (FCY)" type="number" width="w-40" />
          <Field name="exchangeRate" label="Exchange rate" type="number" width="w-40" />
          <Field name="bankRef" label="Bank reference" width="min-w-[180px] flex-1" />
          <Field name="remarks" label="Remarks" width="min-w-[180px] flex-1" />
          <button type="submit" className="btn">
            Add receipt
          </button>
        </form>
      </section>

      {/* ------------------------------------------------- CN / DN */}
      <section className="card mb-5">
        <h2 className="card-title">Credit and debit notes</h2>
        {invoice.notes.length === 0 ? (
          <Empty>None recorded.</Empty>
        ) : (
          <div className="tablewrap">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2" />
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {invoice.notes.map((n, i) => (
                  <tr key={n.id ?? i} className="border-t border-[var(--color-line)]">
                    {/* every field editable in place, like the receipts above */}
                    <td className="px-3 py-2" colSpan={6}>
                      <form action={saveNoteAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <input type="hidden" name="noteId" value={n.id ?? ""} />
                        <select
                          name="noteType"
                          defaultValue={n.noteType === "DEBIT" ? "DEBIT" : "CREDIT"}
                          className="input w-32"
                          aria-label="Note type"
                        >
                          <option value="CREDIT">Credit note</option>
                          <option value="DEBIT">Debit note</option>
                        </select>
                        <input
                          name="noteNo"
                          defaultValue={n.noteNo ?? ""}
                          className="input w-32"
                          placeholder="Number"
                          aria-label="Note number"
                        />
                        <input
                          name="noteDate"
                          type="date"
                          defaultValue={n.noteDate ?? ""}
                          className="input w-36"
                          aria-label="Note date"
                        />
                        <input
                          name="amount"
                          defaultValue={n.amount ?? ""}
                          className="input w-32 text-right"
                          inputMode="decimal"
                          aria-label="Note amount"
                        />
                        <input
                          name="reason"
                          defaultValue={n.reason ?? ""}
                          className="input min-w-[200px] flex-1"
                          placeholder="Reason"
                          aria-label="Reason"
                        />
                        <button type="submit" className="btn-ghost">
                          Save
                        </button>
                      </form>
                    </td>
                    <td className="px-3 py-2">
                      <form action={deleteNoteAction}>
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <input type="hidden" name="noteId" value={n.id ?? ""} />
                        <button type="submit" className="btn-danger">
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--color-line)] bg-[#f7f9fc] text-[11px] font-semibold">
                  <td className="px-3 py-2" colSpan={3}>
                    {invoice.notes.length} note(s)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    − {money(m.creditNotes, invoice.currency)} CN / + {money(m.debitNotes, invoice.currency)} DN
                  </td>
                  <td className="px-3 py-2" colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <form action={saveNoteAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <div className="w-36">
            <label className="field-label" htmlFor="noteType">
              Type
            </label>
            <select id="noteType" name="noteType" className="input">
              <option value="CREDIT">Credit note</option>
              <option value="DEBIT">Debit note</option>
            </select>
          </div>
          <Field name="noteNo" label="Number" width="w-40" />
          <Field name="noteDate" label="Date" type="date" width="w-40" />
          <Field name="amount" label="Amount" type="number" width="w-40" />
          <Field name="reason" label="Reason" width="min-w-[200px] flex-1" />
          <button type="submit" className="btn">
            Add note
          </button>
        </form>
      </section>

      {/* ------------------------------------------------- the record */}
      <form action={saveInvoiceAction} className="space-y-4">
        <input type="hidden" name="invoiceId" value={invoice.id} />

        <section className="card">
          <h2 className="card-title">Customer</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64">
              <label className="field-label" htmlFor="customerId">
                Customer
              </label>
              <select
                id="customerId"
                name="customerId"
                defaultValue={invoice.customerId ?? ""}
                className="input"
              >
                <option value="">— none —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? "(unnamed)"}
                  </option>
                ))}
              </select>
            </div>
            <Field
              name="customerName"
              label="…or move to a new customer"
              width="min-w-[220px] flex-1"
              hint="Leave blank to keep the one above."
            />
          </div>
        </section>

        {INVOICE_FIELD_GROUPS.map((group) => (
          <section key={group.title} className="card">
            <h2 className="card-title">{group.title}</h2>
            {group.hint && (
              <p className="mb-3 text-[12px] text-[var(--color-ink-2)]">{group.hint}</p>
            )}
            <div className="flex flex-wrap gap-3">
              {group.fields.map(([name, label, type]) => (
                <Field
                  key={name}
                  name={name}
                  label={label}
                  type={type as "text" | "date" | "number"}
                  value={values[name] as string | number | null}
                  hint={HINTS[name]}
                  list={name === "paymentTerms" ? "pt-terms" : undefined}
                  width={
                    name === "remarks" || name === "followUpNotes"
                      ? "min-w-[280px] flex-[2]"
                      : "min-w-[180px] flex-1"
                  }
                />
              ))}
            </div>
          </section>
        ))}

        <datalist id="pt-terms">
          {SUPPORTED_TERMS.map((t) => (
            <option key={t.example} value={t.example} />
          ))}
        </datalist>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn">
            Save changes
          </button>
          <span className="text-[11px] text-[var(--color-ink-3)]">
            Clearing a field clears it.
          </span>
        </div>
      </form>

      {/*
        Provenance, deliberately not editable: these four say where the record
        came from. A field that records the truth about the data's origin is not
        improved by being typeable.
      */}
      <section className="card mt-5">
        <h2 className="card-title">Source</h2>
        <Facts
          rows={[
            ["Source", invoice.source === "EXCEL" ? "Excel upload" : "Entered by hand"],
            ["File", invoice.sourceFile ?? "—"],
            ["As on", day(invoice.sourceAsOn)],
          ]}
        />
      </section>

      <HistoryPanel history={history} />

      {invoice.missingFields.length > 0 && (
        <section className="card mt-5">
          <h2 className="card-title">Not yet recorded</h2>
          <ul className="list-disc space-y-1 pl-5 text-[12px] text-[var(--color-ink-2)]">
            {invoice.missingFields.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      )}

      {siblings.length > 0 && (
        <section className="card mt-5">
          <h2 className="card-title">Other invoices for {invoice.customerName}</h2>
          <div className="flex flex-wrap gap-1.5">
            {siblings.map((sib) => (
              <Link
                key={sib.id}
                href={ROUTES.invoice(sib.id)}
                className="chip border border-[var(--color-line)] bg-white hover:bg-[#f2f6fb]"
              >
                {sib.invoiceNo ?? "no number"} · {money(sib.money.calculatedOutstanding, sib.currency)}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="card mt-5">
        <h2 className="card-title">Delete this record</h2>
        <form action={deleteInvoiceAction}>
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <button type="submit" className="btn-danger">
            Delete invoice, its receipts and its notes
          </button>
          <span className="ml-2 text-[11px] text-[var(--color-ink-3)]">
            Affects this section only.
          </span>
        </form>
      </section>
    </>
  );
}
