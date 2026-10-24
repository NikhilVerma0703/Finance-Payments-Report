"use client";

import { useEffect, useState } from "react";

/**
 * The customer-wise summary's search box (owner, 24 Oct 2026: "Add a search
 * functionality to filter customers by Customer Name, while preserving all
 * existing sorting features").
 *
 * It filters as you type: a style rule hides every row whose customer name
 * does not hold what is typed (the rows carry `data-name`, in lower case), so
 * nothing the server drew is touched by hand. It sits in the summary's sort
 * form, so Enter — or picking another order — sends it as `?cq=` with the
 * sort, and the page comes back with the rows, the S. No. and the totals worked
 * out over the matches alone. Until then a currency's totals row and heading
 * (`data-total`, `data-group`) are hidden, because they still count every row.
 */
export function CustomerSearch({ tableId, initial, total }: { tableId: string; initial: string; total: number }) {
  const [term, setTerm] = useState(initial);
  const [shown, setShown] = useState<number | null>(null);
  const q = term.trim().toLowerCase();
  const live = q !== initial.trim().toLowerCase();
  const scope = `#${tableId}`;
  const css = q
    ? `${scope} tr[data-name]:not([data-name*="${cssString(q)}"]) { display: none; }` +
      (live ? ` ${scope} tr[data-total], ${scope} tr[data-group] { display: none; }` : "")
    : "";

  useEffect(() => {
    if (!q) return setShown(null);
    const table = document.getElementById(tableId);
    setShown(table ? table.querySelectorAll(`tr[data-name*="${cssString(q)}"]`).length : null);
  }, [q, tableId]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {css && <style>{css}</style>}
      <label className="relative flex items-center">
        <span className="sr-only">Search customers by name</span>
        <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-2.5 h-4 w-4 text-[var(--color-ink-3)]" aria-hidden>
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M13 13l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          name="cq"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search customer name…"
          autoComplete="off"
          className="w-64 rounded-md border border-[var(--color-line)] bg-white py-1.5 pl-8 pr-3 text-[13px] shadow-sm outline-none transition focus:border-[var(--color-brand-2)] focus:ring-2 focus:ring-[#c6dcf3]"
        />
      </label>
      {shown !== null && (
        <span className="whitespace-nowrap text-[11px] text-[var(--color-ink-3)]">
          {shown} of {total} shown{live ? " · press Enter to total them" : ""}
        </span>
      )}
    </div>
  );
}

/** Text made safe inside a double-quoted CSS attribute value. */
function cssString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r]/g, " ");
}
