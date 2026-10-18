/**
 * The correction history for Payment Tracking.
 *
 * One rule, and the whole point of this file: **every write in this section goes
 * through `recordEdits`.** Not because an audit trail is a nice feature, but
 * because of what this section's data is — about half of it arrives from a
 * customer's own spreadsheet, and the moment somebody corrects one of those
 * figures by hand there is otherwise no way to tell the two apart. "Received
 * 59,651.63" means something quite different depending on whether the customer
 * said it or we did.
 *
 * So the history records the field, what it was, what it became, and
 * `recordSource` — whether the record it sits on came from an upload or was
 * typed. That is enough for a screen to say *the uploaded sheet said 26,756.27*
 * beside a figure somebody has since changed.
 *
 * It is deliberately not a generic ORM hook. A diff is computed from the row as
 * it was and the row as it will be, by the action that is making the change,
 * because only the action knows which fields the form actually offered — and a
 * field the form did not show must never be recorded as having been cleared.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { LOCAL_USER } from "@/lib/session";

export type PtEntity = "INVOICE" | "RECEIPT" | "NOTE" | "CUSTOMER";

export interface FieldChange {
  fieldKey: string;
  label: string;
  from: string | null;
  to: string | null;
}

/**
 * How a stored value reads in the history.
 *
 * Dates become plain `YYYY-MM-DD` and numbers lose their trailing zeros, so
 * "changed 26756.27 → 26756.27" can never appear because one side came back from
 * SQLite as a `Date` and the other was typed as a string.
 */
export function asText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

/**
 * What changed between the row as it is and the values being written.
 *
 * Only keys present in `next` are compared. A form that did not offer a field
 * does not put it in `next`, so that field cannot appear in the history and
 * cannot be written — see `onlyOffered` below, which is the other half of the
 * same guarantee.
 */
export function diffFields(
  before: Record<string, unknown>,
  next: Record<string, unknown>,
  labels: Record<string, string> = {},
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [fieldKey, raw] of Object.entries(next)) {
    const from = asText(before[fieldKey]);
    const to = asText(raw);
    if (from === to) continue;
    out.push({ fieldKey, label: labels[fieldKey] ?? fieldKey, from, to });
  }
  return out;
}

/**
 * Keep only the fields a form actually carried.
 *
 * This is the fix for a whole class of quiet data loss: an inline edit row that
 * shows four of a receipt's five fields, submitted, used to write `null` over
 * the fifth — because "absent from the form" and "cleared by the user" look
 * identical in a `FormData`. They are told apart here: a field is written only
 * if its input was present, and an input that was present but empty still
 * clears, which is what somebody deleting a wrong date expects.
 *
 * @param offered the input names the submitted form actually contained
 */
export function onlyOffered<T extends Record<string, unknown>>(
  values: T,
  offered: ReadonlySet<string>,
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(values) as Array<keyof T & string>) {
    if (offered.has(key)) out[key] = values[key];
  }
  return out;
}

/** Which input names a submitted form actually contained. */
export function offeredIn(form: FormData, candidates: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const key of candidates) if (form.has(key)) out.add(key);
  return out;
}

/** Write a set of changes to the history. Nothing is written for no changes. */
export async function recordEdits(args: {
  entity: PtEntity;
  entityId: string;
  invoiceId?: string | null;
  customerId?: string | null;
  /** MANUAL | EXCEL — the record's own origin, at the time of this edit. */
  recordSource?: string | null;
  changes: FieldChange[];
}): Promise<void> {
  if (args.changes.length === 0) return;

  await prisma.ptFieldEdit.createMany({
    data: args.changes.map((c) => ({
      entity: args.entity,
      entityId: args.entityId,
      invoiceId: args.invoiceId ?? null,
      customerId: args.customerId ?? null,
      fieldKey: c.fieldKey,
      label: c.label,
      oldValue: c.from,
      newValue: c.to,
      recordSource: args.recordSource ?? null,
      editedBy: LOCAL_USER.name,
    })),
  });
}

/**
 * Record the creation of a receipt or a note.
 *
 * Written as changes from nothing, so "Receipt 3 added, amount 15,000" and
 * "Receipt 3 amount changed to 15,000" sit in one list in the order they
 * happened, rather than an addition being invisible.
 */
export async function recordCreation(args: {
  entity: PtEntity;
  entityId: string;
  invoiceId?: string | null;
  customerId?: string | null;
  recordSource?: string | null;
  values: Record<string, unknown>;
  labels?: Record<string, string>;
}): Promise<void> {
  const changes = diffFields({}, args.values, args.labels ?? {}).filter((c) => c.to !== null);
  await recordEdits({ ...args, changes });
}

export interface HistoryEntry {
  id: string;
  entity: string;
  entityId: string;
  fieldKey: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
  recordSource: string | null;
  editedBy: string;
  at: string;
}

export interface History {
  entries: HistoryEntry[];
  /**
   * For each field, the value the uploaded sheet supplied — the `oldValue` of
   * the earliest edit on a record that came from an upload. This is what lets a
   * screen show what was overwritten without keeping a second copy of the data.
   */
  imported: Record<string, string | null>;
}

const EMPTY: History = { entries: [], imported: {} };

/** One invoice's history: its own fields, its receipts' and its notes'. */
export async function invoiceHistory(invoiceId: string): Promise<History> {
  const rows = await prisma.ptFieldEdit.findMany({
    where: { invoiceId },
    orderBy: { createdAt: "desc" },
  });
  return shape(rows);
}

/** One customer's history. */
export async function customerHistory(customerId: string): Promise<History> {
  const rows = await prisma.ptFieldEdit.findMany({
    where: { customerId, entity: "CUSTOMER" },
    orderBy: { createdAt: "desc" },
  });
  return shape(rows);
}

type Row = {
  id: string;
  entity: string;
  entityId: string;
  fieldKey: string;
  label: string | null;
  oldValue: string | null;
  newValue: string | null;
  recordSource: string | null;
  editedBy: string;
  createdAt: Date;
};

function shape(rows: Row[]): History {
  if (rows.length === 0) return EMPTY;

  const entries: HistoryEntry[] = rows.map((r) => ({
    id: r.id,
    entity: r.entity,
    entityId: r.entityId,
    fieldKey: r.fieldKey,
    label: r.label ?? r.fieldKey,
    oldValue: r.oldValue,
    newValue: r.newValue,
    recordSource: r.recordSource,
    editedBy: r.editedBy,
    at: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
  }));

  // rows arrive newest first, so the last one seen for a field is the earliest
  const imported: Record<string, string | null> = {};
  for (const r of rows) {
    if (r.entity !== "INVOICE" || r.recordSource !== "EXCEL") continue;
    imported[r.fieldKey] = r.oldValue;
  }

  return { entries, imported };
}
