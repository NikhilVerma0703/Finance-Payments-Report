/**
 * What has been changed by hand, and what the uploaded sheet originally said.
 *
 * The second half is the reason this panel exists. About half the figures in
 * this section arrive from a customer's own spreadsheet, and once one has been
 * corrected there is nothing on the face of the record to say so — "Received
 * 59,651.63" reads identically whether the customer said it or we did. The
 * *Overwritten from the uploaded sheet* block answers that directly: it names
 * each imported value that has since been changed, and what it was.
 *
 * Nothing here is editable. It is the one read-only thing in the section, and
 * deliberately so — a correction history that can be corrected is not one.
 */
import type { History } from "@/server/payments/audit";

const ENTITY_LABEL: Record<string, string> = {
  INVOICE: "Invoice",
  RECEIPT: "Receipt",
  NOTE: "Note",
  CUSTOMER: "Customer",
};

export function HistoryPanel({
  history,
  title = "Correction history",
}: {
  history: History;
  title?: string;
}) {
  const overwritten = Object.entries(history.imported).filter(([, v]) => v !== null);

  if (history.entries.length === 0) {
    return (
      <section className="card mt-5">
        <h2 className="card-title">{title}</h2>
        <p className="text-[12px] text-[var(--color-ink-3)]">No changes recorded.</p>
      </section>
    );
  }

  return (
    <section className="card mt-5">
      <h2 className="card-title">{title}</h2>

      {overwritten.length > 0 && (
        <div className="mb-4 rounded-lg border border-[#efd9a1] bg-[var(--color-warn-bg)] p-3">
          <h3 className="text-[12px] font-semibold text-[var(--color-warn-fg)]">
            Overwritten from the uploaded sheet
          </h3>
          <ul className="mt-1.5 space-y-0.5 text-[12px]">
            {overwritten.map(([field, was]) => (
              <li key={field}>
                <strong>{label(history, field)}</strong> — the sheet said{" "}
                <span className="font-mono">{was}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="tablewrap">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">On</th>
              <th className="px-3 py-2">Field</th>
              <th className="px-3 py-2">Was</th>
              <th className="px-3 py-2">Became</th>
              <th className="px-3 py-2">By</th>
            </tr>
          </thead>
          <tbody>
            {history.entries.map((e) => (
              <tr key={e.id} className="border-t border-[var(--color-line)]">
                <td className="whitespace-nowrap px-3 py-2 text-[var(--color-ink-3)]">{e.at}</td>
                <td className="px-3 py-2 text-[var(--color-ink-3)]">
                  {ENTITY_LABEL[e.entity] ?? e.entity}
                </td>
                <td className="px-3 py-2 font-medium">{e.label}</td>
                <td className="px-3 py-2">
                  {e.oldValue === null ? (
                    <span className="italic text-[var(--color-ink-3)]">empty</span>
                  ) : (
                    <span className="font-mono">{e.oldValue}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {e.newValue === null ? (
                    <span className="italic text-[var(--color-ink-3)]">cleared</span>
                  ) : (
                    <strong className="font-mono">{e.newValue}</strong>
                  )}
                </td>
                <td className="px-3 py-2 text-[var(--color-ink-3)]">{e.editedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
        {history.entries.length} change(s)
      </p>
    </section>
  );
}

function label(history: History, fieldKey: string): string {
  return history.entries.find((e) => e.fieldKey === fieldKey)?.label ?? fieldKey;
}
