import { NextResponse } from "next/server";
import {
  reconcileSalesSince,
  summarizeCorrections,
} from "@/lib/dub/commission-corrections";

export const maxDuration = 60;

const LOOKBACK_MS = 48 * 60 * 60 * 1000;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * GET /api/cron/reconcile-commissions
 *
 * Retries Dub sales from the last 48 hours, including checkouts with no
 * discount code. Vercel Cron sends Authorization: Bearer CRON_SECRET.
 */
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await reconcileSalesSince(new Date(Date.now() - LOOKBACK_MS));
    return NextResponse.json({
      ok: true,
      ...summarizeCorrections(rows),
    });
  } catch (error) {
    console.error("[reconcile-commissions]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reconcile failed" },
      { status: 500 },
    );
  }
}
