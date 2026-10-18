"use client";

/**
 * The full record form — New Record, and EDIT OR ADD EXTRA INFORMATIONS.
 *
 * One component for both, so an invoice typed by hand and an invoice brought in
 * from a sheet are completed with the same fields, the same sections and the
 * same calculations. The figures beside the boxes — due date, INR value, each
 * receipt's rate difference and forex, the balance and the status — are worked
 * out as you type by the very functions every other screen uses, so what the
 * form shows is what the record will show once saved.
 *
 * No field is required. Closing a section or adding rows never loses input,
 * and a save that is refused keeps everything that was typed.
 */
import Link from "next/link";
import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from "react";

import { formatMoney, formatRate, HOME_CURRENCY, toHome } from "@/lib/money";
import { INVOICE_FIELD_GROUPS, RECORD_CUSTOMER_FIELDS } from "@/lib/payments/form";
import {
  buildTrackedInvoice,
  type TrackedInvoice,
  type TrackedInvoiceInput,
  type TrackingParams,
} from "@/lib/payments/record";
import type { NoteInput, ReceiptInput } from "@/lib/payments/money";
import type { TermRule } from "@/lib/payments/terms";
import { toIsoDate, toNumber } from "@/lib/text";
import { saveRecordAction, type RecordSaveState } from "@/server/payments/recordActions";
import { day, StatusChip } from "./bits";

export interface CustomerOption {
  id: string;
  name: string | null;
  contact: string | null;
  currency: string | null;
  defaultPaymentTerms: string | null;
  notes: string | null;
  country: string | null;
  consignee: string | null;
  notifyParty: string | null;
}

export interface LineInit {
  id: string;
  seq: number | null;
  values: Record<string, string>;
}

export interface RecordFormProps {
  invoiceId?: string;
  /** Invoice fields as text — "" for blank, dates as YYYY-MM-DD. */
  initial: Record<string, string>;
  customerId: string | null;
  customers: CustomerOption[];
  receipts: LineInit[];
  notes: LineInit[];
  termOptions: string[];
  rules: TermRule[];
  params: TrackingParams;
  today: string;
  submitLabel: string;
  cancelHref: string;
}

interface Row {
  key: string;
  id: string | null;
  seq: number | null;
  init: Record<string, string>;
}

const BASIS_HINT: Record<string, string> = {
  blDate: "Most export terms count from the BL date.",
  docsPresentedDate: "Cash against documents (CAD) counts from this date.",
  enteredDueDate: "Overrides the calculated due date.",
  exchangeRate: "INR per one unit of the invoice currency, e.g. 83.25",
};

const WIDE = new Set(["paymentTerms", "remarks", "followUpNotes", "consignee", "notifyParty"]);

function Input({
  name,
  label,
  type,
  value,
  hint,
  list,
  wide,
}: {
  name: string;
  label: string;
  type: string;
  value?: string;
  hint?: string;
  list?: string;
  wide?: boolean;
}) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="field-label">{label}</span>
      <input
        name={name}
        type={type === "date" ? "date" : "text"}
        inputMode={type === "number" ? "decimal" : undefined}
        defaultValue={value ?? ""}
        list={list}
        autoComplete="off"
        className={`input ${type === "number" ? "text-right tabular-nums" : ""}`}
      />
      {hint && <span className="mt-0.5 block text-[10px] text-[var(--color-ink-3)]">{hint}</span>}
    </label>
  );
}

function Section({
  n,
  title,
  hint,
  children,
  aside,
}: {
  n: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="card-title mb-0 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--color-brand)] text-[10px] text-white">
            {n}
          </span>
          {title}
        </h2>
        {aside}
      </div>
      {hint && <p className="mb-3 text-[12px] text-[var(--color-ink-3)]">{hint}</p>}
      {children}
    </section>
  );
}

