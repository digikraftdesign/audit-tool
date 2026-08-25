import fs from 'fs';
import path from 'path';
import {
  assertSameOrigin,
  jsonFail,
  jsonOk,
  requireAuth,
} from '@/lib/auth';
import { config } from '@/lib/config';
import { run } from '@/lib/db';
import { clientIp, now, pruneUploads, storagePath, token } from '@/lib/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const originFail = assertSameOrigin(req);
  if (originFail) return originFail;

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonFail('No file was received.');
  }

  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return jsonFail('No file was received.');
  }

  const max = Number(config('upload.max_bytes', 20 * 1024 * 1024));
  if (file.size > max) {
    return jsonFail(
      `The file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${Math.round(max / 1048576)} MB.`,
    );
  }

  const name = file.name || 'upload';
  const ext = path.extname(name).replace(/^\./, '').toLowerCase();
  const allowed = config('upload.extensions', [
    'pdf',
    'docx',
    'pptx',
    'txt',
    'md',
    'html',
    'htm',
  ]) as string[];
  if (!allowed.includes(ext)) {
    return jsonFail(`Only ${allowed.join(', ')} files can be audited.`);
  }

  const dir = storagePath('uploads');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return jsonFail('The uploads folder is not writable on this server.', 500);
    }
  }
  pruneUploads();

  const uploadId = token(16);
  const stored = `${uploadId}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    fs.writeFileSync(path.join(dir, stored), buf, { mode: 0o640 });
  } catch {
    return jsonFail('The file could not be saved on this server.', 500);
  }

  const mime = file.type || '';
  run(
    'INSERT INTO dk_uploads (id, stored, name, mime, bytes, created_at, client_ip) VALUES (?,?,?,?,?,?,?)',
    [
      uploadId,
      stored,
      name.slice(0, 240),
      mime,
      file.size,
      now(),
      clientIp(req.headers),
    ],
  );

  return jsonOk({
    upload_id: uploadId,
    name,
    bytes: file.size,
    mime,
  });
}
