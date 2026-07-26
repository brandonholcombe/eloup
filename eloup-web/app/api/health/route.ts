import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    db().prepare('SELECT 1').get();
    // Temporary memory probe (diag-mem-probe.md) — gated so the default
    // response stays { ok: true }. Enable via DIAG_MEM in the configmap.
    if (process.env.DIAG_MEM) {
      const m = process.memoryUsage();
      return NextResponse.json({
        ok: true,
        uptime_s: Math.round(process.uptime()),
        mem: {
          rss: m.rss,
          heapUsed: m.heapUsed,
          heapTotal: m.heapTotal,
          external: m.external,
          arrayBuffers: m.arrayBuffers,
        },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
