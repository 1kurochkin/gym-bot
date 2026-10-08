import type { ZoneLocator } from '../../ports/geo.ts';

export const tzLookup: ZoneLocator = async (latitude, longitude) => {
  const { default: lookup } = await import('@photostructure/tz-lookup');
  try {
    return lookup(latitude, longitude);
  } catch {
    return null;
  }
};
