"use client";

/** Choose an imported invoice and open it in EDIT OR ADD EXTRA INFORMATIONS. */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ROUTES } from "@/lib/routes";

export function EditPicker({
  groups,
}: {
  groups: Array<{ customer: string; invoices: Array<{ id: string; label: string }> }>;
}) {
  const router = useRouter();
  const [id, setId] = useState("");

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (id) router.push(ROUTES.editInvoice(id));
      }}
    >
      <label className="block min-w-[320px] flex-1">
        <span className="field-label">Imported invoice</span>
        <select className="input" value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Choose an invoice…</option>
          {groups.map((g) => (
            <optgroup key={g.customer} label={g.customer}>
              {g.invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <button type="submit" className="btn" disabled={!id}>
        EDIT OR ADD EXTRA INFORMATIONS
      </button>
    </form>
  );
}
