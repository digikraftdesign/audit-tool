import AuditApp from '@/components/AuditApp';
import { Types } from '@/lib/audit/types';
import { isAuthorised } from '@/lib/auth';
import { config } from '@/lib/config';
import type { BootConfig, TypesMap } from '@/components/audit/clientTypes';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const passcode = String(config('passcode', '') ?? '');
  const authorised = await isAuthorised();
  const needPasscode = passcode !== '' && !authorised;

  const all = Types.all();
  const types: TypesMap = {};
  for (const [id, t] of Object.entries(all)) {
    types[id] = {
      ...t,
      fields: Types.fields(id),
    };
  }

  const boot: BootConfig = {
    needPasscode,
    brand: String(config('brand_short', 'DigiKraft') ?? 'DigiKraft'),
    maxUpload: Number(config('upload.max_bytes', 20 * 1024 * 1024)),
    landingKicker: process.env.LANDING_KICKER || 'Money Expo India 2026',
  };

  return <AuditApp boot={boot} types={types} />;
}
