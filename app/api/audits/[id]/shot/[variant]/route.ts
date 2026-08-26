import fs from 'fs';

import { requireAuth } from '@/lib/auth';
import Service from '@/lib/audit/service';
import { shotPath } from '@/lib/audit/shot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VARIANTS = new Set(['desktop', 'desktop-full', 'mobile']);

/**
 * Serves one captured frame.
 *
 * Gated the same way the audit itself is: the caller needs the session and the
 * audit token, so a frame of a client's page is no more reachable than the
 * findings written about it.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; variant: string }> },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id, variant } = await ctx.params;
  if (!VARIANTS.has(variant)) {
    return new Response('Unknown frame', { status: 404 });
  }

  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!Service.find(id, token)) {
    return new Response('Audit not found', { status: 404 });
  }

  const file = shotPath(id, variant);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return new Response('No frame captured', { status: 404 });
  }

  const body = await fs.promises.readFile(file);
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(stat.size),
      // Frames are immutable once captured, but they are client material —
      // keep them out of shared caches.
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
