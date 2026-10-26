"use client";

/**
 * Choosing a table's columns one by one (owner, 25 Oct 2026: "Allow users to
 * choose which columns to display in relevant invoice tables, especially
 * Invoice Value and other important financial fields").
 *
 * A plain GET form: the ticked columns travel as ?col=…, so a choice is a URL
 * like a filter or a sort. It is also remembered in this browser (the pt_cols
 * cookie — its name is handed in), so the next visit opens with the same
 * columns. "Every column" forgets the choice.
 */
export function ColumnChooser({
  cookieName,
  basePath,
  keep,
  groups,
  chosen,
}: {
  cookieName: string;
  basePath: string;
  /** The query to keep: the filters and the sort. */
  keep: Array<[string, string]>;
  groups: Array<{ title: string; columns: Array<{ key: string; label: string; shown: boolean }> }>;
  /** The columns chosen now, if any were. */
  chosen: string[];
}) {
  const remember = (value: string) => {
    document.cookie = `${cookieName}=${encodeURIComponent(value)}; path=/; max-age=${value ? 31536000 : 0}; samesite=lax`;
  };
  return (
    <details className="group relative">
      <summary className="btn-ghost btn-sm flex cursor-pointer list-none items-center gap-1.5">
        Choose columns{chosen.length ? ` · ${chosen.length}` : ""}
        <span className="text-[var(--color-ink-3)] transition-transform group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>
      <form
        action={basePath}
        onSubmit={(e) => {
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          if (submitter?.value === "all") return remember("");
          const picked = new FormData(e.currentTarget).getAll("col").map(String);
          remember(picked.join("."));
        }}
        className="absolute left-0 z-30 mt-1 w-[min(92vw,680px)] rounded-xl border border-[var(--color-line)] bg-white p-4 text-[12px] shadow-lg"
      >
        {keep.map(([k, v]) => (
          <input key={`${k}=${v}`} type="hidden" name={k} value={v} />
        ))}
        <p className="mb-3 text-[var(--color-ink-3)]">
          Tick the columns to show. The # and the invoice number always stay; your choice is remembered in this browser.
        </p>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {groups.map((g) => (
            <fieldset key={g.title}>
              <legend className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-ink-2)]">{g.title}</legend>
              {g.columns.map((c) => (
                <label key={c.key} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" name="col" value={c.key} defaultChecked={c.shown} className="h-3.5 w-3.5 accent-[var(--color-brand)]" />
                  {c.label}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3">
          <button type="submit" className="btn btn-sm">
            Show these columns
          </button>
          <button type="submit" name="col" value="all" className="btn-ghost btn-sm">
            Every column
          </button>
        </div>
      </form>
    </details>
  );
}
