// Helpery do przekazywania zleceń między oddziałami.
// Numer zlecenia ma format ZL-KAT/26/04/001 — kod oddziału po ZL- pozostaje
// nawet po przekazaniu, więc służy jako wskaźnik "pierwotnego" oddziału.

const ODDZIAL_KOD: Record<string, string> = {
  'Katowice': 'KAT',
  'Sosnowiec': 'SOS',
  'Gliwice': 'GL',
  'T.Góry': 'TG',
  'Tarnowskie Góry': 'TG',
  'Chrzanów': 'CH',
  'D.Górnicza': 'DG',
  'Dąbrowa Górnicza': 'DG',
  'Oświęcim': 'OS',
  'Redystrybucja': 'R',
};

export function getKodOddzialu(nazwa: string | null | undefined): string {
  if (!nazwa) return '';
  return ODDZIAL_KOD[nazwa] || '';
}

/** Wyciąga kod oddziału z numeru zlecenia (np. "ZL-KAT/26/04/001" → "KAT"). */
export function parseKodZNumer(numer: string | null | undefined): string {
  if (!numer) return '';
  const m = numer.match(/^ZL-([A-Z]+)\//);
  return m ? m[1] : '';
}

/** Czy zlecenie zostało przekazane do innego oddziału (kod z numeru ≠ kod aktualnego oddziału). */
export function isPrzekazane(numer: string | null | undefined, aktualnyOddzialNazwa: string | null | undefined): boolean {
  const zNumer = parseKodZNumer(numer);
  const aktualny = getKodOddzialu(aktualnyOddzialNazwa);
  return !!zNumer && !!aktualny && zNumer !== aktualny;
}

/** Krótki dopisek audit do uwagi: "[Przekazane KAT→SOS 21.04 15:30]" */
export function buildAuditDopisek(kodZ: string, kodDo: string, data = new Date()): string {
  const dd = String(data.getDate()).padStart(2, '0');
  const mm = String(data.getMonth() + 1).padStart(2, '0');
  const hh = String(data.getHours()).padStart(2, '0');
  const mn = String(data.getMinutes()).padStart(2, '0');
  return `[Przekazane ${kodZ}→${kodDo} ${dd}.${mm} ${hh}:${mn}]`;
}
