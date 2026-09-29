import type { ZoneLocator } from '../../ports/geo.ts';

/**
 * Зона по координатам офлайн (@photostructure/tz-lookup, ~90 КБ).
 * Импорт динамический: нужен только при онбординге и не утяжеляет обработку кнопок.
 */
export const tzLookup: ZoneLocator = async (latitude, longitude) => {
  const { default: lookup } = await import('@photostructure/tz-lookup');
  try {
    return lookup(latitude, longitude);
  } catch {
    return null;
  }
};
