import { describe, it, expect } from 'vitest';
import { kosztKolka, zaokraglKm, isKlasyfikacjaRozliczalna } from '@/lib/stawki-rozliczenie';
import { rozliczKurs, type WzDoRozliczenia } from '@/lib/rozliczenie-kolka';

// Stawki referencyjne (IV 2026) — weryfikacja sum skumulowanych z arkusza

describe('kosztKolka — przypadki graniczne', () => {
  it('dystans 0 km → minimum 10 km', () => {
    expect(kosztKolka(0, 'D')).toBe(126.80);
  });

  it('dystans 7 km → minimum 10 km', () => {
    expect(kosztKolka(7, 'D')).toBe(126.80);
  });

  it('dystans 9,3 km → minimum 10 km (zaokr. 9)', () => {
    // round(9.3) = 9, ale min 10 km
    expect(kosztKolka(9.3, 'D')).toBe(126.80);
  });

  it('dokładnie 10 km → 126,80 zł (D)', () => {
    expect(kosztKolka(10, 'D')).toBe(126.80);
  });

  it('14,4 km → zaokr. 14 km, D', () => {
    // 10 × 12.68 + 4 × 3.83 = 126.80 + 15.32 = 142.12
    expect(kosztKolka(14.4, 'D')).toBe(142.12);
  });

  it('14,5 km → zaokr. 15 km, D', () => {
    // 10 × 12.68 + 5 × 3.83 = 126.80 + 19.15 = 145.95
    expect(kosztKolka(14.5, 'D')).toBe(145.95);
  });

  it('20 km, D → 165,10 zł (suma kontrolna z arkusza)', () => {
    expect(kosztKolka(20, 'D')).toBe(165.10);
  });

  it('30 km, D → 248,00 zł', () => {
    expect(kosztKolka(30, 'D')).toBe(248.00);
  });

  it('40 km, D → 330,10 zł', () => {
    expect(kosztKolka(40, 'D')).toBe(330.10);
  });

  it('60 km, D → 440,70 zł', () => {
    expect(kosztKolka(60, 'D')).toBe(440.70);
  });

  it('72 km, D → 506,76 zł (przykład usera)', () => {
    // 440,70 + 12 × 5,53 = 440,70 + 66,36 = 507,06
    // User napisał 506,76 — ale to zaokr. mat. 72 → 72, więc 440,70 + 12×5,53 = 507,06
    expect(kosztKolka(72, 'D')).toBe(507.06);
  });
});

describe('kosztKolka — sumy skumulowane per klasyfikacja (z arkusza)', () => {
  // Sumy do 10 / 20 / 30 / 40 / 60 — kontrolne
  const sumy = [
    { k: 'B' as const, do10: 84.60,  do20: 101.70, do30: 113.80, do40: 143.90, do60: 207.30 },
    { k: 'C' as const, do10: 97.60,  do20: 117.80, do30: 132.54, do40: 167.44, do60: 240.64 },
    { k: 'D' as const, do10: 126.80, do20: 165.10, do30: 248.00, do40: 330.10, do60: 440.70 },
    { k: 'E' as const, do10: 126.80, do20: 165.10, do30: 248.00, do40: 330.10, do60: 440.70 },
    { k: 'F' as const, do10: 365.80, do20: 402.40, do30: 429.24, do40: 447.17, do60: 652.87 },
    { k: 'H' as const, do10: 271.50, do20: 299.20, do30: 336.58, do40: 355.32, do60: 532.88 },
  ];

  sumy.forEach(({ k, do10, do20, do30, do40, do60 }) => {
    it(`${k} — sumy 10/20/30/40/60 km`, () => {
      expect(kosztKolka(10, k)).toBe(do10);
      expect(kosztKolka(20, k)).toBe(do20);
      expect(kosztKolka(30, k)).toBe(do30);
      expect(kosztKolka(40, k)).toBe(do40);
      expect(kosztKolka(60, k)).toBe(do60);
    });
  });
});

describe('zaokraglKm', () => {
  it('14,0 → 14', () => expect(zaokraglKm(14.0)).toBe(14));
  it('14,4 → 14', () => expect(zaokraglKm(14.4)).toBe(14));
  it('14,5 → 15', () => expect(zaokraglKm(14.5)).toBe(15));
  it('14,9 → 15', () => expect(zaokraglKm(14.9)).toBe(15));
});

describe('isKlasyfikacjaRozliczalna', () => {
  it('akceptuje B/C/D/E/F/H', () => {
    ['B', 'C', 'D', 'E', 'F', 'H'].forEach(k => expect(isKlasyfikacjaRozliczalna(k)).toBe(true));
  });
  it('odrzuca A (usunięta), puste, null', () => {
    expect(isKlasyfikacjaRozliczalna('A')).toBe(false);
    expect(isKlasyfikacjaRozliczalna('')).toBe(false);
    expect(isKlasyfikacjaRozliczalna(null)).toBe(false);
    expect(isKlasyfikacjaRozliczalna(undefined)).toBe(false);
  });
});

