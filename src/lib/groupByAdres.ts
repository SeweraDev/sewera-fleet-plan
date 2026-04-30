// Grupowanie WZ po adresie / lokalizacji.
// Klucz: gdy mamy współrzędne (lat/lng z geocodingu) — zaokrąglone do 4 miejsc
// (~11 m precyzja, łapie drobne różnice zapisu adresu typu "ul. Marszałka
// Piłsudskiego 59" vs "Piłsudskiego 59"). Gdy brak współrzędnych — fallback
// na znormalizowany adres (trim + lowercase + collapse spacji).
//
// Używane w widoku kursu (Dashboard) i karcie drogowej.

export function normAdres(a: string | null | undefined): string {
  return (a || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Klucz grupy. Preferuje lat/lng (po geocodingu), fallback do adresu. */
export function groupKey(item: {
  adres: string | null | undefined;
  lat?: number | null;
  lng?: number | null;
}): string {
  if (item.lat != null && item.lng != null) {
    // 4 miejsca po przecinku ≈ 11 m precyzja
    return `${item.lat.toFixed(4)},${item.lng.toFixed(4)}`;
  }
  return normAdres(item.adres);
}
