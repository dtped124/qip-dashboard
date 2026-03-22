import { db } from './schema';
import { INDICATOR_META } from '../constants';

export async function seedPresetIndicators(): Promise<void> {
  const count = await db.indicators.count();
  if (count > 0) return;

  const records = Object.entries(INDICATOR_META).map(([code, meta]) => ({
    code,
    ...meta,
  }));

  await db.indicators.bulkAdd(records);
}
