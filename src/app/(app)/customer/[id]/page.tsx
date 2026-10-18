/**
 * One customer, in full.
 *
 * Their invoices, what has been received, what is outstanding, the payment
 * terms in use, the shipping references, and their own editable record. The
 * per-currency figures are separate, because a customer invoiced in two
 * currencies has two positions and not one.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { Facts, Field, homeMoney, money } from "@/components/tracking/bits";
import { CustomerRegister } from "@/components/tracking/CustomerRegister";
import { HistoryPanel } from "@/components/tracking/History";
import { Empty, PageHead } from "@/components/ui";
import { SUPPORTED_TERMS } from "@/lib/payments/terms";
import { deleteCustomerAction, saveCustomerAction } from "@/server/payments/actions";
import { customerHistory } from "@/server/payments/audit";
import { loadCustomer } from "@/server/payments/query";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { customer, invoices, kpis, today } = await loadCustomer(id);
  if (!customer) notFound();

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
  const withoutTerms = invoices.filter((i) => !i.paymentTerms).length;
  const withoutDue = invoices.filter((i) => !i.schedule.dueDate).length;

  return (
    <>
      <PageHead
        title={customer.name ?? "Customer (unnamed)"}
        lead={[customer.country, customer.currency, customer.defaultPaymentTerms]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
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
                ]}
              />
            </section>
          ))}
        </div>
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
          <Field name="country" label="Country" value={customer.country} width="w-40" />
          <Field
            name="currency"
            label="Currency"
            value={customer.currency}
            width="w-28"
            hint="Used where an invoice does not state one."
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
