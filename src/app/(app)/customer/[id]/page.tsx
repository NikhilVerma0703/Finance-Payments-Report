/**
 * One customer, in full.
 *
 * Their invoices, what has been received, what is outstanding, the payment
 * terms in use, the shipping references, and their own editable record. The
 * per-currency figures are separate, because a customer invoiced in two
 * currencies has two positions and not one.
 *
 * Money received or credited before anyone knows which invoice it is for is
 * booked here, on account, and attributed to invoices later — see
 * `OnAccountPanel`.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { day, Facts, Field, homeMoney, money } from "@/components/tracking/bits";
import { CustomerRegister } from "@/components/tracking/CustomerRegister";
import { HistoryPanel } from "@/components/tracking/History";
import { OnAccountPanel } from "@/components/tracking/OnAccount";
import { Empty, PageHead } from "@/components/ui";
import { countryOptions, currencyLabel, currencyOptions } from "@/lib/choices";
import { SUPPORTED_TERMS } from "@/lib/payments/terms";
import { deleteCustomerAction, saveCustomerAction } from "@/server/payments/actions";
import { customerHistory } from "@/server/payments/audit";
import { isSettled } from "@/lib/payments/completed";
import { markCompletedAction } from "@/server/payments/managementActions";
import { loadCustomer } from "@/server/payments/query";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onAccount?: string; done?: string }>;
}) {
  const { id } = await params;
  const { onAccount: message, done } = await searchParams;
  const { customer, invoices, completed, onAccount, erp, kpis, today } = await loadCustomer(id);
  if (!customer) notFound();

  // the currency this customer's invoices fall back to, and where it came from
  const currency = customer.currency ?? erp?.currency ?? null;

  const history = await customerHistory(id);

  // which payment-term wordings this customer's invoices actually use, and what
  // each was understood to mean — four spellings of one term is normal
  const terms = new Map<string, { count: number; understood: string; unknown: boolean }>();
  for (const i of invoices) {
    const raw = (i.paymentTerms ?? "").trim();
    if (!raw) continue;
    const entry = terms.get(raw);
    if (entry) entry.count += 1;
    else {
      // the reading already applied to this invoice, rules from Settings included
      const t = i.schedule.term;
      terms.set(raw, { count: 1, understood: t.description, unknown: t.unknown });
    }
  }
  const incomplete = invoices.filter((i) => i.missingFields.length > 0);
  const withoutTerms = invoices.filter((i) => !i.paymentTerms).length;
  const withoutDue = invoices.filter((i) => !i.schedule.dueDate).length;

  return (
    <>
      <PageHead
        title={customer.name ?? "Customer (unnamed)"}
        lead={[customer.country, currency, customer.defaultPaymentTerms]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <Link href="#on-account" className="btn-ghost">
              Payment on account
            </Link>
            <Link href={`${ROUTES.newRecord}?customerId=${customer.id}`} className="btn-ghost">
              Add an invoice
            </Link>
            <Link
              href={`${ROUTES.exportView}?customer=${encodeURIComponent(customer.name ?? "")}`}
              className="btn-ghost"
            >
              Export Excel
            </Link>
            <Link href={ROUTES.dashboard} className="btn-ghost">
              Dashboard
            </Link>
          </>
        }
      />

      {kpis.length > 0 && (
        <div className="mb-5 grid gap-4 lg:grid-cols-3">
          {kpis.map((k) => (
            <section key={k.currency} className="card">
              <h2 className="card-title">{k.currency}</h2>
              <Facts
                rows={[
                  ["Invoices", String(k.invoices)],
                  ["Invoiced", <span key="a" className="tabular-nums">{money(k.totalInvoiceValue, k.currency)}</span>],
                  ["Received", <span key="b" className="tabular-nums">{money(k.totalReceived, k.currency)} ({k.collectionRate}%)</span>],
                  [
                    "Outstanding",
                    <strong key="c" className="tabular-nums">{money(k.totalOutstanding, k.currency)}</strong>,
                  ],
                  [
                    "Overdue",
                    <span key="d" className="tabular-nums">
                      {money(k.overdueOutstanding, k.currency)} on {k.overdueInvoices} invoice(s)
                    </span>,
                  ],
                  [
                    "Cannot be assessed",
                    k.requiresVerification > 0.01 ? (
                      <span key="e" className="tabular-nums text-[var(--color-warn-fg)]">
                        {money(k.requiresVerification, k.currency)} on {k.requiresVerificationInvoices} invoice(s)
                      </span>
                    ) : (
                      "—"
                    ),
                  ],
                  [
                    "Forex gain / loss",
                    k.forexGainLoss === null ? (
                      "not calculable"
                    ) : (
                      <span key="f" className="tabular-nums">{homeMoney(k.forexGainLoss)}</span>
                    ),
                  ],
                  ["Needs attention", String(k.needsAttention)],
                  ...(k.onAccount.entries > 0
                    ? ([
                        [
                          "On account",
                          <span key="g" className="tabular-nums text-[var(--color-accent)]">
                            {money(k.onAccount.net, k.currency)} not yet attributed
                          </span>,
                        ],
                        [
                          "Net outstanding",
                          <strong key="h" className="tabular-nums">
                            {money(k.totalOutstanding - k.onAccount.net, k.currency)}
                          </strong>,
                        ],
                      ] as Array<[string, React.ReactNode]>)
                    : []),
                ]}
              />
            </section>
          ))}
        </div>
      )}

      {done && (
        <div className="mb-4 rounded-lg border border-[#c6dcf3] bg-[var(--color-info-bg)] px-3 py-2 text-[12px] text-[var(--color-info-fg)]">{done}</div>
      )}

      {/* the customer's settled invoices can leave its active list in one go (owner, 25 Oct 2026) */}
      {(invoices.some(isSettled) || completed.length > 0) && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-line)] bg-white px-4 py-3 text-[13px]">
          {invoices.some(isSettled) && (
            <form action={markCompletedAction}>
              {invoices.filter(isSettled).map((i) => (
                <input key={i.id} type="hidden" name="id" value={i.id} />
              ))}
              <input type="hidden" name="returnTo" value={ROUTES.customer(customer.id)} />
              <button type="submit" className="btn-ghost btn-sm">
                Mark {invoices.filter(isSettled).length} fully settled invoice(s) as completed
              </button>
            </form>
          )}
          {completed.length > 0 && (
            <Link href={`${ROUTES.completed}?${new URLSearchParams({ customer: customer.name ?? "" }).toString()}`} className="link">
              {completed.length} completed invoice(s), out of this list →
            </Link>
          )}
        </div>
      )}

      <OnAccountPanel
        customerId={customer.id}
        currency={currency}
        entries={onAccount}
        invoices={invoices}
        message={message}
        returnTo={`${ROUTES.customer(customer.id)}#on-account`}
        history={history.entries}
      />

      {/* Edit / add extra information: an uploaded sheet rarely carries
          everything, so every invoice is listed with what it is missing and
          opens in the full record form (BL date, PO number, shipping bill,
          documents presented, rate …), which saves only what changed, on the
          same invoice. */}
      {invoices.length > 0 && (
        <section className="card mb-5 scroll-mt-4" id="missing">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="card-title mb-0">Edit / add extra information</h2>
            <span className="text-[11px] text-[var(--color-ink-3)]">
              {incomplete.length
                ? `${incomplete.length} of ${invoices.length} invoice(s) are missing something`
                : `all ${invoices.length} invoice(s) are complete`}
            </span>
          </div>
          <div className="tablewrap">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Invoice date</th>
                  <th className="px-3 py-2">BL date</th>
                  <th className="px-3 py-2">PO no.</th>
                  <th className="px-3 py-2">Container</th>
                  <th className="px-3 py-2">Payment terms</th>
                  <th className="px-3 py-2">Missing</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => {
                  const gap = (
                    <span className="rounded bg-[var(--color-warn-bg)] px-1.5 text-[11px] font-semibold text-[var(--color-warn-fg)]">
                      missing
                    </span>
                  );
                  return (
                    <tr
                      key={i.id}
                      className={`border-t border-[var(--color-line)] ${i.missingFields.length ? "" : "text-[var(--color-ink-3)]"}`}
                    >
                      <td className="px-3 py-2 font-medium">
                        <Link href={ROUTES.invoice(i.id)} className="link">
                          {i.invoiceNo ?? "(no number)"}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{i.invoiceDate ? day(i.invoiceDate) : gap}</td>
                      <td className="whitespace-nowrap px-3 py-2">{i.blDate ? day(i.blDate) : gap}</td>
                      <td className="whitespace-nowrap px-3 py-2">{i.poNo ?? gap}</td>
                      <td className="whitespace-nowrap px-3 py-2">{i.containerNo ?? gap}</td>
                      <td className="px-3 py-2">{i.paymentTerms ?? gap}</td>
                      <td className="px-3 py-2 text-[11px] text-[var(--color-warn-fg)]">
                        {i.missingFields.length ? (
                          i.missingFields.map((f) => f.split(" — ")[0]).join(", ")
                        ) : (
                          <span className="text-[var(--color-ok-fg)]">complete</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Link href={ROUTES.editInvoice(i.id)} className="btn-ghost btn-sm" title="Edit or add extra information">
                          ✎ Edit / add extra information
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {invoices.length === 0 ? (
        <section className="card mb-5">
          <h2 className="card-title">Invoices</h2>
          <Empty>
            No invoices yet.{" "}
            <Link href={`${ROUTES.newRecord}?customerId=${customer.id}`} className="link">
              Add one
            </Link>
            .
          </Empty>
        </section>
      ) : (
        <CustomerRegister
          customerId={customer.id}
          customerName={customer.name ?? "this customer"}
          invoices={invoices}
        />
      )}

      {(terms.size > 0 || withoutTerms > 0) && (
        <section className="card mb-5">
          <h2 className="card-title">Payment terms in use</h2>
          {terms.size > 0 && (
            <ul className="space-y-1 text-[12px]">
              {[...terms.entries()]
                .sort((a, b) => b[1].count - a[1].count)
                .map(([raw, t]) => (
                  <li key={raw} className={t.unknown ? "text-[var(--color-bad-fg)]" : ""}>
                    <strong>&ldquo;{raw}&rdquo;</strong> on {t.count} invoice(s) → {t.understood}
                  </li>
                ))}
            </ul>
          )}
          {(withoutTerms > 0 || withoutDue > 0) && (
            <p className="mt-2 text-[11px] text-[var(--color-warn-fg)]">
              {withoutTerms > 0 && `${withoutTerms} invoice(s) carry no payment terms. `}
              {withoutDue > 0 && `${withoutDue} have no due date. `}
              A default term below applies to those without one.
            </p>
          )}
        </section>
      )}

      <section className="card mb-5">
        <h2 className="card-title">Customer record</h2>
        <form action={saveCustomerAction} className="flex flex-wrap gap-3">
          <input type="hidden" name="customerId" value={customer.id} />
          <Field name="name" label="Name" value={customer.name} width="min-w-[220px] flex-1" />
          <Field
            name="country"
            label="Country"
            value={customer.country}
            options={countryOptions(customer.country)}
            width="w-48"
          />
          <Field
            name="currency"
            label="Currency"
            value={customer.currency}
            options={currencyOptions(customer.currency).map((c) => [c, currencyLabel(c)] as const)}
            blankLabel={erp?.currency ? `— ERP default: ${erp.currency} —` : "— not set —"}
            width="w-56"
            hint={
              erp?.currency
                ? customer.currency && customer.currency !== erp.currency
                  ? `Set here; the ERP client list says ${erp.currency}. This module only.`
                  : `ERP client list: ${erp.currency}. Pick one to confirm or correct it here only.`
                : "Used where an invoice does not state one."
            }
          />
          <Field
            name="defaultPaymentTerms"
            label="Default payment terms"
            value={customer.defaultPaymentTerms}
            width="min-w-[240px] flex-1"
            list="pt-terms"
            hint="Used where an invoice does not state its own."
          />
          <Field name="consignee" label="Consignee" value={customer.consignee} width="min-w-[200px] flex-1" />
          <Field name="notifyParty" label="Notify party" value={customer.notifyParty} width="min-w-[200px] flex-1" />
          <Field name="contact" label="Contact" value={customer.contact} width="min-w-[200px] flex-1" />
          <Field name="notes" label="Notes" value={customer.notes} width="min-w-[280px] flex-[2]" />
          <div className="pt-5">
            <button type="submit" className="btn">
              Save
            </button>
          </div>
        </form>
        <datalist id="pt-terms">
          {SUPPORTED_TERMS.map((t) => (
            <option key={t.example} value={t.example} />
          ))}
        </datalist>
        <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">As at {today}.</p>
      </section>

      <HistoryPanel history={history} title="Changes to this customer record" />

      <section className="card mt-5">
        <h2 className="card-title">Delete this customer</h2>
        <form action={deleteCustomerAction}>
          <input type="hidden" name="customerId" value={customer.id} />
          <button type="submit" className="btn-danger">
            Delete customer
          </button>
          <span className="ml-2 text-[11px] text-[var(--color-ink-3)]">
            {invoices.length > 0
              ? `Their ${invoices.length} invoice(s) are kept and become "No customer recorded" — deleting a name never deletes the money.`
              : "They have no invoices."}
          </span>
        </form>
      </section>
    </>
  );
}
