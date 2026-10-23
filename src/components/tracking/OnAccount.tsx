/**
 * Payments and notes on account — the customer-level counterpart of an
 * invoice's Receipts and Credit/Debit Notes.
 *
 * Accounts books the amount against the customer first and attributes it to
 * invoices when it knows which: all of it to one, or a part to each of several.
 * Every attribution becomes an ordinary receipt or note on its invoice, so the
 * invoice's balance, forex and status follow at once; Undo takes it back and
 * the amount is on account again.
 */
import Link from "next/link";

import { currencyLabel, currencyOptions } from "@/lib/choices";
import { HOME_CURRENCY } from "@/lib/money";
import {
  currenciesFit,
  ON_ACCOUNT_KINDS,
  ON_ACCOUNT_LABELS,
  onAccountTotals,
  type OnAccountEntry,
} from "@/lib/payments/onAccount";
import type { TrackedInvoice } from "@/lib/payments/record";
import { ROUTES } from "@/lib/routes";
import { deleteNoteAction, deleteReceiptAction } from "@/server/payments/actions";
import {
  attributeOnAccountAction,
  deleteOnAccountAction,
  saveOnAccountAction,
} from "@/server/payments/onAccountActions";
import { Banner } from "../ui";
import { ConfirmDelete } from "./ConfirmDelete";
import { day, Field, money, rate, TONE_CLASS } from "./bits";

const KIND_TONE = { RECEIPT: TONE_CLASS.ok, CREDIT: TONE_CLASS.info, DEBIT: TONE_CLASS.warn } as const;

const KIND_OPTIONS = ON_ACCOUNT_KINDS.map((k) => [k, ON_ACCOUNT_LABELS[k]] as const);

export function OnAccountPanel({
  customerId,
  currency,
  entries,
  invoices,
  message,
  returnTo,
}: {
  customerId: string;
  /** The customer's currency, the default for a new entry. */
  currency: string | null;
  entries: OnAccountEntry[];
  invoices: TrackedInvoice[];
  /** The result of the last action, to show at the top. */
  message?: string;
  returnTo: string;
}) {
  const byCurrency = new Map<string, OnAccountEntry[]>();
  for (const e of entries) {
    const k = e.currency ?? "—";
    byCurrency.set(k, [...(byCurrency.get(k) ?? []), e]);
  }

  return (
    <section className="card mb-5 scroll-mt-4" id="on-account">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="card-title mb-0">Payments and notes on account</h2>
        <div className="flex flex-wrap gap-1.5">
          {[...byCurrency.entries()].map(([cur, list]) => {
            const t = onAccountTotals(list);
            const c = cur === "—" ? null : cur;
            return t.entries > 0 ? (
              <span key={cur} className={`chip ${TONE_CLASS.ok}`}>
                {money(t.net, c)} on account, not yet attributed
              </span>
            ) : null;
          })}
        </div>
      </div>
      <p className="mb-4 text-[12px] text-[var(--color-ink-3)]">
        Book a payment, credit note or debit note against the customer now, and attribute it to one or
        more of their invoices when you know which. Until then it is held here and counted in the
        customer&rsquo;s net balance.
      </p>

      {message && <Banner tone="info">{message}</Banner>}

      {/* ---------------------------------------------------------- add */}
      <form
        action={saveOnAccountAction}
        className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-line)] bg-[#f8fafc] p-4"
      >
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <Field name="kind" label="Type" options={KIND_OPTIONS} value="RECEIPT" blankLabel={null} width="w-44" />
        <Field name="entryDate" label="Date" type="date" width="w-40" />
        <Field name="amount" label="Amount" type="number" width="w-36" />
        <Field
          name="currency"
          label="Currency"
          value={currency}
          options={currencyOptions(currency).map((c) => [c, currencyLabel(c)] as const)}
          blankLabel="— customer's —"
          width="w-48"
        />
        <Field
          name="exchangeRate"
          label="Exchange rate"
          type="number"
          width="w-32"
          hint={`${HOME_CURRENCY} per unit, payments only`}
        />
        <Field name="reference" label="Bank ref. / note no." width="min-w-[160px] flex-1" />
        <Field name="remarks" label="Remarks" width="min-w-[180px] flex-1" />
        <button type="submit" className="btn">
          Add on account
        </button>
      </form>

      {/* ---------------------------------------------------------- entries */}
      {entries.length === 0 ? (
        <p className="text-[12px] text-[var(--color-ink-3)]">Nothing is held on account for this customer.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} invoices={invoices} customerId={customerId} returnTo={returnTo} />
          ))}
        </div>
      )}
    </section>
  );
}

