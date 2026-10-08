import { NextResponse, type NextRequest } from "next/server";
import { syncFromSimpleFin } from "@/lib/sync";
import { getSetting, db } from "@/lib/db";
import { safeEqual } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron calls this once a day with "Authorization: Bearer $CRON_SECRET".
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await getSetting<string | null>("simplefin_access", null))) {
    return NextResponse.json({ skipped: "SimpleFIN not connected" });
  }
  try {
    const summary = await syncFromSimpleFin();
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    const sql = await db();
    await sql`insert into sync_log (ok, summary) values (false, ${sql.json({ error: String(e) })})`;
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