/** What the form currently says, as the calculations read an invoice. */
function readForm(
  form: HTMLFormElement,
  customers: CustomerOption[],
  receiptKeys: string[],
  noteKeys: string[],
  removed: Set<string>,
): TrackedInvoiceInput {
  const fd = new FormData(form);
  const s = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const n = (k: string) => {
    const v = s(k);
    return v === null ? null : toNumber(v);
  };
  const d = (k: string) => {
    const v = s(k);
    return v === null ? null : toIsoDate(v);
  };
  const picked = customers.find((c) => c.id === s("customerId"));

  const receipts: ReceiptInput[] = receiptKeys
    .filter((k) => !removed.has(k))
    .map((k, i) => ({
      id: k,
      seq: i + 1,
      receiptDate: d(`r.${k}.receiptDate`),
      amountFcy: n(`r.${k}.amountFcy`),
      exchangeRate: n(`r.${k}.exchangeRate`),
      bankRef: s(`r.${k}.bankRef`),
      remarks: s(`r.${k}.remarks`),
    }));
  const notes: NoteInput[] = noteKeys
    .filter((k) => !removed.has(k))
    .map((k) => ({
      id: k,
      noteType: s(`n.${k}.noteType`) === "DEBIT" ? "DEBIT" : "CREDIT",
      amount: n(`n.${k}.amount`),
      noteNo: s(`n.${k}.noteNo`),
      noteDate: d(`n.${k}.noteDate`),
      reason: s(`n.${k}.reason`),
    }));

  return {
    id: "preview",
    customerId: picked?.id ?? null,
    customerName: picked?.name ?? s("customerName"),
    invoiceNo: s("invoiceNo"),
    invoiceDate: d("invoiceDate"),
    customerInvoiceValue: n("customerInvoiceValue"),
    customsInvoiceValue: n("customsInvoiceValue"),
    exchangeRate: n("exchangeRate"),
    currency: (s("currency") ?? s("customer.currency") ?? picked?.currency ?? null)?.toUpperCase() ?? null,
    consignee: s("consignee") ?? picked?.consignee ?? null,
    notifyParty: s("notifyParty") ?? picked?.notifyParty ?? null,
    country: s("country") ?? picked?.country ?? null,
    paymentTerms: s("paymentTerms") ?? s("customer.defaultPaymentTerms") ?? picked?.defaultPaymentTerms ?? null,
    enteredDueDate: d("enteredDueDate"),
    piNo: s("piNo"),
    poNo: s("poNo"),
    shippingBillNo: s("shippingBillNo"),
    shippingBillDate: d("shippingBillDate"),
    blNo: s("blNo"),
    blDate: d("blDate"),
    containerNo: s("containerNo"),
    eta: d("eta"),
    docsPresentedDate: d("docsPresentedDate"),
    booksBalance: n("booksBalance"),
    remarks: s("remarks"),
    followUpNotes: s("followUpNotes"),
    source: "MANUAL",
    sourceFile: null,
    sourceAsOn: null,
    receipts,
    notes,
  };
}

