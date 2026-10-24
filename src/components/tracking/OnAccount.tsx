/**
 * Adjust payment of this customer — payments received and credit/debit notes
 * booked against the customer before anyone has said which invoice they are
 * for, and assigned to invoices later (days later if need be, when the
 * Commercial Team sends the receipt or final invoice).
 *
 * Laid out as the invoice screen's own Receipts and Credit and debit notes:
 * the list, then an "Add receipt N" / "Add note" form. Above them, the
 * customer's balance with these counted — what came in against invoices, what
 * came in and is not yet assigned, and what is still owed once it is. Each
 * assignment becomes an ordinary receipt or note on the invoice, so its
 * balance, forex and status follow at once; Undo takes it back. Every booking,
 * correction, assignment and undo is in the history at the foot.
 *
 * The same section as the ERP's Payment Tracking (components/accounts/
 * tracking/OnAccount.tsx). The master table's customer names open it.
 */
import Link from "next/link";

import { currencyOptions } from "@/lib/choices";
import { HOME_CURRENCY } from "@/lib/money";
import { currenciesFit, ON_ACCOUNT_LABELS, type OnAccountEntry } from "@/lib/payments/onAccount";
import type { TrackedInvoice } from "@/lib/payments/record";
import { ROUTES } from "@/lib/routes";
import { deleteNoteAction, deleteReceiptAction } from "@/server/payments/actions";
import type { HistoryEntry } from "@/server/payments/audit";
import {
  attributeOnAccountAction,
  deleteOnAccountAction,
  saveOnAccountAction,
} from "@/server/payments/onAccountActions";
import { Banner, Empty } from "../ui";
import { ConfirmDelete } from "./ConfirmDelete";
import { day, Field, money, rate, TONE_CLASS } from "./bits";