function EntryRow({
  entry: e,
  invoices,
  customerId,
  returnTo,
}: {
  entry: OnAccountEntry;
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

  return (
    <div className="rounded-xl border border-[var(--color-line)] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[220px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`chip ${KIND_TONE[e.kind]}`}>{ON_ACCOUNT_LABELS[e.kind]}</span>
            <span className="text-[12px] text-[var(--color-ink-2)]">{day(e.entryDate)}</span>
            {e.reference && <span className="text-[12px] text-[var(--color-ink-3)]">· {e.reference}</span>}
          </div>
          {e.remarks && <p className="mt-1 text-[11px] italic text-[var(--color-ink-3)]">{e.remarks}</p>}
          {e.kind === "RECEIPT" && e.exchangeRate !== null && (
            <p className="mt-1 text-[11px] text-[var(--color-ink-3)]">at {rate(e.exchangeRate)}</p>
          )}
        </div>

        <dl className="grid grid-cols-3 gap-x-6 text-right text-[12px]">
          <dt className="text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">Amount</dt>
          <dt className="text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">Attributed</dt>
          <dt className="text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">On account</dt>
          <dd className="tabular-nums">{money(e.amount, cur)}</dd>
          <dd className="tabular-nums">{money(e.attributed, cur)}</dd>
          <dd className={`font-semibold tabular-nums ${e.unattributed > 0 ? "text-[var(--color-accent)]" : "text-[var(--color-ink-3)]"}`}>
            {money(e.unattributed, cur)}
          </dd>
        </dl>
      </div>

      {e.excess > 0 && (
        <p className="mt-2 text-[11px] font-semibold text-[var(--color-bad-fg)]">
          {money(e.excess, cur)} more has been attributed than this entry is for. Undo one below, or
          correct the amount.
        </p>
      )}

      {e.attributions.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {e.attributions.map((a) => (
            <li
              key={a.id}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[#f7f9fc] py-0.5 pl-2.5 pr-1 text-[11px]"
            >
              <span>
                → <Link href={ROUTES.invoice(a.invoiceId)} className="link">{a.invoiceNo ?? "invoice"}</Link>{" "}
                <span className="tabular-nums">{money(a.amount, cur)}</span>
              </span>
              <form action={e.kind === "RECEIPT" ? deleteReceiptAction : deleteNoteAction}>
                <input type="hidden" name="invoiceId" value={a.invoiceId} />
                <input type="hidden" name={e.kind === "RECEIPT" ? "receiptId" : "noteId"} value={a.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button
                  type="submit"
                  className="rounded-full px-1.5 text-[10px] font-semibold text-[var(--color-bad-fg)] hover:bg-[var(--color-bad-bg)]"
                  title="Take this back off the invoice; the amount returns to on account"
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
              No {cur ? `${cur} ` : ""}invoice of this customer
              {e.kind === "DEBIT" ? "" : " still owes anything"} to attribute it to yet.
            </p>
          ) : (
            <>
              <Field
                name="invoiceId"
                label="Attribute to invoice"
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
                blankLabel="— choose —"
                width="min-w-[280px] flex-[2]"
              />
              <Field
                name="amount"
                label="Amount"
                type="number"
                placeholder={e.kind === "DEBIT" ? "all of it" : "as much as fits"}
                width="w-40"
              />
              <button type="submit" className="btn">
                Attribute
              </button>
            </>
          )}
        </form>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] font-semibold text-[var(--color-brand-2)]">
          Edit or delete this entry
        </summary>
        <form action={saveOnAccountAction} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="onAccountId" value={e.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Field name="kind" label="Type" options={KIND_OPTIONS} value={e.kind} blankLabel={null} width="w-44" />
          <Field name="entryDate" label="Date" type="date" value={e.entryDate} width="w-40" />
          <Field name="amount" label="Amount" type="number" value={e.amount} width="w-32" />
          <Field
            name="currency"
            label="Currency"
            value={e.currency}
            options={currencyOptions(e.currency)}
            blankLabel="— customer's —"
            width="w-32"
          />
          <Field name="exchangeRate" label="Exchange rate" type="number" value={e.exchangeRate} width="w-28" />
          <Field name="reference" label="Reference" value={e.reference} width="min-w-[140px] flex-1" />
          <Field name="remarks" label="Remarks" value={e.remarks} width="min-w-[160px] flex-1" />
          <button type="submit" className="btn-ghost">
            Save
          </button>
        </form>
        <div className="mt-2">
          <ConfirmDelete
            action={deleteOnAccountAction}
            fields={{ onAccountId: e.id, returnTo }}
            label="Delete this entry"
            question={
              e.attributions.length > 0
                ? `This also takes back the ${e.attributions.length} attribution(s) made from it, so those invoices owe that money again.`
                : "The entry is removed from this customer."
            }
            small
          />
        </div>
      </details>
    </div>
  );
}
