"use client";

/**
 * One customer's payment register.
 *
 * A row per invoice carrying its totals — value and, beside it, what is
 * still outstanding (owner, 30 Oct 2026), then received, CN, DN, due date and
 * status. Clicking a row opens it: the invoice's
 * editable fields, and its receipts listed one under another with the derived
 * difference and forex gain/loss beside each. An invoice shows exactly the
 * receipts it has — three for one, four for the next — and "Add receipt"
 * opens as many new ones as are needed before saving. There is no limit.
 *
 * Every row's fields stay on the form while it is closed, so closing a row
 * does not lose what was typed in it. The save applies only what differs from
 * the stored record, and a failed save keeps everything that was entered.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, startTransition, useActionState, useEffect, useState } from "react";

import { formatMoney, formatRate, toHome } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import type { ReceiptMaths } from "@/lib/payments/money";
import type { TrackedInvoice } from "@/lib/payments/record";
import {
  saveCustomerRegisterAction,
  type RegisterSaveState,
} from "@/server/payments/registerActions";
import { Banner } from "@/components/ui";
import { day, StatusChip } from "./bits";

/** Number of columns in the summary row — the open invoice spans all of them. */
const COLS = 15;

const LABEL = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]";
const HEADING = "text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-2)]";
const LINK = "font-semibold text-[var(--color-brand-2)] hover:underline";

