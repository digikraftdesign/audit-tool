import { timingSafeEqual } from 'crypto';
import {
  assertSameOrigin,
  getSession,
  jsonFail,
  jsonOk,
  readJsonBody,
} from '@/lib/auth';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export async function POST(req: Request) {
  const originFail = assertSameOrigin(req);
  if (originFail) return originFail;

  const code = String(config('passcode', '') ?? '');
  if (code === '') {
    return jsonOk({ authorised: true });
  }

  const body = await readJsonBody(req);
  const given = String(body.passcode ?? '');
  if (!safeEqual(code, given)) {
    await new Promise((r) => setTimeout(r, 400));
    return jsonFail('That passcode did not match.', 401);
  }

  const session = await getSession();
  session.authorised = true;
  await session.save();
  return jsonOk({ authorised: true });
}