export function OnAccountPanel({
  customerId,
  currency,
  entries,
  invoices,
  message,
  returnTo,
  history = [],
}: {
  customerId: string;
  /** The customer's currency: an entry with none is in it. */
  currency: string | null;
  entries: OnAccountEntry[];
  invoices: TrackedInvoice[];
  /** The result of the last action, to show at the top. */
  message?: string;
  returnTo: string;
  /** The customer's history; the adjustments are picked out of it. */
  history?: HistoryEntry[];
}) {
  // oldest first, so the numbers read in the order the money came in
  const byDate = (a: OnAccountEntry, b: OnAccountEntry) => (a.entryDate ?? "9999").localeCompare(b.entryDate ?? "9999");
  const receipts = entries.filter((e) => e.kind === "RECEIPT").sort(byDate);
  const notes = entries.filter((e) => e.kind !== "RECEIPT").sort(byDate);
  const adjustments = history.filter((h) => h.entity === "ON_ACCOUNT");

  return (
    <section className="card mb-5 scroll-mt-4" id="on-account">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-semibold tracking-tight">Adjust payment of this customer</h2>
        <span className="text-[11px] text-[var(--color-ink-3)]">assign each one to its invoice when the invoice is known</span>
      </div>
      <p className="mb-4 text-[12px] text-[var(--color-ink-3)]">
        Record a payment received, or a credit or debit note, against the customer without an invoice number. It counts in
        the customer&rsquo;s received and outstanding balance straight away, and is assigned to one or more invoices later —
        when the Commercial Team sends the receipt or final invoice.
      </p>

      {message && <Banner tone="info">{message}</Banner>}

      <div className="flex flex-col gap-5">
        <Balances invoices={invoices} entries={entries} />

        {/* ------------------------------------------------- receipts */}
        <div>
          <h3 className="card-title">Receipts</h3>
          {receipts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--color-line)]">
              <Empty>No receipts recorded yet.</Empty>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {receipts.map((e, i) => (
                <Entry key={e.id} entry={e} n={i + 1} invoices={invoices} customerId={customerId} returnTo={returnTo} />
              ))}
            </div>
          )}
          <form action={saveOnAccountAction} className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-line)] bg-[#f8fafc] p-3">
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="kind" value="RECEIPT" />
            <div className="pb-2 text-[13px] font-semibold">Add receipt {receipts.length + 1}</div>
            <Field name="entryDate" label="Date" type="date" width="w-40" />
            <Field name="amount" label={`Amount${currency ? ` (${currency})` : ""}`} type="number" width="w-40" />
            <Field name="exchangeRate" label="Exchange rate" type="number" width="w-36" hint={`${HOME_CURRENCY} per unit`} />
            <Field name="reference" label="Bank reference" width="min-w-[160px] flex-1" />
            <Field name="remarks" label="Remarks" width="min-w-[160px] flex-1" />
            <button type="submit" className="btn">
              Add receipt
            </button>
          </form>
        </div>

        {/* ------------------------------------------------- CN / DN */}
        <div>
          <h3 className="card-title">Credit and debit notes</h3>
          {notes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--color-line)]">
              <Empty>None recorded.</Empty>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {notes.map((e, i) => (
                <Entry key={e.id} entry={e} n={i + 1} invoices={invoices} customerId={customerId} returnTo={returnTo} />
              ))}
            </div>
          )}
          <form action={saveOnAccountAction} className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-line)] bg-[#f8fafc] p-3">
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Field name="kind" label="Type" options={[["CREDIT", "Credit note"], ["DEBIT", "Debit note"]]} value="CREDIT" blankLabel={null} width="w-36" />
            <Field name="reference" label="Number" width="w-40" />
            <Field name="entryDate" label="Date" type="date" width="w-40" />
            <Field name="amount" label={`Amount${currency ? ` (${currency})` : ""}`} type="number" width="w-40" />
            <Field name="remarks" label="Reason" width="min-w-[200px] flex-1" />
            <button type="submit" className="btn">
              Add note
            </button>
          </form>
        </div>

        {/* ------------------------------------------------- history */}
        <details className="rounded-xl border border-[var(--color-line)] px-4 py-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-[var(--color-ink-2)]">
            Adjustment history ({adjustments.length}) — every booking, correction, assignment and undo
          </summary>
          {adjustments.length === 0 ? (
            <p className="mt-2 text-[12px] text-[var(--color-ink-3)]">Nothing recorded yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--color-line)] text-[12px]">
              {adjustments.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                  <span className="w-32 shrink-0 tabular-nums text-[11px] text-[var(--color-ink-3)]">{h.at}</span>
                  <span className="font-medium">{h.label}</span>
                  <span className="text-[var(--color-ink-2)]">
                    {h.oldValue !== null && <span className="text-[var(--color-ink-3)] line-through">{h.oldValue}</span>}
                    {h.oldValue !== null && h.newValue !== null && " → "}
                    {h.newValue ?? (h.oldValue !== null ? " removed" : "")}
                  </span>
                  <span className="ml-auto text-[11px] text-[var(--color-ink-3)]">by {h.editedBy}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
            What was assigned also shows in each invoice&rsquo;s own history, as the receipt or note it became there.
          </p>
        </details>
      </div>
    </section>
  );
}

/**
 * The customer's position per currency with the adjustments counted: what was
 * invoiced, what came in against invoices, what came in and is not yet
 * assigned, and what is still owed once it is. Nothing here is stored.
 */
