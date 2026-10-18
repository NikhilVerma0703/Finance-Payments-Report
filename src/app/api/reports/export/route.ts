/** Reports & Downloads Sheets: the detailed report for the chosen filters. */
import type { NextRequest } from "next/server";

import { download } from "@/server/payments/download";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return download(request.nextUrl.searchParams, "Payment Tracking Report", "Payment_Tracking_Report");
}
