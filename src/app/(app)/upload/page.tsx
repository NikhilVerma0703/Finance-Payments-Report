/**
 * Upload Sheet.
 *
 * Read a customer payment sheet, then work on what it brought in: complete or
 * correct any invoice with EDIT OR ADD EXTRA INFORMATIONS, delete a single
 * invoice, or delete a whole upload together with the invoices that belong to
 * it alone.
 */
import Link from "next/link";

import { ConfirmDelete } from "@/components/tracking/ConfirmDelete";
import { EditPicker } from "@/components/tracking/EditPicker";
import { UploadForm } from "@/components/tracking/UploadForm";
import { day, money, StatusChip } from "@/components/tracking/bits";
import { Empty, PageHead } from "@/components/ui";
import { INVOICE_FIELDS } from "@/lib/payments/form";
import type { TrackedInvoice } from "@/lib/payments/record";
import { ROUTES } from "@/lib/routes";
import { deleteInvoiceAction } from "@/server/payments/actions";
import { deleteUploadAction } from "@/server/payments/uploadAction";
import { loadUploads } from "@/server/payments/uploads";

export const dynamic = "force-dynamic";

/** How many of the invoice's own fields hold something. */
function filled(i: TrackedInvoice): number {
  const r = i as unknown as Record<string, unknown>;
  return INVOICE_FIELDS.filter((f) => r[f] !== null && r[f] !== undefined && r[f] !== "").length;
}

