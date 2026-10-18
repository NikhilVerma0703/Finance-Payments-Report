/** The dashboard's or Search's current view, as the report workbook. */
import type { NextRequest } from "next/server";

import { download } from "@/server/payments/download";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return download(request.nextUrl.searchParams, "Payment Tracking — current view", "Payment_Tracking");
}
