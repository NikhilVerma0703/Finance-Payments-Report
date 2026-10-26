/**
 * The application's shape: a standalone Finance Reports with exactly six
 * sections, nothing left over from the Accounts ERP, and each section where the
 * brief put it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { APP_NAME } from "@/lib/config";
import { activeNav, NAV } from "@/lib/modules";

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

function files(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    return statSync(path.join(root, rel)).isDirectory() ? files(rel) : [rel];
  });
}
const SOURCE = files("src").filter((f) => /\.(ts|tsx)$/.test(f));

describe("eight sections, in order", () => {
  it("the navigation is exactly the eight sections", () => {
    expect(NAV.map((n) => n.label)).toEqual([
      "Dashboard",
      "Master Table",
      "Completed Invoices",
      "Search Invoices",
      "Upload Sheet",
      "New Record",
      "Reports & Downloads Sheets",
      "Settings & Rules",
    ]);
  });

  it("every section has a page", () => {
    for (const n of NAV) {
      const page = n.href === "/" ? "src/app/(app)/page.tsx" : `src/app/(app)${n.href}/page.tsx`;
      expect(existsSync(path.join(root, page)), page).toBe(true);
    }
  });

  it("the invoice and customer screens sit under the dashboard", () => {
    expect(activeNav("/invoice/abc")).toBe("dashboard");
    expect(activeNav("/customer/abc")).toBe("dashboard");
    expect(activeNav("/reports")).toBe("reports");
    expect(activeNav("/settings")).toBe("settings");
  });

  it("is called Finance Reports", () => {
    expect(APP_NAME).toBe("Finance Reports");
  });
});

describe("nothing of the Accounts ERP is left", () => {
  it("no register, extraction, Tally or Inngest code", () => {
    for (const gone of [
      "src/lib/extraction", "src/lib/business", "src/lib/normalize", "src/server/exporter.ts",
      "src/server/tally.ts", "src/inngest", "src/app/(app)/invoices", "src/app/(app)/receipts",
      "src/app/(app)/tally", "src/app/(app)/payment-tracking",
    ]) {
      expect(existsSync(path.join(root, gone)), gone).toBe(false);
    }
  });

  it("no old address is linked", () => {
    for (const f of SOURCE) expect(read(f), f).not.toMatch(/\/payment-tracking/);
  });

  it("the schema holds only the payment tables", () => {
    const models = [...read("prisma/schema.prisma").matchAll(/^model (\w+)/gm)].map((m) => m[1]);
    expect(models.every((m) => m.startsWith("Pt"))).toBe(true);
  });

  it("the dependencies are the original stack, minus what only the ERP used", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies.next).toBe("15.5.25");
    expect(pkg.dependencies["@prisma/client"]).toBe("6.19.3");
    expect(pkg.dependencies.exceljs).toBe("4.4.0");
    for (const gone of ["inngest", "pdfjs-dist", "zod"]) expect(pkg.dependencies[gone]).toBeUndefined();
  });
});

describe("each section has what the brief asked for", () => {
  it("the dashboard has no filter form, and the customer summary sits right below the KPIs", () => {
    const page = read("src/app/(app)/page.tsx");
    expect(page).not.toContain("<Filters");
    const summary = page.indexOf("<CustomerSummary");
    expect(summary).toBeGreaterThan(page.indexOf("<Dashboard"));
    expect(summary).toBeLessThan(page.indexOf("<AgeingSummary"));
    // the master table is a section of its own now, after the dashboard
    expect(page).not.toContain("<MasterTable");
    expect(read("src/app/(app)/master/page.tsx")).toContain("<MasterTable");
  });

  it("Search Invoices has the filters, with Apply and Reset", () => {
    expect(read("src/app/(app)/search/page.tsx")).toContain("<Filters");
    const filters = read("src/components/tracking/Filters.tsx");
    expect(filters).toContain(">\n              Apply");
    expect(filters).toContain(">\n              Reset");
  });

  it("the master table puts the invoice number before the customer", () => {
    const table = read("src/components/tracking/MasterTable.tsx");
    expect(table.indexOf('label: "Invoice No."')).toBeLessThan(table.indexOf('label: "Customer"'));
  });

  it("Upload Sheet offers EDIT OR ADD EXTRA INFORMATIONS and deletion", () => {
    const upload = read("src/app/(app)/upload/page.tsx");
    expect(upload).toContain("EDIT OR ADD EXTRA INFORMATIONS");
    expect(upload).toContain("deleteInvoiceAction");
    expect(upload).toContain("deleteUploadAction");
    expect(read("src/app/(app)/invoice/[id]/page.tsx")).toContain("EDIT OR ADD EXTRA INFORMATIONS");
  });

  it("Payment terms recognised moved from Upload Sheet to Settings & Rules", () => {
    expect(read("src/app/(app)/upload/page.tsx")).not.toContain("SUPPORTED_TERMS");
    expect(read("src/app/(app)/settings/page.tsx")).toContain("Payment terms recognised");
  });

  it("Reports has an Export Sheet button", () => {
    expect(read("src/app/(app)/reports/page.tsx")).toContain("Export Sheet");
  });

  it("every 'use server' file exports only async functions", () => {
    for (const f of SOURCE) {
      const src = read(f);
      if (!/^"use server";/m.test(src)) continue;
      const exported = [...src.matchAll(/^export (?!async function|interface|type)(\w+)/gm)];
      expect(exported.map((m) => m[0]), f).toEqual([]);
    }
  });
});
