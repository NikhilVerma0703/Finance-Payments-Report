"use client";

/** The two forms on Settings & Rules: a payment-term rule, and the thresholds. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";

import { Banner } from "@/components/ui";
import { ROUTES } from "@/lib/routes";
import {
  saveParamsAction,
  saveTermRuleAction,
  type SettingsState,
} from "@/server/payments/settingsActions";

export interface RuleDraft {
  id?: string;
  name: string;
  matchText: string;
  matchMode: "EXACT" | "CONTAINS";
  active: boolean;
  notes: string;
  milestones: Array<{ percent: string; days: string; basis: string }>;
}

function Messages({ state }: { state: SettingsState | null }) {
  if (!state) return null;
  return (
    <Banner tone={state.ok ? "ok" : "bad"}>
      <strong>{state.message}</strong>
      {state.errors.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-[12px]">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </Banner>
  );
}

export function TermRuleForm({
  draft,
  bases,
}: {
  draft: RuleDraft;
  bases: Array<[string, string]>;
}) {
  const [state, dispatch, saving] = useActionState<SettingsState | null, FormData>(
    saveTermRuleAction,
    null,
  );
  const initialRows = () =>
    (draft.milestones.length ? draft.milestones : [{ percent: "100", days: "", basis: "BL_DATE" }]).map(
      (m, i) => ({ ...m, key: i }),
    );
  const [rows, setRows] = useState(initialRows);
  const [nextKey, setNextKey] = useState(rows.length);
  // after a new rule is added, start again from a blank form
  const [version, setVersion] = useState(0);
  const router = useRouter();
  useEffect(() => {
    if (!state?.ok) return;
    // the rule changes figures everywhere on this screen: read them back
    router.refresh();
    if (draft.id) return;
    setVersion((v) => v + 1);
    setRows(initialRows());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const total = rows.reduce((s, r) => s + (Number(r.percent) || 0), 0);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => dispatch(data));
      }}
    >
      <Messages state={state} />
      {draft.id && <input type="hidden" name="ruleId" value={draft.id} />}

      <div key={version} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="block">
          <span className="field-label">Rule name</span>
          <input name="name" defaultValue={draft.name} className="input" placeholder="e.g. Terry Stone standard" />
        </label>
        <label className="block xl:col-span-2">
          <span className="field-label">Payment-term wording to recognise</span>
          <input
            name="matchText"
            defaultValue={draft.matchText}
            className="input"
            placeholder="e.g. 60% advance, balance 40% against BL copy"
          />
        </label>
        <label className="block">
          <span className="field-label">Match</span>
          <select name="matchMode" defaultValue={draft.matchMode} className="input">
            <option value="EXACT">The whole wording (exact)</option>
            <option value="CONTAINS">Wording that contains it</option>
          </select>
        </label>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="field-label mb-0">Portions — what falls due, and when</span>
          <span
            className={`text-[11px] font-semibold ${
              Math.abs(total - 100) < 0.01 ? "text-[var(--color-ok-fg)]" : "text-[var(--color-bad-fg)]"
            }`}
          >
            Total {Math.round(total * 100) / 100}% {Math.abs(total - 100) < 0.01 ? "✓" : "— must be 100%"}
          </span>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.key} className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--color-line)] p-2">
              <span className="w-16 pb-2 text-[12px] font-semibold text-[var(--color-ink-3)]">Part {i + 1}</span>
              <label className="block w-28">
                <span className="field-label">Percent</span>
                <input
                  name={`m.${i}.percent`}
                  defaultValue={r.percent}
                  inputMode="decimal"
                  className="input text-right"
                  onChange={(e) =>
                    setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, percent: e.target.value } : x)))
                  }
                />
              </label>
              <label className="block w-28">
                <span className="field-label">Days after</span>
                <input name={`m.${i}.days`} defaultValue={r.days} inputMode="numeric" className="input text-right" placeholder="0" />
              </label>
              <label className="block w-64">
                <span className="field-label">Counted from</span>
                <select name={`m.${i}.basis`} defaultValue={r.basis || "BL_DATE"} className="input">
                  {bases.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              {rows.length > 1 && (
                <button
                  type="button"
                  className="pb-2 text-[11px] font-semibold text-[var(--color-bad-fg)] hover:underline"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn-ghost btn-sm mt-2"
          onClick={() => {
            setRows((rs) => [...rs, { percent: "", days: "", basis: "BL_DATE", key: nextKey }]);
            setNextKey((k) => k + 1);
          }}
        >
          + Add portion
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="field-label">Notes</span>
          <input name="notes" defaultValue={draft.notes} className="input" placeholder="Optional" />
        </label>
        <label className="block">
          <span className="field-label">Status</span>
          <select name="active" defaultValue={draft.active ? "1" : "0"} className="input">
            <option value="1">Active — applied everywhere</option>
            <option value="0">Inactive — kept, not applied</option>
          </select>
        </label>
      </div>

      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Saving…" : draft.id ? "Save rule" : "Add rule"}
        </button>
        {draft.id && (
          <Link href={`${ROUTES.settings}#rules`} className="btn-ghost">
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}

export function ParamsForm({
  fields,
}: {
  fields: Array<{ key: string; label: string; help: string; value: number; min: number; max: number }>;
}) {
  const [state, dispatch, saving] = useActionState<SettingsState | null, FormData>(saveParamsAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => dispatch(data));
      }}
    >
      <Messages state={state} />
      <div className="grid gap-3 md:grid-cols-3">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="field-label">{f.label}</span>
            <input name={f.key} defaultValue={String(f.value)} inputMode="decimal" className="input text-right" />
            <span className="mt-0.5 block text-[10px] text-[var(--color-ink-3)]">
              {f.help} ({f.min}–{f.max})
            </span>
          </label>
        ))}
      </div>
      <button type="submit" className="btn" disabled={saving}>
        {saving ? "Saving…" : "Save thresholds"}
      </button>
    </form>
  );
}