/** A derived figure: never an input, so it cannot disagree with its sources. */
function Calc({
  children,
  tone = "",
  title,
}: {
  children: React.ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${tone}`} title={title}>
      {children}
    </td>
  );
}

/** An input inside a receipt line. */
function Cell({
  name,
  value,
  kind = "text",
  width,
  label,
}: {
  name: string;
  value?: string | number | null;
  kind?: "text" | "date" | "number";
  width: string;
  label: string;
}) {
  return (
    <td className="px-2 py-1.5">
      <input
        name={name}
        type={kind === "date" ? "date" : "text"}
        inputMode={kind === "number" ? "decimal" : undefined}
        defaultValue={value ?? ""}
        aria-label={label}
        className={`input px-2 py-1 text-[12px] ${width} ${kind === "number" ? "text-right tabular-nums" : ""}`}
      />
    </td>
  );
}

/** A labelled input in an open invoice's details. */
function Field({
  label,
  name,
  value,
  kind = "text",
  wide = false,
}: {
  label: string;
  name: string;
  value?: string | number | null;
  kind?: "text" | "date" | "number";
  wide?: boolean;
}) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className={LABEL}>{label}</span>
      <input
        name={name}
        type={kind === "date" ? "date" : "text"}
        inputMode={kind === "number" ? "decimal" : undefined}
        defaultValue={value ?? ""}
        className={`input px-2.5 py-1.5 text-[12px] ${kind === "number" ? "text-right tabular-nums" : ""}`}
      />
    </label>
  );
}

function tone(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-[var(--color-ink-3)]";
  return n < 0 ? "text-[var(--color-bad-fg)]" : "text-[var(--color-ok-fg)]";
}

/**
 * What is stored for one invoice, as a short fingerprint. The open invoice's
 * inputs are keyed by it, so once a save has been read back they start again
 * from the saved values — and only the invoices that actually changed do.
 */
function stored(i: TrackedInvoice): string {
  const text = JSON.stringify([
    i.invoiceNo, i.invoiceDate, i.paymentTerms, i.customerInvoiceValue, i.exchangeRate, i.blNo,
    i.blDate, i.enteredDueDate, i.booksBalance, i.remarks,
    i.money.receipts.map((r) => [r.seq, r.receiptDate, r.amountFcy, r.exchangeRate, r.bankRef]),
    i.notes.map((n) => [n.noteType, n.amount]),
  ]);
  let h = 0;
  for (let k = 0; k < text.length; k += 1) h = (h * 31 + text.charCodeAt(k)) | 0;
  return (h >>> 0).toString(36);
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function CustomerRegister({
  customerId,
  customerName,
  invoices,
}: {
  customerId: string;
  customerName: string;
  invoices: TrackedInvoice[];
}) {
  const [state, dispatch, saving] = useActionState<RegisterSaveState | null, FormData>(
    saveCustomerRegisterAction,
    null,
  );

  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // new, unsaved receipts per invoice, by the receipt number each will get
  const [adding, setAdding] = useState<Record<string, number[]>>({});
  // invoices with something typed since the last save
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  // bumped after a save or a discard, so every input starts again from the record
  const [version, setVersion] = useState(0);

  const router = useRouter();
  useEffect(() => {
    if (!state?.ok) return; // a failed save keeps everything that was typed
    setAdding({});
    setDirty(new Set());
    // read the saved records back; each open invoice re-renders from them
    // because its key follows what is stored (see `stored` below)
    router.refresh();
  }, [state, router]);

  function toggle(id: string) {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addReceipt(i: TrackedInvoice) {
    setAdding((a) => {
      const pending = a[i.id] ?? [];
      const last = Math.max(0, ...i.money.receipts.map((r) => r.seq), ...pending);
      return { ...a, [i.id]: [...pending, last + 1] };
    });
    setDirty((d) => new Set(d).add(i.id));
  }

  function dropReceipt(id: string, seq: number) {
    setAdding((a) => ({ ...a, [id]: (a[id] ?? []).filter((s) => s !== seq) }));
  }

  function discard() {
    setAdding({});
    setDirty(new Set());
    setVersion((v) => v + 1);
  }

  const totals = invoices.reduce(
    (t, i) => ({
      value: t.value + (i.customerInvoiceValue ?? 0),
      received: t.received + i.money.totalReceived,
      cn: t.cn + i.money.creditNotes,
      dn: t.dn + i.money.debitNotes,
      outstanding: t.outstanding + (i.money.calculatedOutstanding ?? 0),
      home: t.home + (toHome(i.customerInvoiceValue, i.exchangeRate) ?? 0),
      receipts: t.receipts + i.money.receipts.length,
    }),
    { value: 0, received: 0, cn: 0, dn: 0, outstanding: 0, home: 0, receipts: 0 },
  );

  const currencies = new Set(invoices.map((i) => i.currency ?? "—"));
  const one = currencies.size === 1 ? [...currencies][0] : null;
  const ratesKnown = invoices.filter((i) => i.exchangeRate != null).length;
  const amt = (n: number | null | undefined, cur: string | null, blank = "—") =>
    formatMoney(n, cur, { symbol: false, blank });
  const allOpen = invoices.length > 0 && open.size === invoices.length;

  return (
    <section className="card mb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="card-title mb-0">Payment register</h2>
        <div className="flex items-center gap-3 text-[11px] text-[var(--color-ink-3)]">
          <span>
            {invoices.length} invoice(s) · {totals.receipts} receipt(s)
          </span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setOpen(allOpen ? new Set() : new Set(invoices.map((i) => i.id)))}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      {state && <Banner tone={state.ok ? "ok" : "bad"}>{state.message}</Banner>}

      <form
        onSubmit={(e) => {
          // dispatched by hand rather than through the action prop, so a
          // failed save does not reset the form and lose what was typed
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => dispatch(data));
        }}
        onInput={(e) => {
          const id = (e.target as HTMLElement).closest<HTMLElement>("[data-invoice]")?.dataset
            .invoice;
          if (id && !dirty.has(id)) setDirty((d) => new Set(d).add(id));
        }}
      >
        <input type="hidden" name="customerId" value={customerId} />

        <div className="tablewrap">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2">Invoice No.</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Terms</th>
                <th className="px-3 py-2 text-right">Value{one ? ` (${one})` : ""}</th>
                <th className="px-3 py-2 text-right">Outstanding</th>
                <th className="px-3 py-2 text-right">Rate</th>
                <th className="px-3 py-2 text-right">Value (INR)</th>
                <th className="px-3 py-2 text-center">Receipts</th>
                <th className="px-3 py-2 text-right">Received</th>
                <th className="px-3 py-2 text-right">CN</th>
                <th className="px-3 py-2 text-right">DN</th>
                <th className="px-3 py-2 text-right">As per books</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>

            <tbody>
              {invoices.map((i) => {
                const m = i.money;
                const cur = i.currency;
                const cn = i.notes.filter((n) => n.noteType === "CREDIT");
                const dn = i.notes.filter((n) => n.noteType === "DEBIT");
                // "late" only while money is still owed — a paid invoice is not overdue
                const late = (i.overdueDays ?? 0) > 0 && (m.calculatedOutstanding ?? 0) > 0;
                const isOpen = open.has(i.id);
                const pending = adding[i.id] ?? [];
                const receipts = [...m.receipts].sort((a, b) => a.seq - b.seq);
                const pct =
                  m.collectedPct == null ? null : Math.max(0, Math.min(100, m.collectedPct));

                // one receipt line; `r` is absent for a receipt not saved yet
                const receiptLine = (seq: number, r?: ReceiptMaths) => (
                  <tr
                    key={seq}
                    className={`border-t border-[var(--color-line)] ${r ? "" : "bg-[#fffbea]"}`}
                  >
                    <td className="px-3 py-1.5 font-semibold text-[var(--color-ink-2)]">{seq}</td>
                    <Cell
                      name={`rcpt.${i.id}.${seq}.receiptDate`}
                      value={r?.receiptDate}
                      kind="date"
                      width="w-36"
                      label={`Receipt ${seq} date`}
                    />
                    <Cell
                      name={`rcpt.${i.id}.${seq}.amountFcy`}
                      value={r?.amountFcy}
                      kind="number"
                      width="w-32"
                      label={`Receipt ${seq} amount`}
                    />
                    <Cell
                      name={`rcpt.${i.id}.${seq}.exchangeRate`}
                      value={r?.exchangeRate}
                      kind="number"
                      width="w-24"
                      label={`Receipt ${seq} exchange rate`}
                    />
                    <Calc tone={tone(r?.rateDifference)} title={r?.note ?? undefined}>
                      {r ? formatRate(r.rateDifference, "—") : ""}
                    </Calc>
                    <Calc tone={tone(r?.forexGainLoss)} title={r?.note ?? undefined}>
                      {r ? formatMoney(r.forexGainLoss, "INR", { symbol: false, blank: "—" }) : ""}
                    </Calc>
                    <Cell
                      name={`rcpt.${i.id}.${seq}.bankRef`}
                      value={r?.bankRef}
                      width="w-40"
                      label={`Receipt ${seq} bank reference`}
                    />
                    <td className="px-3 py-1.5 text-right">
                      {!r && (
                        <button
                          type="button"
                          onClick={() => dropReceipt(i.id, seq)}
                          className="text-[11px] font-semibold text-[var(--color-bad-fg)] hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );

                return (
                  <Fragment key={i.id}>
                    <tr
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a,button")) return;
                        toggle(i.id);
                      }}
                      className={`cursor-pointer border-t border-[var(--color-line)] transition-colors hover:bg-[#f5f8fc] ${
                        isOpen ? "bg-[#f0f5fb]" : ""
                      }`}
                    >
                      <td className="px-2 py-2 text-[var(--color-ink-3)]">
                        <button
                          type="button"
                          onClick={() => toggle(i.id)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Close" : "Open"} invoice ${i.invoiceNo ?? ""}`}
                          className="flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--color-info-bg)]"
                        >
                          <Chevron open={isOpen} />
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold">
                        {i.invoiceNo ?? (
                          <span className="text-[var(--color-warn-fg)]">no number</span>
                        )}
                        {dirty.has(i.id) && (
                          <span
                            className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-warn-fg)] align-middle"
                            title="Unsaved changes"
                          />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{day(i.invoiceDate)}</td>
                      <td
                        className="max-w-[180px] truncate px-3 py-2"
                        title={i.paymentTerms ?? undefined}
                      >
                        {i.paymentTerms ?? "—"}
                      </td>
                      <Calc>{amt(i.customerInvoiceValue, cur)}</Calc>
                      <Calc tone={`font-semibold ${late ? "text-[var(--color-bad-fg)]" : ""}`}>
                        {amt(m.calculatedOutstanding, cur)}
                      </Calc>
                      <Calc tone="text-[var(--color-ink-2)]">
                        {formatRate(i.exchangeRate, "—")}
                      </Calc>
                      <Calc tone="text-[var(--color-ink-2)]">
                        {formatMoney(toHome(i.customerInvoiceValue, i.exchangeRate), "INR", {
                          symbol: false,
                        })}
                      </Calc>
                      <td className="px-3 py-2 text-center">
                        <span className="chip bg-[var(--color-mute-bg)] text-[var(--color-ink-2)]">
                          {m.receipts.length}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <div>{amt(m.totalReceived, cur)}</div>
                        {pct != null && (
                          <div
                            className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded-full bg-[var(--color-mute-bg)]"
                            title={`${m.collectedPct?.toFixed(1)}% collected`}
                          >
                            <div
                              className="h-full rounded-full bg-[var(--color-ok-fg)]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </td>
                      <Calc>{m.creditNotes ? amt(m.creditNotes, cur) : ""}</Calc>
                      <Calc>{m.debitNotes ? amt(m.debitNotes, cur) : ""}</Calc>
                      <Calc tone="text-[var(--color-ink-2)]">{amt(i.booksBalance, cur, "")}</Calc>
                      <td className="whitespace-nowrap px-3 py-2">
                        {i.schedule.dueDate ? (
                          <span className={late ? "font-semibold text-[var(--color-bad-fg)]" : ""}>
                            {day(i.schedule.dueDate)}
                            {late && ` · ${i.overdueDays}d late`}
                          </span>
                        ) : (
                          <span className="text-[var(--color-warn-fg)]">verify</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusChip status={i.status} note={i.statusNote} />
                      </td>
                    </tr>

                    {/* the open invoice — rendered while closed too, so typed
                        values survive closing the row */}
                    <tr key={`${i.id}:${version}:${stored(i)}`} hidden={!isOpen} data-invoice={i.id}>
                      <td
                        colSpan={COLS}
                        className="border-t border-[var(--color-line)] bg-[#f8fafc] p-0"
                      >
                        <div className="space-y-5 border-l-4 border-[var(--color-brand-2)] px-6 py-5">
                          <div>
                            <h3 className={`mb-2 ${HEADING}`}>Invoice details</h3>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
                              <Field
                                label="Invoice No."
                                name={`inv.${i.id}.invoiceNo`}
                                value={i.invoiceNo}
                              />
                              <Field
                                label="Invoice date"
                                name={`inv.${i.id}.invoiceDate`}
                                value={i.invoiceDate}
                                kind="date"
                              />
                              <Field
                                label="Payment terms"
                                name={`inv.${i.id}.paymentTerms`}
                                value={i.paymentTerms}
                                wide
                              />
                              <Field
                                label={`Value${cur ? ` (${cur})` : ""}`}
                                name={`inv.${i.id}.customerInvoiceValue`}
                                value={i.customerInvoiceValue}
                                kind="number"
                              />
                              <Field
                                label="Invoice rate (INR)"
                                name={`inv.${i.id}.exchangeRate`}
                                value={i.exchangeRate}
                                kind="number"
                              />
                              <Field label="BL No." name={`inv.${i.id}.blNo`} value={i.blNo} />
                              <Field
                                label="BL date"
                                name={`inv.${i.id}.blDate`}
                                value={i.blDate}
                                kind="date"
                              />
                              <Field
                                label="Due date (if known)"
                                name={`inv.${i.id}.enteredDueDate`}
                                value={i.enteredDueDate}
                                kind="date"
                              />
                              {cn.length > 1 ? (
                                <div>
                                  <span className={LABEL}>Credit notes ({cn.length})</span>
                                  <Link
                                    href={ROUTES.invoice(i.id)}
                                    className={`text-[12px] ${LINK}`}
                                  >
                                    {amt(m.creditNotes, cur)} · edit on invoice
                                  </Link>
                                </div>
                              ) : (
                                <label className="block">
                                  <span className={LABEL}>Credit note</span>
                                  <input
                                    name={`note.${i.id}.CREDIT.amount`}
                                    defaultValue={cn[0]?.amount ?? ""}
                                    inputMode="decimal"
                                    className="input px-2.5 py-1.5 text-right text-[12px] tabular-nums"
                                  />
                                </label>
                              )}
                              {dn.length > 1 ? (
                                <div>
                                  <span className={LABEL}>Debit notes ({dn.length})</span>
                                  <Link
                                    href={ROUTES.invoice(i.id)}
                                    className={`text-[12px] ${LINK}`}
                                  >
                                    {amt(m.debitNotes, cur)} · edit on invoice
                                  </Link>
                                </div>
                              ) : (
                                <label className="block">
                                  <span className={LABEL}>Debit note</span>
                                  <input
                                    name={`note.${i.id}.DEBIT.amount`}
                                    defaultValue={dn[0]?.amount ?? ""}
                                    inputMode="decimal"
                                    className="input px-2.5 py-1.5 text-right text-[12px] tabular-nums"
                                  />
                                </label>
                              )}
                              <Field
                                label="Balance as per books"
                                name={`inv.${i.id}.booksBalance`}
                                value={i.booksBalance}
                                kind="number"
                              />
                              <Field
                                label="Remarks"
                                name={`inv.${i.id}.remarks`}
                                value={i.remarks}
                                wide
                              />
                            </div>
                          </div>

                          <div>
                            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                              <h3 className={HEADING}>
                                Receipts ({receipts.length + pending.length})
                              </h3>
                              <span className="text-[11px] text-[var(--color-ink-3)]">
                                Received {amt(m.totalReceived, cur)} of{" "}
                                {amt(i.customerInvoiceValue, cur)} · Outstanding{" "}
                                <b className="text-[var(--color-ink)]">
                                  {amt(m.calculatedOutstanding, cur)}
                                </b>
                                {m.totalForexGainLoss != null && (
                                  <>
                                    {" "}
                                    · Forex G/L{" "}
                                    <b className={tone(m.totalForexGainLoss)}>
                                      {formatMoney(m.totalForexGainLoss, "INR")}
                                    </b>
                                  </>
                                )}
                              </span>
                            </div>

                            {receipts.length + pending.length > 0 ? (
                              <div className="max-w-full overflow-x-auto">
                                <table className="rounded-lg border border-[var(--color-line)] bg-white text-[12px]">
                                  <thead>
                                    <tr className="bg-[#f4f7fb] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
                                      <th className="w-10 px-3 py-1.5">#</th>
                                      <th className="px-2 py-1.5">Date</th>
                                      <th className="px-2 py-1.5 text-right">
                                        Amount{cur ? ` (${cur})` : ""}
                                      </th>
                                      <th className="px-2 py-1.5 text-right">Rate (INR)</th>
                                      <th
                                        className="px-3 py-1.5 text-right"
                                        title="Receipt rate − invoice rate"
                                      >
                                        Diff.
                                      </th>
                                      <th
                                        className="px-3 py-1.5 text-right"
                                        title="Difference × amount, in INR"
                                      >
                                        Forex G/L (INR)
                                      </th>
                                      <th className="px-2 py-1.5">Bank ref.</th>
                                      <th className="w-16 px-3 py-1.5" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {receipts.map((r) => receiptLine(r.seq, r))}
                                    {pending.map((seq) => receiptLine(seq))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-[12px] text-[var(--color-ink-3)]">
                                No receipts yet.
                              </p>
                            )}

                            <button
                              type="button"
                              onClick={() => addReceipt(i)}
                              className="btn-ghost btn-sm mt-2"
                            >
                              + Add receipt
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-4 border-t border-[var(--color-line)] pt-4">
                            <button type="submit" className="btn btn-sm" disabled={saving}>
                              {saving ? "Saving…" : "Save changes"}
                            </button>
                            <Link
                              href={ROUTES.invoice(i.id)}
                              className={`text-[12px] ${LINK}`}
                            >
                              Open full invoice →
                            </Link>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>

            <tfoot>
              <tr className="border-t-2 border-[var(--color-line)] bg-[#f2f6fb] font-semibold">
                <td className="px-3 py-2" colSpan={4}>
                  Total
                </td>
                <Calc>{one ? amt(totals.value, one) : "mixed"}</Calc>
                <Calc>{one ? amt(totals.outstanding, one) : "mixed"}</Calc>
                <td />
                <Calc title={`${ratesKnown} of ${invoices.length} invoice(s) carry a rate`}>
                  {ratesKnown ? formatMoney(totals.home, "INR", { symbol: false }) : "—"}
                </Calc>
                <td className="px-3 py-2 text-center">{totals.receipts}</td>
                <Calc>{one ? amt(totals.received, one) : "mixed"}</Calc>
                <Calc>{one && totals.cn ? amt(totals.cn, one) : ""}</Calc>
                <Calc>{one && totals.dn ? amt(totals.dn, one) : ""}</Calc>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>

        {dirty.size > 0 && (
          <div className="sticky bottom-3 z-10 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#efd9a1] bg-[var(--color-warn-bg)] px-4 py-2.5 shadow-sm">
            <span className="text-[12px] font-semibold text-[var(--color-warn-fg)]">
              Unsaved changes on {dirty.size} invoice(s)
            </span>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost btn-sm" onClick={discard} disabled={saving}>
                Discard
              </button>
              <button type="submit" className="btn btn-sm" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        )}
      </form>

      {!one && (
        <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
          Currencies differ, so amounts are not totalled · {customerName}
        </p>
      )}
    </section>
  );
}
