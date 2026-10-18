/**
 * Reading the full record form — New Record and EDIT OR ADD EXTRA INFORMATIONS.
 *
 * Both forms post the same names, and this one parser reads them, so the two
 * cannot drift apart in what they accept or how they read it:
 *
 *   <invoice field>            invoiceNo, blDate, … — see INVOICE_FIELD_GROUPS
 *   customerId / customerName  pick a customer, or type a new one
 *   customer.<field>           contact, currency, defaultPaymentTerms, notes
 *   r.<key>.<field>            one receipt; <key> is its id, or new1, new2, …
 *   r.<key>.delete = 1         remove that stored receipt
 *   n.<key>.<field>            one credit or debit note, the same way
 *
 * No field is required. A blank box clears its value; a box the form did not
 * show leaves its value alone. What *is* refused is something typed that cannot
 * be read — "12,3a" in an amount, "31/02/2026" in a date — because saving it as
 * blank would silently throw away what the person meant.
 */
import { toIsoDate, toNumber } from "../text";
import {
  DATE_FIELDS,
  INVOICE_FIELD_GROUPS,
  INVOICE_FIELDS,
  NUMBER_FIELDS,
  RECORD_CUSTOMER_FIELDS,
  RECORD_NOTE_FIELDS,
  RECORD_RECEIPT_FIELDS,
} from "./form";

export type FieldValue = string | number | null;

export interface ParsedLine {
  /** The stored id, or null for a line being added. */
  id: string | null;
  /** The form's key for the line: the id, or new1, new2, … */
  key: string;
  remove: boolean;
  /** Only the fields the form carried; dates as YYYY-MM-DD. */
  values: Record<string, FieldValue>;
  /** True when something was typed into a new line. */
  hasContent: boolean;
}

export interface ParsedRecord {
  invoice: Record<string, FieldValue>;
  customer: {
    /** Whether the form offered the customer choice at all. */
    offered: boolean;
    pickedId: string | null;
    typedName: string | null;
    fields: Record<string, FieldValue>;
  };
  receipts: ParsedLine[];
  notes: ParsedLine[];
  errors: string[];
}

const INVOICE_LABEL: Record<string, string> = Object.fromEntries(
  INVOICE_FIELD_GROUPS.flatMap((g) => g.fields.map(([k, l]) => [k, l])),
);

function raw(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** One value, read by its type; a reason when it cannot be read. */
export function readValue(
  text: string | null,
  field: string,
): { value: FieldValue; error: string | null } {
  if (text === null) return { value: null, error: null };
  if (NUMBER_FIELDS.has(field)) {
    const n = toNumber(text);
    return n === null
      ? { value: null, error: `"${text}" is not a number` }
      : { value: n, error: null };
  }
  if (DATE_FIELDS.has(field)) {
    const iso = toIsoDate(text);
    return iso ? { value: iso, error: null } : { value: null, error: `"${text}" is not a date` };
  }
  return { value: text, error: null };
}

function lines(
  form: FormData,
  prefix: "r" | "n",
  fields: ReadonlyArray<readonly [string, string, string]>,
  noun: string,
  errors: string[],
): ParsedLine[] {
  const keys: string[] = [];
  for (const name of form.keys()) {
    const m = new RegExp(`^${prefix}\\.([A-Za-z0-9_-]+)\\.`).exec(name);
    if (m && !keys.includes(m[1])) keys.push(m[1]);
  }

  return keys.map((key, index) => {
    const isNew = /^new\d*$/.test(key);
    const values: Record<string, FieldValue> = {};
    for (const [field, label] of fields) {
      const name = `${prefix}.${key}.${field}`;
      if (!form.has(name)) continue;
      const { value, error } = readValue(raw(form, name), field);
      if (error) errors.push(`${noun} ${index + 1}, ${label.toLowerCase()}: ${error}.`);
      values[field] = value;
    }
    if ("noteType" in values) values.noteType = values.noteType === "DEBIT" ? "DEBIT" : "CREDIT";
    const typed = Object.entries(values).some(([k, v]) => k !== "noteType" && v !== null);
    return {
      id: isNew ? null : key,
      key,
      remove: !isNew && form.get(`${prefix}.${key}.delete`) === "1",
      values,
      hasContent: typed,
    };
  });
}

export function parseRecordForm(form: FormData): ParsedRecord {
  const errors: string[] = [];

  const invoice: Record<string, FieldValue> = {};
  for (const field of INVOICE_FIELDS) {
    if (!form.has(field)) continue;
    const { value, error } = readValue(raw(form, field), field);
    if (error) errors.push(`${INVOICE_LABEL[field] ?? field}: ${error}.`);
    invoice[field] = value;
  }

  const customerFields: Record<string, FieldValue> = {};
  for (const [field, label] of RECORD_CUSTOMER_FIELDS) {
    const name = `customer.${field}`;
    if (!form.has(name)) continue;
    const { value, error } = readValue(raw(form, name), field);
    if (error) errors.push(`${label}: ${error}.`);
    customerFields[field] = value;
  }
  if (typeof customerFields.currency === "string") {
    customerFields.currency = customerFields.currency.toUpperCase();
  }
  if (typeof invoice.currency === "string") invoice.currency = invoice.currency.toUpperCase();

  return {
    invoice,
    customer: {
      offered: form.has("customerId") || form.has("customerName"),
      pickedId: raw(form, "customerId"),
      typedName: raw(form, "customerName"),
      fields: customerFields,
    },
    receipts: lines(form, "r", RECORD_RECEIPT_FIELDS, "Receipt", errors),
    notes: lines(form, "n", RECORD_NOTE_FIELDS, "Note", errors),
    errors,
  };
}

/** Squashed for matching a typed customer name: case and spacing ignored. */
export function nameKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
