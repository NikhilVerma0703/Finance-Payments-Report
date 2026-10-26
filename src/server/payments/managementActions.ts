"use server";

/**
 * The writes behind the dashboard's working lists and the completed-invoices
 * section (owner, 25–26 Oct 2026):
 *
 *   markCompletedAction  mark the ticked invoices completed and move them out
 *                        of the active lists — only a fully settled one can be;
 *   restoreActiveAction  put completed invoices back in the active lists;
 *   saveFollowUpAction   save where chasing a customer stands — the status, the
 *                        next action and its date.
 *
 * Nothing is deleted from an invoice and no figure changes; every mark, restore
 * and follow-up change is in the correction history. Each goes back to the
 * screen the form was on (`returnTo`) with what it did in `?done=`.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { isSettled } from "@/lib/payments/completed";
import { FOLLOW_UP_STATUS, isFollowUpStatus, type FollowUpStatus } from "@/lib/payments/management";
import { ROUTES } from "@/lib/routes";
import { LOCAL_USER } from "@/lib/session";
import { recordEdits } from "@/server/payments/audit";
import { loadTracking } from "@/server/payments/query";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** Back to the screen the form was on, with a message for it to show. */
function back(form: FormData, fallback: string, message: string): never {
  revalidatePath("/", "layout");
  const raw = text(form, "returnTo");
  const to = raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
  const [rawPath, hash] = to.split("#");
  const path = rawPath.replace(/[?&]$/, "");
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}done=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`);
}

/** The invoices a form names, once each (a checkbox per invoice, or one hidden field). */
function chosenIds(form: FormData): string[] {
  return [...new Set(form.getAll("id").map(String).filter(Boolean))];
}

export async function markCompletedAction(form: FormData): Promise<void> {
  const ids = chosenIds(form);
  if (!ids.length) back(form, ROUTES.masterTable, "Tick at least one invoice first.");
  const note = text(form, "note") || null;
  // settled is worked out on read: judge each as every screen reads it
  const { invoices } = await loadTracking();
  const chosen = invoices.filter((i) => ids.includes(i.id));
  const settled = chosen.filter(isSettled);
  if (!settled.length) {
    back(
      form,
      ROUTES.masterTable,
      chosen.length
        ? `None of the ${chosen.length} ticked invoice(s) is fully settled — only a settled invoice can be completed.`
        : "Those invoices are completed already.",
    );
  }
  for (const i of settled) {
    await prisma.ptCompleted.upsert({
      where: { invoiceId: i.id },
      create: { invoiceId: i.id, completedByName: LOCAL_USER.name, note },
      update: {},
    });
    await recordEdits({
      entity: "INVOICE",
      entityId: i.id,
      invoiceId: i.id,
      customerId: i.customerId,
      recordSource: i.source,
      changes: [{ fieldKey: "completed", label: "Completed", from: null, to: note ? `Marked completed — ${note}` : "Marked completed" }],
    });
  }
  const open = chosen.length - settled.length;
  back(
    form,
    ROUTES.completed,
    `${settled.length} invoice(s) marked completed and moved to Completed invoices.${open ? ` ${open} not fully settled were left as they are.` : ""}`,
  );
}

export async function restoreActiveAction(form: FormData): Promise<void> {
  const ids = chosenIds(form);
  if (!ids.length) back(form, ROUTES.completed, "Tick at least one invoice first.");
  const { invoices, completed } = await loadTracking();
  const chosen = [...completed, ...invoices].filter((i) => ids.includes(i.id) && i.completion);
  for (const i of chosen) {
    await prisma.ptCompleted.deleteMany({ where: { invoiceId: i.id } });
    await recordEdits({
      entity: "INVOICE",
      entityId: i.id,
      invoiceId: i.id,
      customerId: i.customerId,
      recordSource: i.source,
      changes: [{ fieldKey: "completed", label: "Completed", from: "Marked completed", to: "Restored to active" }],
    });
  }
  back(form, ROUTES.completed, chosen.length ? `${chosen.length} invoice(s) restored to the active lists.` : "None of those invoices was completed.");
}

export async function saveFollowUpAction(form: FormData): Promise<void> {
  const fallback = `${ROUTES.dashboard}#follow-ups`;
  const customerId = text(form, "customerId");
  if (!customerId) back(form, fallback, "No customer was named.");
  const status = text(form, "status");
  if (!isFollowUpStatus(status)) back(form, fallback, "Pick a follow-up status.");
  const nextAction = text(form, "nextAction").slice(0, 500) || null;
  const nextDate = text(form, "nextDate") || null;
  if (nextDate && (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || Number.isNaN(Date.parse(nextDate)))) {
    back(form, fallback, "The next action date is not a date.");
  }
  const customer = await prisma.ptCustomer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) back(form, fallback, "That customer no longer exists.");

  const before = await prisma.ptFollowUp.findUnique({ where: { customerId } });
  const was = {
    status: (before && isFollowUpStatus(before.status) ? before.status : "NOT_STARTED") as FollowUpStatus,
    nextAction: before?.nextAction ?? null,
    nextDate: before?.nextDate ? before.nextDate.toISOString().slice(0, 10) : null,
  };
  const changes = [
    was.status !== status && { fieldKey: "followUpStatus", label: "Follow-up status", from: FOLLOW_UP_STATUS[was.status], to: FOLLOW_UP_STATUS[status as FollowUpStatus] },
    was.nextAction !== nextAction && { fieldKey: "followUpAction", label: "Next action", from: was.nextAction, to: nextAction },
    was.nextDate !== nextDate && { fieldKey: "followUpDate", label: "Next action date", from: was.nextDate, to: nextDate },
  ].filter((c): c is { fieldKey: string; label: string; from: string | null; to: string | null } => Boolean(c));
  if (!changes.length) back(form, fallback, "Nothing changed.");

  const data = {
    status,
    nextAction,
    nextDate: nextDate ? new Date(`${nextDate}T00:00:00.000Z`) : null,
    updatedByName: LOCAL_USER.name,
  };
  await prisma.ptFollowUp.upsert({ where: { customerId }, create: { customerId, ...data }, update: data });
  await recordEdits({ entity: "CUSTOMER", entityId: customerId, customerId, changes });
  back(form, fallback, "Follow-up saved.");
}
