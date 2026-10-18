"use client";

/**
 * A delete button that asks first.
 *
 * The first click only opens the question — what will be removed, and that it
 * cannot be undone — and the delete happens on the second, deliberate click.
 * No browser pop-up, so it reads the same everywhere and cannot be dismissed
 * by a stray Enter key.
 */
import { useState } from "react";
import { useFormStatus } from "react-dom";

function Confirm({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-danger" disabled={pending}>
      {pending ? "Deleting…" : label}
    </button>
  );
}

export function ConfirmDelete({
  action,
  fields,
  label,
  question,
  confirmLabel = "Yes, delete permanently",
  small = false,
}: {
  action: (form: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: string;
  question: React.ReactNode;
  confirmLabel?: string;
  small?: boolean;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className={small ? "text-[11px] font-semibold text-[var(--color-bad-fg)] hover:underline" : "btn-danger"}
      >
        {label}
      </button>
    );
  }

  return (
    <form
      action={action}
      className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-[#f0c9c9] bg-[var(--color-bad-bg)] px-3 py-2 text-[12px] text-[var(--color-bad-fg)]"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <span className="max-w-[48ch]">{question}</span>
      <Confirm label={confirmLabel} />
      <button type="button" onClick={() => setAsking(false)} className="btn-ghost btn-sm">
        Cancel
      </button>
    </form>
  );
}
