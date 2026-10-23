"use client";

/**
 * A dropdown that submits its form as soon as a choice is made.
 *
 * For one-field changes made in passing — a customer's currency from the
 * summary table, the dashboard's currency — where a separate Save button would
 * be one click too many. Without JavaScript the small button beside it still
 * submits the form.
 */
export function AutoSelect({
  name,
  value,
  options,
  blankLabel,
  label,
  className = "",
}: {
  name: string;
  value: string;
  options: ReadonlyArray<string | readonly [string, string]>;
  /** A blank first choice; omitted, there is none. */
  blankLabel?: string;
  /** For screen readers; the table header says it for everyone else. */
  label: string;
  className?: string;
}) {
  return (
    <>
      <select
        name={name}
        defaultValue={value}
        aria-label={label}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`rounded-md border border-[var(--color-line)] bg-white px-1.5 py-0.5 text-[12px] outline-none focus:border-[#a9c6e8] ${className}`}
      >
        {blankLabel !== undefined && <option value="">{blankLabel}</option>}
        {options.map((o) => {
          const [v, l] = typeof o === "string" ? [o, o] : o;
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
      <noscript>
        <button type="submit" className="btn-ghost btn-sm ml-1">
          Set
        </button>
      </noscript>
    </>
  );
}
