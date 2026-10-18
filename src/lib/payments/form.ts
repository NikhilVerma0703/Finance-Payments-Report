/**
 * The shape of every form in Payment Tracking.
 *
 * In its own module because a `"use server"` file may only export async
 * functions, and the form that renders a field and the action that saves it need
 * the same list — one definition, so a field cannot be added to a form and
 * silently dropped on save, or be writable by an action no form ever shows.
 *
 * These lists are also what `tests/payment-editing.test.ts` checks the database
 * schema against: every column of `PtInvoice`, `PtReceipt`, `PtNote` and
 * `PtCustomer` must appear in one of them, or be named in that test's short list
 * of deliberate exceptions. That is how "every field is editable" stays true as
 * the schema grows, rather than being true on the day it was written.
 */

/**
 * The invoice's own fields, in the groups every form shows them in — New
 * Record, EDIT OR ADD EXTRA INFORMATIONS and the invoice screen all render from
 * this one list, so a field cannot be on one form and missing from another.
 *
 * `key` is the record section the group sits under on the full forms, which
 * also carry Customer Details, Receipts and Credit/Debit Notes around these.
 */
export const INVOICE_FIELD_GROUPS = [
  {
    key: "invoice",
    title: "Invoice Details",
    hint: "",
    fields: [
      ["invoiceNo", "Invoice number", "text"],
      ["invoiceDate", "Invoice date", "date"],
      ["customerInvoiceValue", "Invoice value (FCY)", "number"],
      ["customsInvoiceValue", "Customs invoice value", "number"],
    ],
  },
  {
    key: "parties",
    title: "Parties and Country",
    hint: "Left blank, these fall back to the customer record.",
    fields: [
      ["consignee", "Consignee", "text"],
      ["notifyParty", "Notify party", "text"],
      ["country", "Country of destination", "text"],
    ],
  },
  {
    key: "terms",
    title: "Payment Terms and Dates",
    hint: "The due date is calculated from the terms and the date they count from. An entered due date overrides it.",
    fields: [
      ["paymentTerms", "Payment terms", "text"],
      ["enteredDueDate", "Due date (if known)", "date"],
      ["docsPresentedDate", "Documents presented on", "date"],
    ],
  },
  {
    key: "shipping",
    title: "Commercial and Shipping Information",
    hint: "",
    fields: [
      ["piNo", "PI number", "text"],
      ["poNo", "PO number", "text"],
      ["shippingBillNo", "Shipping bill number", "text"],
      ["shippingBillDate", "Shipping bill date", "date"],
      ["blNo", "BL number", "text"],
      ["blDate", "BL date", "date"],
      ["containerNo", "Container number", "text"],
      ["eta", "ETA / arrival date", "date"],
    ],
  },
  {
    key: "currency",
    title: "Currency and Exchange Rates",
    hint: "Rates are INR per one unit of the invoice currency.",
    fields: [
      ["currency", "Currency", "text"],
      ["exchangeRate", "Invoice exchange rate", "number"],
    ],
  },
  {
    key: "books",
    title: "Books and Customer Balances",
    hint: "Entered from the books or the customer's statement. Never part of the calculated balance — the difference is shown.",
    fields: [["booksBalance", "Balance as per books", "number"]],
  },
  {
    key: "remarks",
    title: "Remarks and Follow-up Notes",
    hint: "",
    fields: [
      ["remarks", "Remarks", "text"],
      ["followUpNotes", "Follow-up notes", "text"],
    ],
  },
] as const;

/** Every invoice field, flattened out of its groups. */
export const INVOICE_FIELDS: readonly string[] = INVOICE_FIELD_GROUPS.flatMap((g) =>
  g.fields.map(([key]) => key as string),
);

/**
 * The customer fields the full forms carry, saved on the customer record —
 * shared by every invoice of that customer. Named `customer.<field>` on a form.
 */
export const RECORD_CUSTOMER_FIELDS = [
  ["contact", "Contact", "text"],
  ["currency", "Default currency", "text"],
  ["defaultPaymentTerms", "Default payment terms", "text"],
  ["notes", "Customer notes", "text"],
] as const;

/** One receipt on the full forms: `r.<key>.<field>`. */
export const RECORD_RECEIPT_FIELDS = [
  ["receiptDate", "Receipt date", "date"],
  ["amountFcy", "Amount (FCY)", "number"],
  ["exchangeRate", "Receipt exchange rate", "number"],
  ["bankRef", "Bank reference", "text"],
  ["remarks", "Remarks", "text"],
] as const;

/** One credit or debit note on the full forms: `n.<key>.<field>`. */
export const RECORD_NOTE_FIELDS = [
  ["noteType", "Type", "text"],
  ["noteNo", "Note number", "text"],
  ["noteDate", "Note date", "date"],
  ["amount", "Amount (FCY)", "number"],
  ["reason", "Reason", "text"],
] as const;

/** One receipt's editable fields, in the order the inline row shows them. */
export const RECEIPT_FIELDS = [
  "receiptDate",
  "amountFcy",
  "exchangeRate",
  "bankRef",
  "remarks",
] as const;

/** One credit or debit note's editable fields. */
export const NOTE_FIELDS = ["noteType", "noteNo", "noteDate", "amount", "reason"] as const;

/** The customer record's editable fields. */
export const CUSTOMER_FIELDS = [
  "name",
  "country",
  "currency",
  "defaultPaymentTerms",
  "consignee",
  "notifyParty",
  "contact",
  "notes",
] as const;

export const NUMBER_FIELDS = new Set([
  "customerInvoiceValue",
  "customsInvoiceValue",
  "exchangeRate",
  "booksBalance",
  "amountFcy",
  "amount",
]);

export const DATE_FIELDS = new Set([
  "invoiceDate",
  "enteredDueDate",
  "docsPresentedDate",
  "shippingBillDate",
  "blDate",
  "eta",
  "receiptDate",
  "noteDate",
]);

/**
 * Every field's name as a person reads it.
 *
 * Used for the correction history, which stores the label alongside the change
 * so the history stays readable even after a label is reworded. Built from the
 * invoice groups so the two can never drift, with the receipt, note and customer
 * fields added on.
 */
export const INVOICE_LABELS: Record<string, string> = {
  ...Object.fromEntries(
    INVOICE_FIELD_GROUPS.flatMap((g) => g.fields.map(([key, label]) => [key, label])),
  ),
  customerId: "Customer",
  seq: "Receipt number",
  receiptDate: "Receipt date",
  amountFcy: "Receipt amount (FCY)",
  bankRef: "Bank reference",
  noteType: "Note type",
  noteNo: "Note number",
  noteDate: "Note date",
  amount: "Note amount",
  reason: "Reason",
  name: "Customer name",
  defaultPaymentTerms: "Default payment terms",
  contact: "Contact",
  notes: "Notes",
};
