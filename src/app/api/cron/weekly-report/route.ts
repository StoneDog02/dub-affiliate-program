import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { denverHour } from "@/lib/triplewhale/weeklyReportPeriod";
import {
  buildWeeklyReport,
  postSlackPayload,
  postWeeklyReportFailure,
} from "@/lib/triplewhale/weeklyReport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || !header) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}

/**
 * GET /api/cron/weekly-report
 *
 * Vercel Cron hits this Monday at 14:00 UTC and again at 15:00 UTC. The
 * handler posts only when it is 8:00 in America/Denver, so daylight saving
 * does not double-post.
 *
 * ?preview=1 returns the Block Kit payload and does not post.
 * ?preview=1&post=1 posts that payload immediately.
 */
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const preview = url.searchParams.get("preview") === "1";
  const post = url.searchParams.get("post") === "1";
  const shouldPost = !preview || post;

  if (!preview && denverHour(new Date()) !== 8) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    const payload = await buildWeeklyReport(new Date());
    if (!shouldPost) return NextResponse.json(payload);

    await postSlackPayload(payload);
    if (preview) return NextResponse.json({ posted: true, ...payload });
    return NextResponse.json({ ok: true, posted: true });
  } catch (error) {
    console.error(
      "[weekly-report]",
      error instanceof Error ? error.message : "failed",
    );

    if (shouldPost) {
      try {
        await postWeeklyReportFailure();
      } catch (postError) {
        console.error(
          "[weekly-report] failure notice was not posted",
          postError instanceof Error ? postError.name : "failed",
        );
      }
    }

    return NextResponse.json(
      { error: "Weekly report failed to generate" },
      { status: 500 },
    );
  }
}