export function RecordForm(props: RecordFormProps) {
  const { customers, rules, params, today } = props;
  const [state, dispatch, saving] = useActionState<RecordSaveState | null, FormData>(
    saveRecordAction,
    null,
  );

  const formRef = useRef<HTMLFormElement>(null);
  const counter = useRef(0);
  const nextKey = () => {
    counter.current += 1;
    return `new${counter.current}`;
  };

  const [pick, setPick] = useState(props.customerId ?? "");
  const [receipts, setReceipts] = useState<Row[]>(() => {
    const stored = props.receipts.map((r) => ({ key: r.id, id: r.id, seq: r.seq, init: r.values }));
    return stored.length ? stored : [{ key: "new0", id: null, seq: null, init: {} }];
  });
  const [notes, setNotes] = useState<Row[]>(() =>
    props.notes.map((r) => ({ key: r.id, id: r.id, seq: null, init: r.values })),
  );
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<TrackedInvoice | null>(null);

  const recompute = useCallback(() => {
    if (!formRef.current) return;
    const input = readForm(
      formRef.current,
      customers,
      receipts.map((r) => r.key),
      notes.map((r) => r.key),
      removed,
    );
    setPreview(buildTrackedInvoice(input, { today, params, rules }));
  }, [customers, receipts, notes, removed, today, params, rules]);

  // recalculated whenever rows are added, removed or a customer is chosen
  useEffect(() => {
    recompute();
  }, [recompute, pick]);

  const picked = customers.find((c) => c.id === pick) ?? null;
  const p = preview;
  const cur = p?.currency ?? null;
  const amt = (v: number | null | undefined) => formatMoney(v, cur, { blank: "—" });

  function toggleRemove(key: string) {
    setRemoved((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <form
      ref={formRef}
      className="space-y-4"
      onInput={recompute}
      onSubmit={(e) => {
        // dispatched by hand so a refused save does not reset the form
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => dispatch(data));
      }}
    >
      {props.invoiceId && <input type="hidden" name="invoiceId" value={props.invoiceId} />}

      {state && !state.ok && (
        <div className="banner border-[#f0c9c9] bg-[var(--color-bad-bg)] text-[var(--color-bad-fg)]">
          <strong>{state.message}</strong>
          {state.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-[12px]">
              {state.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 1 — Customer Details */}
      <Section
        n={1}
        title="Customer Details"
        hint="Pick an existing customer, or type a new name to create one. Contact, default currency, default terms and notes are saved on the customer."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="field-label">Existing customer</span>
            <select
              name="customerId"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="input"
            >
              <option value="">— none / new below —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? "(unnamed)"}
                </option>
              ))}
            </select>
          </label>
          <Input name="customerName" label="…or a new customer name" type="text" />
        </div>
        <div key={pick || "none"} className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {RECORD_CUSTOMER_FIELDS.map(([field, label, type]) => (
            <Input
              key={field}
              name={`customer.${field}`}
              label={label}
              type={type}
              value={(picked?.[field as keyof CustomerOption] as string | null) ?? ""}
              list={field === "defaultPaymentTerms" ? "rf-terms" : undefined}
            />
          ))}
        </div>
      </Section>

      {/* 2–6 and 9–10 — the invoice's own fields, from the shared groups */}
      {INVOICE_FIELD_GROUPS.map((group) => {
        const n = SECTION_NUMBER[group.key];
        return (
          <div key={group.key}>
            <Section
              n={n}
              title={group.title}
              hint={group.hint || undefined}
              aside={<GroupPreview group={group.key} p={p} amt={amt} />}
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {group.fields.map(([field, label, type]) => (
                  <Input
                    key={field}
                    name={field}
                    label={label}
                    type={type}
                    value={props.initial[field] ?? ""}
                    hint={BASIS_HINT[field]}
                    list={field === "paymentTerms" ? "rf-terms" : undefined}
                    wide={WIDE.has(field)}
                  />
                ))}
              </div>
              {group.key === "terms" && p && <TermsPreview p={p} />}
            </Section>

            {/* the receipts and the notes sit between the currency and the books */}
            {group.key === "currency" && (
              <div className="mt-4 space-y-4">
                <Section
                  n={7}
                  title="Receipts"
                  hint="Add as many receipts as the invoice has. Exchange rate difference and forex gain/loss are calculated."
                  aside={
                    p && (
                      <span className="text-[12px] text-[var(--color-ink-2)]">
                        Total received <strong className="tabular-nums">{amt(p.money.totalReceived)}</strong>
                      </span>
                    )
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] text-[12px]">
                      <thead>
                        <tr className="bg-[#f4f7fb] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
                          <th className="w-10 px-2 py-1.5">#</th>
                          <th className="px-2 py-1.5">Receipt date</th>
                          <th className="px-2 py-1.5 text-right">Amount (FCY)</th>
                          <th className="px-2 py-1.5 text-right">Receipt rate</th>
                          <th className="px-2 py-1.5 text-right" title="Receipt rate − invoice rate">
                            Rate difference
                          </th>
                          <th className="px-2 py-1.5 text-right" title="Difference × amount, in INR">
                            Forex gain/loss ({HOME_CURRENCY})
                          </th>
                          <th className="px-2 py-1.5">Bank reference</th>
                          <th className="px-2 py-1.5">Remarks</th>
                          <th className="w-20 px-2 py-1.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {receipts.map((row, index) => {
                          const gone = removed.has(row.key);
                          const m = p?.money.receipts.find((r) => r.id === row.key);
                          return (
                            <tr
                              key={row.key}
                              className={`border-t border-[var(--color-line)] ${
                                gone ? "opacity-40" : row.id ? "" : "bg-[#fffbea]"
                              }`}
                            >
                              <td className="px-2 py-1.5 font-semibold text-[var(--color-ink-2)]">
                                {row.seq ?? index + 1}
                              </td>
                              <LineCell name={`r.${row.key}.receiptDate`} type="date" value={row.init.receiptDate} width="w-36" label="Receipt date" />
                              <LineCell name={`r.${row.key}.amountFcy`} type="number" value={row.init.amountFcy} width="w-32" label="Amount" />
                              <LineCell name={`r.${row.key}.exchangeRate`} type="number" value={row.init.exchangeRate} width="w-24" label="Receipt rate" />
                              <td className={`px-2 py-1.5 text-right tabular-nums ${tone(m?.rateDifference)}`} title={m?.note ?? undefined}>
                                {gone || !m ? "" : formatRate(m.rateDifference, "—")}
                              </td>
                              <td className={`px-2 py-1.5 text-right tabular-nums ${tone(m?.forexGainLoss)}`} title={m?.note ?? undefined}>
                                {gone || !m ? "" : formatMoney(m.forexGainLoss, HOME_CURRENCY, { blank: "—" })}
                              </td>
                              <LineCell name={`r.${row.key}.bankRef`} type="text" value={row.init.bankRef} width="w-40" label="Bank reference" />
                              <LineCell name={`r.${row.key}.remarks`} type="text" value={row.init.remarks} width="w-48" label="Remarks" />
                              <td className="px-2 py-1.5 text-right">
                                {row.id ? (
                                  <>
                                    {gone && <input type="hidden" name={`r.${row.key}.delete`} value="1" />}
                                    <button
                                      type="button"
                                      onClick={() => toggleRemove(row.key)}
                                      className="text-[11px] font-semibold text-[var(--color-bad-fg)] hover:underline"
                                    >
                                      {gone ? "Keep" : "Delete"}
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setReceipts((rs) => rs.filter((r) => r.key !== row.key))}
                                    className="text-[11px] font-semibold text-[var(--color-bad-fg)] hover:underline"
                                  >
                                    Remove
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost btn-sm mt-3"
                    onClick={() => {
                      // the key is taken outside the updater, which may run twice
                      const key = nextKey();
                      setReceipts((rs) => [...rs, { key, id: null, seq: null, init: {} }]);
                    }}
                  >
                    + Add receipt
                  </button>
                </Section>

                <Section
                  n={8}
                  title="Credit Notes and Debit Notes"
                  hint="A credit note reduces what the customer owes; a debit note adds to it."
                  aside={
                    p && (
                      <span className="text-[12px] text-[var(--color-ink-2)]">
                        CN <strong className="tabular-nums">{amt(p.money.creditNotes)}</strong> · DN{" "}
                        <strong className="tabular-nums">{amt(p.money.debitNotes)}</strong>
                      </span>
                    )
                  }
                >
                  {notes.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[820px] text-[12px]">
                        <thead>
                          <tr className="bg-[#f4f7fb] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
                            <th className="px-2 py-1.5">Type</th>
                            <th className="px-2 py-1.5">Note number</th>
                            <th className="px-2 py-1.5">Note date</th>
                            <th className="px-2 py-1.5 text-right">Amount (FCY)</th>
                            <th className="px-2 py-1.5">Reason</th>
                            <th className="w-20 px-2 py-1.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {notes.map((row) => {
                            const gone = removed.has(row.key);
                            return (
                              <tr
                                key={row.key}
                                className={`border-t border-[var(--color-line)] ${
                                  gone ? "opacity-40" : row.id ? "" : "bg-[#fffbea]"
                                }`}
                              >
                                <td className="px-2 py-1.5">
                                  <select
                                    name={`n.${row.key}.noteType`}
                                    defaultValue={row.init.noteType || "CREDIT"}
                                    className="input w-36 px-2 py-1 text-[12px]"
                                    aria-label="Note type"
                                  >
                                    <option value="CREDIT">Credit note</option>
                                    <option value="DEBIT">Debit note</option>
                                  </select>
                                </td>
                                <LineCell name={`n.${row.key}.noteNo`} type="text" value={row.init.noteNo} width="w-36" label="Note number" />
                                <LineCell name={`n.${row.key}.noteDate`} type="date" value={row.init.noteDate} width="w-36" label="Note date" />
                                <LineCell name={`n.${row.key}.amount`} type="number" value={row.init.amount} width="w-32" label="Amount" />
                                <LineCell name={`n.${row.key}.reason`} type="text" value={row.init.reason} width="w-56" label="Reason" />
                                <td className="px-2 py-1.5 text-right">
                                  {row.id ? (
                                    <>
                                      {gone && <input type="hidden" name={`n.${row.key}.delete`} value="1" />}
                                      <button
                                        type="button"
                                        onClick={() => toggleRemove(row.key)}
                                        className="text-[11px] font-semibold text-[var(--color-bad-fg)] hover:underline"
                                      >
                                        {gone ? "Keep" : "Delete"}
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setNotes((rs) => rs.filter((r) => r.key !== row.key))}
                                      className="text-[11px] font-semibold text-[var(--color-bad-fg)] hover:underline"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => {
                        const key = nextKey();
                        setNotes((rs) => [...rs, { key, id: null, seq: null, init: { noteType: "CREDIT" } }]);
                      }}
                    >
                      + Add credit note
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => {
                        const key = nextKey();
                        setNotes((rs) => [...rs, { key, id: null, seq: null, init: { noteType: "DEBIT" } }]);
                      }}
                    >
                      + Add debit note
                    </button>
                  </div>
                </Section>
              </div>
            )}
          </div>
        );
      })}

      <datalist id="rf-terms">
        {props.termOptions.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-[var(--color-line)] bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        {p && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]">
            <span>
              Value <strong className="tabular-nums">{amt(p.customerInvoiceValue)}</strong>
            </span>
            <span>
              Received <strong className="tabular-nums">{amt(p.money.totalReceived)}</strong>
            </span>
            <span>
              Outstanding{" "}
              <strong className="tabular-nums text-[var(--color-brand)]">{amt(p.money.calculatedOutstanding)}</strong>
            </span>
            <span>
              Due <strong>{p.schedule.dueDate ? day(p.schedule.dueDate) : "—"}</strong>
            </span>
            <StatusChip status={p.status} note={p.statusNote} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Link href={props.cancelHref} className="btn-ghost">
            Cancel
          </Link>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving…" : props.submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

/** Where each invoice group sits among the ten sections. */
const SECTION_NUMBER: Record<string, number> = {
  invoice: 2,
  parties: 3,
  terms: 4,
  shipping: 5,
  currency: 6,
  books: 9,
  remarks: 10,
};

function tone(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-[var(--color-ink-3)]";
  return n < 0 ? "text-[var(--color-bad-fg)]" : "text-[var(--color-ok-fg)]";
}

function LineCell({
  name,
  type,
  value,
  width,
  label,
}: {
  name: string;
  type: string;
  value?: string;
  width: string;
  label: string;
}) {
  return (
    <td className="px-2 py-1.5">
      <input
        name={name}
        type={type === "date" ? "date" : "text"}
        inputMode={type === "number" ? "decimal" : undefined}
        defaultValue={value ?? ""}
        aria-label={label}
        autoComplete="off"
        className={`input px-2 py-1 text-[12px] ${width} ${type === "number" ? "text-right tabular-nums" : ""}`}
      />
    </td>
  );
}

/** The calculated figures a group's fields feed, shown in its heading. */
function GroupPreview({
  group,
  p,
  amt,
}: {
  group: string;
  p: TrackedInvoice | null;
  amt: (v: number | null | undefined) => string;
}) {
  if (!p) return null;
  const cls = "text-[12px] text-[var(--color-ink-2)]";
  if (group === "currency") {
    const home = toHome(p.customerInvoiceValue, p.exchangeRate);
    return (
      <span className={cls}>
        Value in {HOME_CURRENCY}{" "}
        <strong className="tabular-nums">{formatMoney(home, HOME_CURRENCY, { blank: "needs a rate" })}</strong>
      </span>
    );
  }
  if (group === "books") {
    return (
      <span className={cls}>
        Calculated balance <strong className="tabular-nums">{amt(p.money.calculatedOutstanding)}</strong>
        {p.money.booksDifference !== null && (
          <>
            {" · "}difference{" "}
            <strong
              className={`tabular-nums ${
                Math.abs(p.money.booksDifference) > 0.01 ? "text-[var(--color-bad-fg)]" : ""
              }`}
            >
              {amt(p.money.booksDifference)}
            </strong>
          </>
        )}
      </span>
    );
  }
  if (group === "invoice" && p.invoiceAge !== null) {
    return <span className={cls}>{p.invoiceAge} day(s) old</span>;
  }
  return null;
}

function TermsPreview({ p }: { p: TrackedInvoice }) {
  const s = p.schedule;
  return (
    <div className="mt-3 rounded-lg border border-[var(--color-line)] bg-[#fbfcfe] px-3 py-2 text-[12px]">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span>
          <span className="text-[var(--color-ink-3)]">Understood as </span>
          <strong className={s.term.unknown ? "text-[var(--color-warn-fg)]" : ""}>{s.term.description}</strong>
          {s.term.rule && (
            <span className="ml-1 chip bg-[var(--color-info-bg)] text-[var(--color-info-fg)]">
              rule: {s.term.rule.name}
            </span>
          )}
        </span>
        <span>
          <span className="text-[var(--color-ink-3)]">Due date </span>
          {s.dueDate ? (
            <strong>
              {day(s.dueDate)}
              {s.dueDateSource === "entered" ? " (entered)" : ""}
              {p.overdueDays !== null && p.overdueDays > 0 && (p.money.calculatedOutstanding ?? 0) > 0.01
                ? ` · ${p.overdueDays} day(s) overdue`
                : ""}
            </strong>
          ) : (
            <strong className="text-[var(--color-warn-fg)]">needs verification</strong>
          )}
        </span>
      </div>
      {s.dueDateNote !== s.term.description && (
        <p className="mt-1 text-[11px] text-[var(--color-ink-3)]">{s.dueDateNote}</p>
      )}
      {s.milestones.length > 1 && (
        <ul className="mt-1 text-[11px] text-[var(--color-ink-2)]">
          {s.milestones.map((m) => (
            <li key={m.seq}>
              {m.label}: {m.dueDate ? day(m.dueDate) : "no date yet"}
            </li>
          ))}
        </ul>
      )}
      {s.term.assumptions.map((a) => (
        <p key={a} className="mt-1 text-[11px] text-[var(--color-warn-fg)]">
          {a}
        </p>
      ))}
    </div>
  );
}
