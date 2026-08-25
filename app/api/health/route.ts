import fs from 'fs';
import { driver, getDb } from '@/lib/db';
import { jsonOk } from '@/lib/auth';
import { requireAuth } from '@/lib/auth';
import { storagePath } from '@/lib/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const storage = storagePath();
  const uploads = storagePath('uploads');
  const checks: Record<string, unknown> = {
    node: process.version,
    runtime: 'nodejs',
    db: false as string | boolean,
    writable: false,
    uploads: false,
    zlib: true,
  };

  try {
    checks.writable = fs.existsSync(storage)
      ? (() => {
          try {
            fs.accessSync(storage, fs.constants.W_OK);
            return true;
          } catch {
            return false;
          }
        })()
      : false;
    checks.uploads = fs.existsSync(uploads)
      ? (() => {
          try {
            fs.accessSync(uploads, fs.constants.W_OK);
            return true;
          } catch {
            return false;
          }
        })()
      : checks.writable;

    getDb();
    checks.db = driver();
  } catch (e) {
    checks.db_error = e instanceof Error ? e.message : String(e);
  }

  return jsonOk({ checks });
}
