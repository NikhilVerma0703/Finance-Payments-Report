"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { Banner } from "@/components/ui";
import { uploadSheetAction, type UploadState } from "@/server/payments/uploadAction";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn" disabled={pending}>
      {pending ? "Reading…" : "Read the sheet"}
    </button>
  );
}

/**
 * The upload form, and the report that comes back.
 *
 * The report is the point as much as the upload: it shows **which sheet column
 * became which field**, which headings matched nothing, what each payment-term
 * wording was understood to mean, and what changed. A silent importer is one
 * nobody can trust with their own data.
 */
export function UploadForm() {
  const [state, action] = useActionState<UploadState | null, FormData>(uploadSheetAction, null);
  const router = useRouter();
  // read the new records back, so the uploads below include this one
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <>
      <form action={action} className="card mb-5">
        <div className="rounded-xl border-2 border-dashed border-[#c3d1e0] bg-[#fbfdff] p-8 text-center">
          <div className="text-[15px] font-semibold">Choose a customer payment sheet or an outstanding statement</div>
          <div className="mt-1 text-xs text-[var(--color-ink-3)]">
            Excel (.xlsx, .xls or .xlsm) · one customer&apos;s sheet, or the export outstanding statement with every customer and
            each receipt side by side
          </div>
          <input type="file" name="file" accept=".xlsx,.xls,.xlsm" className="mt-4 text-sm" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-5">
          <SubmitButton />
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="dryRun" />
            Preview without saving
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="replace" />
            Allow re-upload of the same file
          </label>
        </div>

      </form>

      {state && (
        <section className="card mb-5">
          <Banner tone={state.ok ? "ok" : "bad"}>{state.message}</Banner>
          {state.ok && state.importId && (
            <p className="mb-2 text-[12px]">
              <a href={`#upload-${state.importId}`} className="link">
                Go to the invoices from this sheet
              </a>{" "}
              — complete them with <strong>EDIT OR ADD EXTRA INFORMATIONS</strong>.
            </p>
          )}

          {state.mapping.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1 text-[13px] font-semibold">Columns detected</h3>
              <div className="flex flex-wrap gap-1.5">
                {state.mapping.map(([field, column]) => (
                  <span
                    key={field}
                    className="chip bg-[var(--color-info-bg)] text-[var(--color-info-fg)]"
                  >
                    {column} → {label(field)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {state.unmapped.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1 text-[13px] font-semibold">Columns not recognised</h3>
              <ul className="space-y-0.5 text-[12px] text-[var(--color-warn-fg)]">
                {state.unmapped.map((u) => (
                  <li key={u.column}>
                    {u.column} — &ldquo;{u.heading}&rdquo;. Not imported.
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.terms.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1 text-[13px] font-semibold">Payment terms read</h3>
              <ul className="space-y-0.5 text-[12px]">
                {state.terms.map((t) => (
                  <li key={t.raw} className={t.unknown ? "text-[var(--color-bad-fg)]" : ""}>
                    &ldquo;{t.raw}&rdquo; ×{t.count} → {t.understood}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.detail.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1 text-[13px] font-semibold">What happened</h3>
              <ul className="space-y-0.5 text-[12px] text-[var(--color-ink-2)]">
                {state.detail.map((d, i) => (
                  <li key={i} className={d.startsWith("  ") ? "pl-4" : ""}>
                    {d.trim()}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.warnings.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1 text-[13px] font-semibold">Worth knowing</h3>
              <ul className="list-disc space-y-1 pl-5 text-[12px] text-[var(--color-warn-fg)]">
                {state.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </>
  );
}

const LABELS: Record<string, string> = {
  slNo: "Serial no.",
  invoiceNo: "Invoice number",
  invoiceDate: "Invoice date",
  customerInvoiceValue: "Invoice value",
  customsInvoiceValue: "Customs / books value",
  exchangeRate: "Exchange rate",
  receiptExchangeRate: "Receipt exchange rate",
  received: "Received",
  receiptDate: "Receipt date",
  statedBalance: "Balance",
  creditNote: "Credit note",
  debitNote: "Debit note",
  paymentTerms: "Payment terms",
  containerNo: "Container no.",
  statedDueDate: "ETA / due date",
  statedOverdueDays: "Overdue days",
  poNo: "PO number",
  piNo: "PI number",
  shippingBillNo: "Shipping bill no.",
  shippingBillDate: "Shipping bill date",
  blNo: "BL number",
  blDate: "BL date",
  consignee: "Consignee",
  notifyParty: "Notify party",
  country: "Country",
  currency: "Currency",
  remarks: "Remarks",
};

function label(field: string): string {
  return LABELS[field] ?? field;
}
