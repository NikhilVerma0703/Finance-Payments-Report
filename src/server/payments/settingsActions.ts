/**
 * Changing the rules and thresholds in Settings & Rules.
 *
 * Every change is validated before it is stored, and every screen is refreshed
 * after it, because a rule or a threshold changes figures everywhere: due
 * dates, statuses, ageing, the dashboard, the customer summaries and exports.
 *
 * The two forms that report a result (a rule, the thresholds) refresh the
 * screen themselves once the result has arrived; the one-click actions
 * (activate, delete) redirect back, which renders the screen afresh.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/text";
import { validateRule } from "@/lib/payments/terms";
import { ROUTES } from "@/lib/routes";
import { PARAM_FIELDS } from "@/server/payments/settings";

export interface SettingsState {
  ok: boolean;
  message: string;
  errors: string[];
}

function text(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** The portions as typed: m.0.percent, m.0.days, m.0.basis, m.1.… */
function portions(form: FormData) {
  const idx = new Set<number>();
  for (const k of form.keys()) {
    const m = /^m\.(\d+)\./.exec(k);
    if (m) idx.add(Number(m[1]));
  }
  return [...idx]
    .sort((a, b) => a - b)
    .map((i) => ({
      percent: toNumber(text(form, `m.${i}.percent`)),
      days: (() => {
        const d = toNumber(text(form, `m.${i}.days`) ?? "0");
        return d === null ? null : d;
      })(),
      basis: text(form, `m.${i}.basis`),
    }))
    // a row with nothing typed in it is not a portion
    .filter((m) => m.percent !== null || (m.days !== null && m.days !== 0));
}

export async function saveTermRuleAction(
  _prev: SettingsState | null,
  form: FormData,
): Promise<SettingsState> {
  const id = text(form, "ruleId");
  const name = text(form, "name");
  const matchText = text(form, "matchText");
  const matchMode = text(form, "matchMode") === "CONTAINS" ? "CONTAINS" : "EXACT";
  const milestones = portions(form);

  const errors = validateRule({ name, matchText, milestones });

  // the same wording may not be defined twice — which one would apply?
  if (matchText) {
    const others = await prisma.ptTermRule.findMany({ where: id ? { NOT: { id } } : {} });
    const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const clash = others.find(
      (r) => squash(r.matchText) === squash(matchText) && r.matchMode === matchMode,
    );
    if (clash) errors.push(`The rule "${clash.name}" already matches this wording.`);
  }
  if (errors.length) return { ok: false, message: "The rule was not saved.", errors };

  const data = {
    name: name!,
    matchText: matchText!,
    matchMode,
    milestones: JSON.stringify(
      milestones.map((m) => ({ percent: m.percent, days: m.days, basis: m.basis })),
    ),
    active: form.get("active") !== "0",
    notes: text(form, "notes"),
  };
  if (id) await prisma.ptTermRule.update({ where: { id }, data });
  else await prisma.ptTermRule.create({ data });

  // the form refreshes the screen itself once it has this result
  return {
    ok: true,
    message: `Rule "${data.name}" saved. Every invoice using this wording has been recalculated.`,
    errors: [],
  };
}

export async function deleteTermRuleAction(form: FormData): Promise<void> {
  const id = text(form, "ruleId");
  if (!id) return;
  await prisma.ptTermRule.deleteMany({ where: { id } });
  revalidatePath("/", "layout");
  redirect(`${ROUTES.settings}#rules`);
}

export async function toggleTermRuleAction(form: FormData): Promise<void> {
  const id = text(form, "ruleId");
  if (!id) return;
  const rule = await prisma.ptTermRule.findUnique({ where: { id } });
  if (!rule) return;
  await prisma.ptTermRule.update({ where: { id }, data: { active: !rule.active } });
  revalidatePath("/", "layout");
  redirect(`${ROUTES.settings}#rules`);
}

export async function saveParamsAction(
  _prev: SettingsState | null,
  form: FormData,
): Promise<SettingsState> {
  const errors: string[] = [];
  const values: Array<{ key: string; value: number }> = [];
  for (const f of PARAM_FIELDS) {
    const raw = text(form, f.key);
    if (raw === null) continue;
    const n = toNumber(raw);
    if (n === null || !Number.isFinite(n)) {
      errors.push(`${f.label}: "${raw}" is not a number.`);
      continue;
    }
    if (f.integer && !Number.isInteger(n)) errors.push(`${f.label}: must be a whole number.`);
    if (n < f.min || n > f.max) errors.push(`${f.label}: must be between ${f.min} and ${f.max}.`);
    values.push({ key: f.key, value: n });
  }
  if (errors.length) return { ok: false, message: "Nothing was saved.", errors };

  for (const v of values) {
    await prisma.ptSetting.upsert({
      where: { key: v.key },
      create: { key: v.key, value: String(v.value) },
      update: { value: String(v.value) },
    });
  }
  return { ok: true, message: "Saved. Statuses and attention flags have been recalculated.", errors: [] };
}
