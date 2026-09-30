/** IANA-зона по координатам; null — в этой точке зона неизвестна (например, открытый океан). */
export type ZoneLocator = (latitude: number, longitude: number) => Promise<string | null>;