export default async function UploadPage() {
  const { uploads, imported } = await loadUploads();

  const byCustomer = new Map<string, Array<{ id: string; label: string }>>();
  for (const i of imported) {
    const k = i.customerName ?? "No customer recorded";
    const list = byCustomer.get(k) ?? [];
    list.push({
      id: i.id,
      label: `${i.invoiceNo ?? "(no number)"} · ${day(i.invoiceDate)} · ${money(i.customerInvoiceValue, i.currency)} · ${filled(i)}/${INVOICE_FIELDS.length} fields`,
    });
    byCustomer.set(k, list);
  }
  const pickerGroups = [...byCustomer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([customer, invoices]) => ({ customer, invoices }));

  return (
    <>
      <PageHead
        title="Upload Sheet"
        lead="Upload a customer payment sheet, or the export outstanding statement with many customers, invoices and receipts. Columns are detected from their headings; nothing missing is invented."
        actions={
          <Link href={ROUTES.newRecord} className="btn-ghost">
            Enter by hand instead
          </Link>
        }
      />

      <UploadForm />

      {imported.length > 0 && (
        <section className="card mb-5">
          <h2 className="card-title">Edit or add extra informations</h2>
          <p className="mb-3 text-[12px] text-[var(--color-ink-2)]">
            Open any imported invoice in the full form to fill in what the sheet did not carry —
            BL date, PO number, container, exchange rate, receipts, credit/debit notes — or correct
            any value it did.
          </p>
          <EditPicker groups={pickerGroups} />
        </section>
      )}

      <section className="card">
        <h2 className="card-title">Previous uploads</h2>
        {uploads.length === 0 ? (
          <Empty>Nothing uploaded yet.</Empty>
        ) : (
          <div className="space-y-3">
            {uploads.map((u, index) => {
              const exclusive = u.membership.exclusive.length;
              const shared = u.membership.shared.length;
              const editedHere = u.edited.filter((id) => u.membership.exclusive.includes(id)).length;
              return (
                <details
                  key={u.id}
                  id={`upload-${u.id}`}
                  open={index === 0}
                  className="scroll-mt-4 rounded-lg border border-[var(--color-line)]"
                >
                  <summary className="cursor-pointer px-4 py-3 text-[13px]">
                    <strong>{u.customerName ?? "No customer named"}</strong>{" "}
                    <span className="text-[var(--color-ink-3)]">
                      — {u.fileName} · as on {u.asOn ? day(u.asOn) : "not stated"} · {u.rowsRead} row(s)
                      · {u.created} added, {u.updated} updated
                      {u.skipped ? `, ${u.skipped} skipped` : ""} · uploaded {day(u.createdAt)}
                    </span>
                  </summary>

                  <div className="space-y-4 border-t border-[var(--color-line)] px-4 py-3 text-[12px]">
                    {u.report.totals && (
                      <p className="tabular-nums">
                        Sheet totals: invoiced {money(u.report.totals.value, u.currency)} · received{" "}
                        {money(u.report.totals.received, u.currency)} · outstanding{" "}
                        {money(u.report.totals.balance, u.currency)}
                        {u.report.statedTotals?.value != null &&
                          Math.abs(u.report.statedTotals.value - u.report.totals.value) > 0.01 && (
                            <span className="text-[var(--color-bad-fg)]">
                              {" "}
                              — the sheet printed {money(u.report.statedTotals.value, u.currency)}
                            </span>
                          )}
                      </p>
                    )}

                    {u.invoices.length > 0 ? (
                      <div className="tablewrap">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
                              <th className="px-3 py-2">Invoice No.</th>
                              <th className="px-3 py-2">Invoice date</th>
                              <th className="px-3 py-2 text-right">Value</th>
                              <th className="px-3 py-2 text-right">Received</th>
                              <th className="px-3 py-2 text-right">Outstanding</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2" title="Invoice fields that hold a value">
                                Fields filled
                              </th>
                              <th className="px-3 py-2">Note</th>
                              <th className="px-3 py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {u.invoices.map((i) => {
                              const f = filled(i);
                              const mine = u.membership.exclusive.includes(i.id);
                              return (
                                <tr key={i.id} className="border-t border-[var(--color-line)] align-middle">
                                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                                    <Link href={ROUTES.invoice(i.id)} className="link">
                                      {i.invoiceNo ?? "(no number)"}
                                    </Link>
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2">{day(i.invoiceDate)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {money(i.customerInvoiceValue, i.currency)}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {money(i.money.totalReceived, i.currency)}
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                                    {money(i.money.calculatedOutstanding, i.currency)}
                                  </td>
                                  <td className="px-3 py-2">
                                    <StatusChip status={i.status} note={i.statusNote} />
                                  </td>
                                  <td
                                    className={`whitespace-nowrap px-3 py-2 tabular-nums ${
                                      f < INVOICE_FIELDS.length / 2 ? "text-[var(--color-warn-fg)]" : ""
                                    }`}
                                  >
                                    {f} of {INVOICE_FIELDS.length}
                                  </td>
                                  <td className="px-3 py-2 text-[11px] text-[var(--color-ink-3)]">
                                    {!mine
                                      ? u.membership.created.includes(i.id)
                                        ? "also in another upload"
                                        : "updated by this upload"
                                      : u.edited.includes(i.id)
                                        ? "edited by hand"
                                        : ""}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-right">
                                    <div className="flex items-center justify-end gap-3">
                                      <Link
                                        href={ROUTES.editInvoice(i.id)}
                                        className="btn-ghost btn-sm whitespace-nowrap"
                                      >
                                        EDIT OR ADD EXTRA INFORMATIONS
                                      </Link>
                                      <ConfirmDelete
                                        small
                                        action={deleteInvoiceAction}
                                        fields={{ invoiceId: i.id, returnTo: `${ROUTES.upload}#upload-${u.id}` }}
                                        label="Delete"
                                        question={`Delete invoice ${i.invoiceNo ?? "(no number)"} with its ${i.money.receiptCount} receipt(s)? It disappears from every screen and report. This cannot be undone.`}
                                      />
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-[var(--color-ink-3)]">
                        None of this upload&apos;s invoices are in the records any more.
                      </p>
                    )}

                    <UploadDetails u={u} />

                    <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-line)] pt-3">
                      <ConfirmDelete
                        action={deleteUploadAction}
                        fields={{ importId: u.id }}
                        label="Delete this upload"
                        question={
                          <>
                            Delete this upload and the <strong>{exclusive}</strong> invoice(s) that
                            belong to it alone
                            {editedHere ? ` (${editedHere} of them edited by hand)` : ""}, with their
                            receipts and notes?
                            {shared ? ` ${shared} invoice(s) also in another upload will be kept.` : ""}{" "}
                            This cannot be undone.
                          </>
                        }
                      />
                      <span className="text-[11px] text-[var(--color-ink-3)]">
                        {exclusive} invoice(s) belong to this upload alone
                        {shared ? ` · ${shared} also in another upload (kept)` : ""}
                      </span>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function UploadDetails({ u }: { u: Awaited<ReturnType<typeof loadUploads>>["uploads"][number] }) {
  const r = u.report;
  const any =
    (r.mapping && Object.keys(r.mapping).length) ||
    r.duplicates?.length ||
    r.comparison?.length ||
    r.terms?.length ||
    r.skipped?.length ||
    u.warnings.length;
  if (!any) return null;

  return (
    <details className="rounded-lg bg-[#fbfcfe] px-3 py-2">
      <summary className="cursor-pointer font-semibold text-[var(--color-ink-2)]">
        What the sheet contained
      </summary>
      <div className="mt-2 space-y-3">
        {r.mapping && Object.keys(r.mapping).length > 0 && (
          <p className="text-[var(--color-ink-3)]">
            Columns:{" "}
            {Object.entries(r.mapping)
              .map(([f, c]) => `${c}→${f}`)
              .join(", ")}
          </p>
        )}
        {r.terms && r.terms.length > 0 && (
          <div>
            <h3 className="font-semibold">Payment terms read</h3>
            <ul className="mt-1 space-y-0.5 text-[var(--color-ink-2)]">
              {r.terms.map((t) => (
                <li key={t.raw}>
                  &ldquo;{t.raw}&rdquo; ×{t.count} → {t.understood}
                </li>
              ))}
            </ul>
          </div>
        )}
        {r.duplicates && r.duplicates.length > 0 && (
          <div>
            <h3 className="font-semibold">Duplicate invoice numbers in the sheet</h3>
            <ul className="mt-1 space-y-0.5">
              {r.duplicates.map((d, i) => (
                <li key={i}>
                  {d.invoiceNo} — {d.where}
                </li>
              ))}
            </ul>
          </div>
        )}
        {r.comparison && r.comparison.length > 0 && (
          <div>
            <h3 className="font-semibold">Where the customer&apos;s own block differs from ours</h3>
            <ul className="mt-1 space-y-0.5 text-[var(--color-ink-2)]">
              {r.comparison.map((c, i) => (
                <li key={i}>
                  <strong>{c.invoiceNo}</strong> {c.what}: ours {c.ours ?? "—"}, theirs {c.theirs ?? "—"}
                </li>
              ))}
            </ul>
          </div>
        )}
        {r.skipped && r.skipped.length > 0 && (
          <div>
            <h3 className="font-semibold">Skipped</h3>
            <ul className="mt-1 space-y-0.5">
              {r.skipped.map((s, i) => (
                <li key={i}>
                  <strong>{s.invoiceNo}</strong> — {s.why}
                </li>
              ))}
            </ul>
          </div>
        )}
        {u.warnings.length > 0 && (
          <div>
            <h3 className="font-semibold">Worth knowing</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--color-warn-fg)]">
              {u.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
