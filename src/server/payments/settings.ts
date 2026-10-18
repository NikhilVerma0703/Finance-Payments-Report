/**
 * Reading the rules and thresholds from Settings & Rules.
 *
 * Read once per request and handed to every calculation, so the dashboard, the
 * tables, the invoice screens, the forms' previews and the exports all apply
 * the same rules at the same moment.
 */
import "server-only";

import { cache } from "react";

import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";
import { TRACKING_DEFAULTS, type TrackingParams } from "@/lib/payments/record";
import { isDateBasis, type RuleMilestone, type TermRule } from "@/lib/payments/terms";

/** The thresholds a person may change, with the bounds a value must sit inside. */
export const PARAM_FIELDS = [
  {
    key: "dueSoonDays",
    label: "Due soon window (days)",
    help: "An invoice due within this many days is marked Due soon.",
    min: 0,
    max: 90,
    integer: true,
  },
  {
    key: "nearlySettledPct",
    label: "Nearly settled threshold (%)",
    help: "A balance below this share of the invoice value is marked Nearly settled.",
    min: 0,
    max: 25,
    integer: false,
  },
  {
    key: "attentionAfterDays",
    label: "Flag undated invoices after (days)",
    help: "An invoice with nothing received and no due date is flagged once it is this old.",
    min: 1,
    max: 3650,
    integer: true,
  },
] as const;

export type ParamKey = (typeof PARAM_FIELDS)[number]["key"];

export const loadParams = cache(async (): Promise<TrackingParams> => {
  const rows = await prisma.ptSetting.findMany();
  const params: TrackingParams = { ...TRACKING_DEFAULTS };
  for (const row of rows) {
    const field = PARAM_FIELDS.find((f) => f.key === row.key);
    const n = Number(row.value);
    if (!field || !Number.isFinite(n) || n < field.min || n > field.max) continue;
    params[field.key] = n;
  }
  return params;
});

/** A stored rule as the calculations use it. A malformed portion is dropped. */
export function toTermRule(row: {
  id: string;
  name: string;
  matchText: string;
  matchMode: string;
  milestones: string;
  active: boolean;
}): TermRule {
  const raw = fromJson<Array<Partial<RuleMilestone>>>(row.milestones, []);
  const milestones = raw
    .filter((m) => isDateBasis(m.basis) && Number.isFinite(m.percent) && Number.isFinite(m.days))
    .map((m) => ({ percent: Number(m.percent), days: Number(m.days), basis: m.basis! }));
  return {
    id: row.id,
    name: row.name,
    matchText: row.matchText,
    matchMode: row.matchMode === "CONTAINS" ? "CONTAINS" : "EXACT",
    milestones,
    active: row.active,
  };
}

export const loadRules = cache(async (): Promise<TermRule[]> => {
  const rows = await prisma.ptTermRule.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toTermRule);
});
