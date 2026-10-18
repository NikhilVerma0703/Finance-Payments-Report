/**
 * EDIT OR ADD EXTRA INFORMATIONS.
 *
 * The same form as New Record, prefilled with everything the record holds —
 * from an uploaded sheet or typed by hand — so the fields a sheet did not carry
 * (BL date, PO, container, exchange rate, …) can be filled in, and any value
 * can be corrected. The record keeps its source, its upload and its receipts;
 * every change goes into its correction history.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordForm } from "@/components/tracking/RecordForm";
import { PageHead } from "@/components/ui";
import { day } from "@/components/tracking/bits";
import { prisma } from "@/lib/db";
import { INVOICE_FIELDS } from "@/lib/payments/form";
import { ROUTES } from "@/lib/routes";
import { asInput, loadFormContext } from "@/server/payments/formContext";

export const dynamic = "force-dynamic";

export default async function EditRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invoice, ctx] = await Promise.all([
    prisma.ptInvoice.findUnique({
      where: { id },
      include: {
        customer: true,
        receipts: { orderBy: [{ seq: "asc" }, { createdAt: "asc" }] },
        notes: { orderBy: { createdAt: "asc" } },
      },
    }),
    loadFormContext(),
  ]);
  if (!invoice) notFound();

  const record = invoice as unknown as Record<string, unknown>;
  const initial = Object.fromEntries(INVOICE_FIELDS.map((f) => [f, asInput(record[f])]));
  const blanks = INVOICE_FIELDS.filter((f) => initial[f] === "").length;

  return (
    <>
      <PageHead
        title="EDIT OR ADD EXTRA INFORMATIONS"
        lead={`Invoice ${invoice.invoiceNo ?? "(no number)"}${
          invoice.customer?.name ? ` · ${invoice.customer.name}` : ""
        } — ${INVOICE_FIELDS.length - blanks} of ${INVOICE_FIELDS.length} invoice fields filled. Edit any value or fill in the rest; nothing is required.`}
        actions={
          <Link href={ROUTES.invoice(invoice.id)} className="btn-ghost">
            Back to invoice
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2 text-[12px]">
        <span
          className={`chip ${
            invoice.source === "EXCEL"
              ? "bg-[var(--color-info-bg)] text-[var(--color-info-fg)]"
              : "bg-[var(--color-mute-bg)] text-[var(--color-mute-fg)]"
          }`}
        >
          {invoice.source === "EXCEL"
            ? `Imported from ${invoice.sourceFile ?? "a sheet"}${
                invoice.sourceAsOn ? ` (as on ${day(invoice.sourceAsOn.toISOString().slice(0, 10))})` : ""
              }`
            : "Entered by hand"}
        </span>
        <span className="chip bg-[var(--color-mute-bg)] text-[var(--color-mute-fg)]">
          {invoice.receipts.length} receipt(s) · {invoice.notes.length} credit/debit note(s)
        </span>
      </div>

      <RecordForm
        invoiceId={invoice.id}
        initial={initial}
        customerId={invoice.customerId}
        customers={ctx.customers}
        receipts={invoice.receipts.map((r) => ({
          id: r.id,
          seq: r.seq,
          values: {
            receiptDate: asInput(r.receiptDate),
            amountFcy: asInput(r.amountFcy),
            exchangeRate: asInput(r.exchangeRate),
            bankRef: asInput(r.bankRef),
            remarks: asInput(r.remarks),
          },
        }))}
        notes={invoice.notes.map((n) => ({
          id: n.id,
          seq: null,
          values: {
            noteType: n.noteType,
            noteNo: asInput(n.noteNo),
            noteDate: asInput(n.noteDate),
            amount: asInput(n.amount),
            reason: asInput(n.reason),
          },
        }))}
        termOptions={ctx.termOptions}
        rules={ctx.rules}
        params={ctx.params}
        today={ctx.today}
        submitLabel="Save changes"
        cancelHref={ROUTES.invoice(invoice.id)}
      />
    </>
  );
}
