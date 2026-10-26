/**
 * The filter form, for Search Invoices and for Reports & Downloads Sheets.
 *
 * A plain GET form, so every result is a URL — bookmarkable, shareable, and
 * handed to the export unchanged, which is how a download is guaranteed to be
 * the records that were on screen. Any filter works alone or with any other;
 * with none applied, every record is shown.
 */
import Link from "next/link";

import { ageingOrder } from "@/lib/payments/ageing";
import { SETTLED } from "@/lib/payments/money";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/payments/record";
import {
  activeFilters,
  DATE_FIELDS,
  describeFilters,
  GROUPINGS,
  isDateField,
  MISSING_FIELDS,
  type TrackingFilters,
} from "@/server/payments/query";

function Select({
  name,
  label,
  value,
  options,
  width = "w-44",
  allLabel = "All",
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: Array<[string, string]>;
  width?: string;
  allLabel?: string;
}) {
  return (
    <div className={width}>
      <label className="field-label" htmlFor={`fl-${name}`}>
        {label}
      </label>
      <select id={`fl-${name}`} name={name} defaultValue={value ?? ""} className="input">
        <option value="">{allLabel}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({ name, label, on, hint }: { name: string; label: string; on: boolean; hint?: string }) {
  return (
    <label className="flex items-center gap-1.5" title={hint}>
      <input type="checkbox" name={name} value="1" defaultChecked={on} />
      {label}
    </label>
  );
}

/** A from–to pair of number boxes: `${name}min` and `${name}max`. */
function Range({ name, label, lo, hi, unit }: { name: string; label: string; lo: string | undefined; hi: string | undefined; unit?: string }) {
  return (
    <fieldset className="w-full sm:w-56">
      <legend className="field-label">
        {label}
        {unit && <span className="font-normal text-[var(--color-ink-3)]"> ({unit})</span>}
      </legend>
      <div className="flex items-center gap-1.5">
        <input name={`${name}min`} type="number" step="any" defaultValue={lo ?? ""} placeholder="from" aria-label={`${label} from`} className="input" />
        <span className="text-[var(--color-ink-3)]">–</span>
        <input name={`${name}max`} type="number" step="any" defaultValue={hi ?? ""} placeholder="to" aria-label={`${label} to`} className="input" />
      </div>
    </fieldset>
  );
}

/** The advanced filters' keys, to say how many are in force. */
const ADVANCED: ReadonlyArray<keyof TrackingFilters> = ["omin", "omax", "vmin", "vmax", "dmin", "dmax", "country", "src", "missing"];

export interface FilterOptions {
  customers: string[];
  currencies: string[];
  pos: string[];
  terms: string[];
  /** The countries on record, for the advanced filters. */
  countries?: string[];
  invoiceNos?: string[];
}

export function Filters({
  filters,
  options,
  buckets,
  action,
  variant = "search",
  matched,
  total,
}: {
  filters: TrackingFilters;
  options: FilterOptions;
  buckets: number[];
  /** The page the form submits to, and that Reset returns to. */
  action: string;
  variant?: "search" | "reports";
  matched?: number;
  total?: number;
}) {
  const field = isDateField(filters.dateField) ? filters.dateField : "invoice";
  const ageing = [...ageingOrder(buckets), SETTLED];
  const applied = activeFilters(filters);
  const advanced = ADVANCED.filter((k) => filters[k]).length;

  return (
    <section className="card mb-4">
      <form method="get" action={action} className="space-y-4">
        {filters.sort && <input type="hidden" name="sort" value={filters.sort} />}
        {filters.dir && <input type="hidden" name="dir" value={filters.dir} />}

        <div className="flex flex-wrap items-end gap-3">
          {variant === "search" ? (
            <div className="min-w-[260px] flex-1">
              <label className="field-label" htmlFor="fl-q">
                Search
              </label>
              <input
                id="fl-q"
                name="q"
                defaultValue={filters.q ?? ""}
                placeholder="Invoice number or customer name (also PO, BL, container, remarks)"
                className="input"
              />
            </div>
          ) : (
            <div className="w-56">
              <label className="field-label" htmlFor="fl-inv">
                Invoice number
              </label>
              <input
                id="fl-inv"
                name="inv"
                list="fl-inv-list"
                defaultValue={filters.inv ?? ""}
                placeholder="All invoices"
                className="input"
                autoComplete="off"
              />
              <datalist id="fl-inv-list">
                {(options.invoiceNos ?? []).map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
          )}

          <Select
            name="customer"
            label="Customer"
            value={filters.customer}
            width="w-52"
            options={options.customers.map((c) => [c, c])}
          />
          {variant === "search" && (
            <>
              <Select
                name="currency"
                label="Currency"
                value={filters.currency}
                width="w-28"
                options={options.currencies.map((c) => [c, c])}
              />
              <Select
                name="status"
                label="Status"
                value={filters.status}
                width="w-44"
                options={STATUS_ORDER.map((s) => [s, STATUS_LABELS[s]])}
              />
            </>
          )}
          <Select
            name="ageing"
            label="Ageing"
            value={filters.ageing}
            width="w-40"
            options={ageing.map((b) => [b, b])}
          />
          <Select
            name="po"
            label="PO number"
            value={filters.po}
            width="w-40"
            options={options.pos.map((p) => [p, p])}
          />
          {variant === "search" && (
            <Select
              name="term"
              label="Payment terms"
              value={filters.term}
              width="w-60"
              options={options.terms.map((t) => [t, t])}
            />
          )}
        </div>

        {variant === "search" && (
          // more ways in, folded until wanted (owner, 25 Oct 2026); open while any is in force
          <details open={advanced > 0} className="group rounded-xl border border-[var(--color-line)] bg-[var(--color-shell)] px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-2)]">
              <span className="transition-transform group-open:rotate-90" aria-hidden>
                ▸
              </span>
              Advanced filters
              {advanced > 0 && (
                <span className="rounded-full bg-[var(--color-info-bg)] px-2 py-0.5 normal-case tracking-normal text-[var(--color-info-fg)]">
                  {advanced} in force
                </span>
              )}
            </summary>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Range name="o" label="Outstanding" lo={filters.omin} hi={filters.omax} unit="invoice currency" />
              <Range name="v" label="Invoice value" lo={filters.vmin} hi={filters.vmax} unit="invoice currency" />
              <Range name="d" label="Days overdue" lo={filters.dmin} hi={filters.dmax} />
              <Select name="country" label="Country" value={filters.country} options={(options.countries ?? []).map((c) => [c, c])} />
              <Select name="src" label="Source" value={filters.src} options={[["EXCEL", "Uploaded sheet"], ["MANUAL", "Entered by hand"]]} />
              <Select name="missing" label="Missing information" width="w-48" value={filters.missing} options={Object.entries(MISSING_FIELDS)} />
            </div>
          </details>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <label
              className="field-label"
              htmlFor="fl-dateField"
              title="Overdue Date is the day an unpaid invoice became overdue: the day after its due date."
            >
              Date range on
            </label>
            <select id="fl-dateField" name="dateField" defaultValue={field} className="input">
              {Object.entries(DATE_FIELDS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className="field-label" htmlFor="fl-from">
              From
            </label>
            <input id="fl-from" name="from" type="date" defaultValue={filters.from ?? ""} className="input" />
          </div>
          <div className="w-40">
            <label className="field-label" htmlFor="fl-to">
              To
            </label>
            <input id="fl-to" name="to" type="date" defaultValue={filters.to ?? ""} className="input" />
          </div>

          {variant === "search" && (
            <>
              <div className="w-44">
                <label className="field-label" htmlFor="fl-group">
                  Group by
                </label>
                <select id="fl-group" name="group" defaultValue={filters.group ?? "none"} className="input">
                  {Object.entries(GROUPINGS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-4 pb-2 text-[12px]">
                <Check name="open" label="Outstanding only" on={filters.open === "1"} />
                <Check name="attention" label="Needs attention" on={filters.attention === "1"} />
                <Check name="nilReceived" label="Nothing received" on={filters.nilReceived === "1"} />
                <Check
                  name="verify"
                  label="Requires verification"
                  on={filters.verify === "1"}
                  hint="Invoices whose due date could not be established from what is recorded."
                />
              </div>
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button type="submit" className="btn">
              Apply
            </button>
            <Link href={action} className="btn-ghost">
              Reset
            </Link>
          </div>
        </div>
      </form>

      <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
        {matched !== undefined && total !== undefined && (
          <>
            <strong className="text-[var(--color-ink-2)]">{matched}</strong> of {total} invoice(s)
            {" · "}
          </>
        )}
        {applied.length
          ? `Filtered by ${describeFilters(filters).join(" · ")}`
          : "No filters applied — showing every record."}
      </p>
    </section>
  );
}
