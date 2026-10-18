/** Which invoices belong to which upload, and so what deleting one removes. */
import { describe, expect, it } from "vitest";

import { uploadMembership, type InvoiceRef, type UploadRef } from "@/lib/payments/uploads";

const inv = (id: string, invoiceNo: string | null, customerName: string | null, extra: Partial<InvoiceRef> = {}): InvoiceRef => ({
  id, invoiceNo, customerName, source: "EXCEL", sourceFile: "a.xlsx", sourceRow: null, ...extra,
});
const up = (id: string, over: Partial<UploadRef>): UploadRef => ({
  id, fileName: "a.xlsx", customerName: "Alpha", created: [], updated: [], unchanged: [], ...over,
});

describe("upload membership", () => {
  const invoices = [
    inv("1", "PS/1", "Alpha"),
    inv("2", "PS/2", "Alpha"),
    inv("3", "PS/3", "Alpha"),
    inv("4", "PS/1", "Beta", { sourceFile: "b.xlsx" }), // same number, other customer
    inv("5", null, "Alpha", { sourceRow: 9 }),
    inv("6", "PS/6", "Alpha", { source: "MANUAL", sourceFile: null }),
  ];
  const uploads = [
    up("u1", { created: ["PS/1", "PS/2", "row 9"] }),
    // a refreshed sheet for the same customer touches PS/2 again and adds PS/3
    up("u2", { fileName: "a2.xlsx", created: ["PS/3"], updated: ["PS/2"], unchanged: [] }),
    up("u3", { fileName: "b.xlsx", customerName: "Beta", created: ["PS/1"] }),
  ];
  const m = uploadMembership(uploads, invoices);

  it("finds what each upload created, by customer and number", () => {
    expect(m.get("u1")!.created.sort()).toEqual(["1", "2", "5"]);
    expect(m.get("u3")!.created).toEqual(["4"]);
  });

  it("an invoice another upload also carries is shared, and kept", () => {
    expect(m.get("u1")!.exclusive.sort()).toEqual(["1", "5"]);
    expect(m.get("u1")!.shared).toEqual(["2"]);
  });

  it("an upload that only updated an invoice does not own it", () => {
    expect(m.get("u2")!.exclusive).toEqual(["3"]);
    expect(m.get("u2")!.touched.sort()).toEqual(["2", "3"]);
  });

  it("never claims a hand-typed invoice", () => {
    for (const v of m.values()) expect(v.touched).not.toContain("6");
  });

  it("still finds a renamed customer's invoices by the file they came from", () => {
    const renamed = [inv("1", "PS/1", "Alpha Ltd (renamed)")];
    expect(uploadMembership([up("u1", { created: ["PS/1"] })], renamed).get("u1")!.exclusive).toEqual(["1"]);
  });
});