describe('rozliczKurs — przykład z arkusza usera (24.04)', () => {
  // Kurs SK1035N Winda D, 15.04.2026
  // 2 punkty: Normy (linia prosta 5,9) + Wodna (5,7)
  const wzList: WzDoRozliczenia[] = [
    {
      id: '1', numer_wz: 'WZ/001', odbiorca: 'Normy', adres: 'Normy, 40-211 Katowice, PL',
      klasyfikacja: 'D', wartosc_netto: null, kolejnosc: 1, km_prosta: 5.9,
    },
    {
      id: '2', numer_wz: 'WZ/002', odbiorca: 'Wodna', adres: 'Wodna 13, 40-008 Katowice, PL',
      klasyfikacja: 'D', wartosc_netto: null, kolejnosc: 2, km_prosta: 5.7,
    },
  ];

  it('kółko 25,9 km (GPS) → 138,29 zł każdy punkt', () => {
    const r = rozliczKurs(25.9, wzList);
    expect(r.suma_linii_prostych).toBeCloseTo(11.6, 2);
    expect(r.punkty).toHaveLength(2);
    // Normy: 5,9/11,6 × 25,9 = 13,17 → round 13 → 138,29
    expect(r.punkty[0].koszt_punktu).toBe(138.29);
    // Wodna: 5,7/11,6 × 25,9 = 12,73 → round 13 → 138,29
    expect(r.punkty[1].koszt_punktu).toBe(138.29);
    expect(r.koszt_calkowity).toBe(276.58);
  });

  it('kółko 20 km (OSRM) → 126,80 zł każdy punkt (oba poniżej 10 km → minimum)', () => {
    const r = rozliczKurs(20, wzList);
    // Normy: 5,9/11,6 × 20 = 10,17 → round 10 → minimum 126,80
    // Wodna: 5,7/11,6 × 20 = 9,83 → round 10 → minimum 126,80
    expect(r.punkty[0].koszt_punktu).toBe(126.80);
    expect(r.punkty[1].koszt_punktu).toBe(126.80);
    expect(r.koszt_calkowity).toBe(253.60);
  });
});

describe('rozliczKurs — rozdział per WZ po wartości netto', () => {
  it('jeden adres, 2 WZ z różną wartością — koszt dzielony proporcjonalnie', () => {
    const wzList: WzDoRozliczenia[] = [
      {
        id: '1', numer_wz: 'WZ/A', odbiorca: 'X', adres: 'ul. Testowa 1',
        klasyfikacja: 'D', wartosc_netto: 3000, kolejnosc: 1, km_prosta: 5.9,
      },
      {
        id: '2', numer_wz: 'WZ/B', odbiorca: 'X', adres: 'ul. Testowa 1',
        klasyfikacja: 'D', wartosc_netto: 1000, kolejnosc: 1, km_prosta: 5.9,
      },
      {
        id: '3', numer_wz: 'WZ/C', odbiorca: 'Y', adres: 'Inny adres',
        klasyfikacja: 'D', wartosc_netto: null, kolejnosc: 2, km_prosta: 5.7,
      },
    ];
    const r = rozliczKurs(25.9, wzList);
    const punktX = r.punkty.find(p => p.kolejnosc === 1)!;
    expect(punktX.wz).toHaveLength(2);
    // WZ/A: 3000/4000 = 75% × 138,29 = 103,72
    expect(punktX.wz[0].koszt_wz).toBeCloseTo(103.72, 2);
    // WZ/B: 1000/4000 = 25% × 138,29 = 34,57
    expect(punktX.wz[1].koszt_wz).toBeCloseTo(34.57, 2);
    // Razem: 138,29
    const suma = punktX.wz.reduce((s, w) => s + w.koszt_wz, 0);
    expect(suma).toBeCloseTo(138.29, 1);
  });

  it('brak wartości netto → podział równy + ostrzeżenie', () => {
    const wzList: WzDoRozliczenia[] = [
      { id: '1', numer_wz: 'WZ/A', odbiorca: 'X', adres: 'ul. Testowa', klasyfikacja: 'D', wartosc_netto: null, kolejnosc: 1, km_prosta: 5.9 },
      { id: '2', numer_wz: 'WZ/B', odbiorca: 'X', adres: 'ul. Testowa', klasyfikacja: 'D', wartosc_netto: null, kolejnosc: 1, km_prosta: 5.9 },
      { id: '3', numer_wz: 'WZ/C', odbiorca: 'Y', adres: 'Inny', klasyfikacja: 'D', wartosc_netto: null, kolejnosc: 2, km_prosta: 5.7 },
    ];
    const r = rozliczKurs(25.9, wzList);
    const punktX = r.punkty.find(p => p.kolejnosc === 1)!;
    expect(punktX.wz[0].koszt_wz).toBeCloseTo(69.15, 2); // 138,29 / 2
    expect(punktX.wz[1].koszt_wz).toBeCloseTo(69.15, 2);
    expect(r.ostrzezenia.some(o => o.includes('brak wartości netto'))).toBe(true);
  });
});

describe('rozliczKurs — edge cases', () => {
  it('brak linii prostych → koszt 0 + ostrzeżenie', () => {
    const wzList: WzDoRozliczenia[] = [
      { id: '1', numer_wz: 'WZ/A', odbiorca: 'X', adres: 'nieznany', klasyfikacja: 'D', wartosc_netto: null, kolejnosc: 1, km_prosta: null },
    ];
    const r = rozliczKurs(20, wzList);
    expect(r.koszt_calkowity).toBe(0);
    expect(r.punkty).toHaveLength(0);
    expect(r.ostrzezenia.some(o => o.includes('Brak linii prostych'))).toBe(true);
  });

  it('WZ bez klasyfikacji → pominięty + ostrzeżenie', () => {
    const wzList: WzDoRozliczenia[] = [
      { id: '1', numer_wz: 'WZ/A', odbiorca: 'X', adres: 'ok', klasyfikacja: null, wartosc_netto: null, kolejnosc: 1, km_prosta: 5.0 },
      { id: '2', numer_wz: 'WZ/B', odbiorca: 'Y', adres: 'ok2', klasyfikacja: 'D', wartosc_netto: null, kolejnosc: 2, km_prosta: 5.0 },
    ];
    const r = rozliczKurs(20, wzList);
    expect(r.punkty).toHaveLength(1); // tylko Y
    expect(r.ostrzezenia.some(o => o.includes('klasyfikacja'))).toBe(true);
  });
});
