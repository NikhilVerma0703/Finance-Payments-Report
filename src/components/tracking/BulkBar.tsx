"use client";

/**
 * Ticking invoices in the tables, and doing something with them (owner, 25 Oct
 * 2026: "Provide checkboxes to select and unselect individual invoices or
 * multiple invoices for bulk actions").
 *
 * The table stays a server component: each row's checkbox is a plain
 * <input form={formId} name="id">, which belongs to the form this bar draws
 * however far away in the page it sits — no form wraps the table, so nothing
 * in it nests. The bar counts what is ticked, ticks or clears the whole page,
 * posts the ticked ids to its action (mark completed, or restore), and opens
 * the export with them (?id=…). SelectAllBox is the table header's own box.
 */
import { useEffect, useState } from "react";

const boxes = (formId: string) => [...document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="id"][form="${formId}"]`)];

export function BulkBar({
  formId,
  action,
  actionLabel,
  hint,
  exportHref,
  returnTo,
}: {
  formId: string;
  action: (form: FormData) => Promise<void>;
  /** "Mark as completed", "Restore to active". */
  actionLabel: string;
  /** What the action does, on hover. */
  hint: string;
  /** The export route, to which the ticked ids are added. */
  exportHref: string;
  /** Where the action comes back to. */
  returnTo: string;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const update = () => setCount(boxes(formId).filter((b) => b.checked).length);
    update();
    document.addEventListener("change", update);
    return () => document.removeEventListener("change", update);
  }, [formId]);

  const tickAll = (on: boolean) => {
    for (const b of boxes(formId)) b.checked = on;
    setCount(on ? boxes(formId).length : 0);
  };
  const exportTicked = (format?: "csv") => {
    const ids = boxes(formId)
      .filter((b) => b.checked)
      .map((b) => `id=${encodeURIComponent(b.value)}`);
    if (!ids.length) return;
    window.location.href = `${exportHref}${exportHref.includes("?") ? "&" : "?"}${ids.join("&")}${format ? "&format=csv" : ""}`;
  };

  return (
    <form
      id={formId}
      action={action}
      className="sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-line)] bg-white/95 px-3 py-2 text-[12px] shadow-sm backdrop-blur"
    >
      <input type="hidden" name="returnTo" value={returnTo} />
      <span
        className={`rounded-md px-2 py-1 font-semibold tabular-nums ${
          count ? "bg-[var(--color-info-bg)] text-[var(--color-info-fg)]" : "bg-[var(--color-mute-bg)] text-[var(--color-mute-fg)]"
        }`}
      >
        {count} selected
      </span>
      <button type="button" onClick={() => tickAll(true)} className="btn-ghost btn-sm">
        Select all on this page
      </button>
      <button type="button" onClick={() => tickAll(false)} disabled={!count} className="btn-ghost btn-sm disabled:opacity-50">
        Clear
      </button>
      <span className="mx-1 h-5 w-px bg-[var(--color-line)]" aria-hidden />
      <button type="submit" disabled={!count} title={hint} className="btn btn-sm">
        {actionLabel}
      </button>
      <button type="button" disabled={!count} onClick={() => exportTicked()} className="btn-ghost btn-sm disabled:opacity-50">
        Export selected (Excel)
      </button>
      <button type="button" disabled={!count} onClick={() => exportTicked("csv")} className="btn-ghost btn-sm disabled:opacity-50">
        CSV
      </button>
    </form>
  );
}

/** The header's box: ticks or clears every row of the page. */
export function SelectAllBox({ formId }: { formId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select every invoice on this page"
      className="h-4 w-4 accent-[var(--color-brand)]"
      onChange={(e) => {
        for (const b of boxes(formId)) b.checked = e.currentTarget.checked;
        document.dispatchEvent(new Event("change"));
      }}
    />
  );
}