function Balances({ invoices, entries }: { invoices: TrackedInvoice[]; entries: OnAccountEntry[] }) {
  const currencies = [...new Set([...invoices.map((i) => i.currency ?? "—"), ...entries.map((e) => e.currency ?? "—")])];
  return (
    <div className="flex flex-col gap-2">
      {currencies.map((c) => {
        const cur = c === "—" ? null : c;
        const list = invoices.filter((i) => (i.currency ?? "—") === c);
        const held = entries.filter((e) => (e.currency ?? "—") === c);
        const invoiced = list.reduce((s, i) => s + (i.customerInvoiceValue ?? 0), 0);
        const onInvoices = list.reduce((s, i) => s + i.money.totalReceived, 0);
        const outstanding = list.reduce((s, i) => s + (i.money.calculatedOutstanding ?? 0), 0);
        const unassignedReceipts = held.filter((e) => e.kind === "RECEIPT").reduce((s, e) => s + e.unattributed, 0);
        const unassignedNotes = held.filter((e) => e.kind !== "RECEIPT").reduce((s, e) => s + e.credit, 0);
        const cells: Array<[string, number, string]> = [
          ["Invoiced", invoiced, "text-[var(--color-ink)]"],
          ["Received against invoices", onInvoices, "text-[var(--color-ink)]"],
          ["Received, not yet assigned", unassignedReceipts, "text-[var(--color-accent)]"],
          ["Total received", onInvoices + unassignedReceipts, "text-[var(--color-ok-fg)]"],
          ...(Math.abs(unassignedNotes) > 0.004
            ? ([["Notes, not yet assigned", unassignedNotes, "text-[var(--color-accent)]"]] as Array<[string, number, string]>)
            : []),
          ["Outstanding after adjustment", outstanding - unassignedReceipts - unassignedNotes, "text-[var(--color-bad-fg)]"],
        ];
        return (
          <div key={c} className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {cells.map(([label, value, ink]) => (
              <div key={label} className="rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-2.5">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
                  {label}
                  {currencies.length > 1 ? ` · ${c}` : ""}
                </div>
                <div className={`mt-1 text-[17px] font-semibold tabular-nums ${ink}`}>{money(value, cur)}</div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** One receipt or note held on account: its figures, where it has been assigned, and the form to assign the rest. */
function Entry({
  entry: e,
  n,
  invoices,
  customerId,
  returnTo,
}: {
  entry: OnAccountEntry;
  n: number;
  invoices: TrackedInvoice[];
  customerId: string;
  returnTo: string;
}) {
  const cur = e.currency;
  // what it can go to: an invoice in a currency it can pay; a payment or a
  // credit note only to one that still owes something, oldest due first
  const targets = invoices
    .filter((i) => currenciesFit(cur, i.currency))
    .filter((i) => e.kind === "DEBIT" || (i.money.calculatedOutstanding ?? 0) > 0.01)
    .sort((a, b) => (a.schedule.dueDate ?? "9999").localeCompare(b.schedule.dueDate ?? "9999"));
  const isReceipt = e.kind === "RECEIPT";

  return (
    <div className="rounded-xl border border-[var(--color-line)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-[240px] flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
          <span className="font-medium text-[var(--color-ink-3)]">{n}</span>
          {!isReceipt && (
            <span className={`chip ${e.kind === "DEBIT" ? TONE_CLASS.warn : TONE_CLASS.info}`}>{ON_ACCOUNT_LABELS[e.kind]}</span>
          )}
          <span className="text-[var(--color-ink-2)]">{day(e.entryDate)}</span>
          <strong className="tabular-nums">{money(e.amount, cur)}</strong>
          {isReceipt && e.exchangeRate !== null && <span className="text-[var(--color-ink-3)]">at {rate(e.exchangeRate)}</span>}
          {e.reference && (
            <span className="text-[var(--color-ink-3)]">
              {isReceipt ? "ref." : "no."} {e.reference}
            </span>
          )}
          {e.remarks && <span className="italic text-[var(--color-ink-3)]">{e.remarks}</span>}
        </div>
        <div className="flex gap-4 text-right text-[11px]">
          <div>
            <div className="uppercase tracking-wide text-[var(--color-ink-3)]">Assigned</div>
            <div className="text-[13px] tabular-nums">{money(e.attributed, cur)}</div>
          </div>
          <div>
            <div className="uppercase tracking-wide text-[var(--color-ink-3)]">Not yet assigned</div>
            <div className={`text-[13px] font-semibold tabular-nums ${e.unattributed > 0 ? "text-[var(--color-accent)]" : "text-[var(--color-ink-3)]"}`}>
              {money(e.unattributed, cur)}
            </div>
          </div>
        </div>
      </div>

      {e.excess > 0 && (
        <p className="mt-2 text-[11px] font-semibold text-[var(--color-bad-fg)]">
          {money(e.excess, cur)} more has been assigned than this is for. Undo one below, or correct the amount.
        </p>
      )}

      {e.attributions.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {e.attributions.map((a) => (
            <li key={a.id} className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[#f7f9fc] py-0.5 pl-2.5 pr-1 text-[11px]">
              <span>
                assigned to{" "}
                <Link href={ROUTES.invoice(a.invoiceId)} className="link">
                  {a.invoiceNo ?? "invoice"}
                </Link>{" "}
                <span className="tabular-nums">{money(a.amount, cur)}</span>
              </span>
              <form action={isReceipt ? deleteReceiptAction : deleteNoteAction}>
                <input type="hidden" name="invoiceId" value={a.invoiceId} />
                <input type="hidden" name={isReceipt ? "receiptId" : "noteId"} value={a.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button
                  type="submit"
                  className="rounded-full px-1.5 text-[10px] font-semibold text-[var(--color-bad-fg)] hover:bg-[var(--color-bad-bg)]"
                  title="Take this back off the invoice; it becomes unassigned again"
                >
                  Undo
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {e.unattributed > 0 && (
        <form action={attributeOnAccountAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-dashed border-[var(--color-line)] pt-3">
          <input type="hidden" name="onAccountId" value={e.id} />
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          {targets.length === 0 ? (
            <p className="text-[11px] text-[var(--color-ink-3)]">
              No {cur ? `${cur} ` : ""}invoice of this customer{e.kind === "DEBIT" ? "" : " still owes anything"} to assign it to
              yet — it stays here until there is.
            </p>
          ) : (
            <>
              <Field
                name="invoiceId"
                label="Assign to invoice no."
                options={targets.map(
                  (i) =>
                    [
                      i.id,
                      `${i.invoiceNo ?? "(no number)"} · ${money(i.money.calculatedOutstanding, i.currency)} owing${
                        i.schedule.dueDate ? ` · due ${day(i.schedule.dueDate)}` : ""
                      }`,
                    ] as const,
                )}
                value={targets[0].id}
                blankLabel="— choose the invoice —"
                width="min-w-[280px] flex-[2]"
              />
              <Field name="amount" label="Amount to assign" type="number" placeholder={e.kind === "DEBIT" ? "all of it" : "as much as fits"} width="w-40" />
              <button type="submit" className="btn">
                Assign
              </button>
            </>
          )}
        </form>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] font-semibold text-[var(--color-brand-2)]">Correct or delete</summary>
        <form action={saveOnAccountAction} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="onAccountId" value={e.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          {!isReceipt && (
            <Field name="kind" label="Type" options={[["CREDIT", "Credit note"], ["DEBIT", "Debit note"]]} value={e.kind} blankLabel={null} width="w-36" />
          )}
          <Field name="entryDate" label="Date" type="date" value={e.entryDate} width="w-40" />
          <Field name="amount" label="Amount" type="number" value={e.amount} width="w-32" />
          <Field name="currency" label="Currency" value={e.currency} options={currencyOptions(e.currency)} blankLabel="— customer's —" width="w-32" />
          {isReceipt && <Field name="exchangeRate" label="Exchange rate" type="number" value={e.exchangeRate} width="w-28" />}
          <Field name="reference" label={isReceipt ? "Bank reference" : "Number"} value={e.reference} width="min-w-[140px] flex-1" />
          <Field name="remarks" label={isReceipt ? "Remarks" : "Reason"} value={e.remarks} width="min-w-[160px] flex-1" />
          <button type="submit" className="btn-ghost">
            Save
          </button>
        </form>
        <div className="mt-2">
          <ConfirmDelete
            action={deleteOnAccountAction}
            fields={{ onAccountId: e.id, returnTo }}
            label="Delete"
            question={
              e.attributions.length > 0
                ? `This also takes back its ${e.attributions.length} assignment(s), so those invoices owe that money again. The history keeps a record.`
                : "It is removed from this customer. The history keeps a record."
            }
            small
          />
        </div>
      </details>
    </div>
  );
}
