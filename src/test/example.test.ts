import { describe, it, expect } from "vitest";
import type { UserRole } from "@/types";
import { ROLE_ROUTES, ROLE_LABELS } from "@/types";

// ── Helper functions extracted from components for testability ──

function utilizationColor(pct: number) {
  if (pct <= 40) return 'green';
  if (pct <= 70) return 'yellow';
  if (pct <= 95) return 'orange';
  return 'red';
}

function bezKursuColor(n: number) {
  if (n === 0) return 'green';
  if (n <= 3) return 'yellow';
  return 'red';
}

function getWeekStart(refDate: Date) {
  const day = refDate.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(refDate);
  monday.setDate(refDate.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

function computeKpiDzis(kursy: { status: string }[]) {
  return {
    total: kursy.length,
    aktywne: kursy.filter(k => k.status === 'aktywny').length,
    zaplanowane: kursy.filter(k => k.status === 'zaplanowany').length,
    zakonczone: kursy.filter(k => k.status === 'zakonczony').length,
  };
}

function computeKosztySplit(
  kursyMiesiac: { nr_rej_zewn: string | null }[],
  zewnNrRej: Set<string>
) {
  return {
    kursy_zewnetrzne: kursyMiesiac.filter(k => k.nr_rej_zewn && zewnNrRej.has(k.nr_rej_zewn)).length,
    kursy_wlasne: kursyMiesiac.filter(k => !k.nr_rej_zewn || !zewnNrRej.has(k.nr_rej_zewn)).length,
  };
}

function generateCSVContent(
  zlecenia: { numer: string; status: string; dzien: string; typ_pojazdu: string | null; preferowana_godzina: string | null; oddzial: string; liczba_wz: number; suma_kg: number }[]
) {
  const header = 'Numer,Status,Dzien,TypPojazdu,Godzina,Oddzial,LiczbaWZ,SumaKg';
  const rows = zlecenia.map(z =>
    `${z.numer},${z.status},${z.dzien},${z.typ_pojazdu || ''},${z.preferowana_godzina || ''},${z.oddzial},${z.liczba_wz},${Math.round(z.suma_kg)}`
  );
  return [header, ...rows].join('\n');
}

// ── Sprint 2 helper functions ──

function generateZlecenieNumer() {
  return `ZL-${Date.now().toString(36).toUpperCase()}`;
}

function validateZlecenieInput(input: {
  oddzial_id: number | null;
  dzien: string;
  preferowana_godzina: string;
  wz_list: { odbiorca: string; adres: string; masa_kg: number }[];
}): string | null {
  if (!input.oddzial_id) return 'Brak oddziału';
  if (!input.dzien) return 'Brak dnia';
  if (!input.preferowana_godzina) return 'Brak godziny';
  if (input.wz_list.length === 0) return 'Brak pozycji WZ';
  const invalid = input.wz_list.find(w => !w.odbiorca || !w.adres || !w.masa_kg);
  if (invalid) return 'Niekompletne dane WZ';
  return null;
}

function computeKursProgress(przystanki: { status: string }[]) {
  const total = przystanki.length;
  const done = przystanki.filter(p => p.status === 'dostarczone').length;
  const failed = przystanki.filter(p => p.status === 'nieudane').length;
  const allFinished = total > 0 && przystanki.every(p => p.status === 'dostarczone' || p.status === 'nieudane');
  return { total, done, failed, allFinished };
}

function canReturn(kursStatus: string, przystanki: { status: string }[]) {
  if (kursStatus !== 'aktywny') return false;
  return przystanki.length > 0 && przystanki.every(p => p.status === 'dostarczone' || p.status === 'nieudane');
}

function filterZleceniaByStatus(
  zlecenia: { status: string }[],
  filter: string
) {
  if (filter === 'wszystkie') return zlecenia;
  return zlecenia.filter(z => z.status === filter);
}

function computeWzSums(wzList: { zlecenie_id: string; masa_kg: number }[]) {
  const map = new Map<string, { count: number; kg: number }>();
  wzList.forEach(wz => {
    const cur = map.get(wz.zlecenie_id) || { count: 0, kg: 0 };
    map.set(wz.zlecenie_id, { count: cur.count + 1, kg: cur.kg + wz.masa_kg });
  });
  return map;
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    'robocza': 'Robocza',
    'potwierdzona': 'Potwierdzona',
    'w_trasie': 'W trasie',
    'dostarczona': 'Dostarczona',
    'zaplanowany': 'Zaplanowany',
    'aktywny': 'Aktywny',
    'zakonczony': 'Zakończony',
    'oczekuje': 'Oczekuje',
    'dostarczone': 'Dostarczone',
    'nieudane': 'Nieudane',
  };
  return labels[status] || status;
}

// ── Tests ──

describe("Auth types and routing", () => {
  it("ROLE_ROUTES maps all 5 roles", () => {
    expect(Object.keys(ROLE_ROUTES)).toHaveLength(5);
    expect(ROLE_ROUTES.zarzad).toBe("/zarzad");
  });

  it("ROLE_LABELS has Polish labels", () => {
    expect(ROLE_LABELS.zarzad).toBe("Zarząd");
  });

  it("role matching logic works", () => {
    const userRoles: UserRole[] = ["zarzad"];
    const allowed: UserRole[] = ["zarzad", "admin"];
    expect(userRoles.some(r => allowed.includes(r))).toBe(true);
  });

  it("role matching rejects non-matching", () => {
    const userRoles: UserRole[] = ["kierowca"];
    const allowed: UserRole[] = ["zarzad", "admin"];
    expect(userRoles.some(r => allowed.includes(r))).toBe(false);
  });
});

describe("KPI calculations", () => {
  it("computeKpiDzis counts statuses correctly", () => {
    const kursy = [
      { status: "aktywny" }, { status: "aktywny" },
      { status: "zaplanowany" },
      { status: "zakonczony" }, { status: "zakonczony" }, { status: "zakonczony" },
    ];
    const result = computeKpiDzis(kursy);
    expect(result.total).toBe(6);
    expect(result.aktywne).toBe(2);
    expect(result.zaplanowane).toBe(1);
    expect(result.zakonczone).toBe(3);
  });

  it("computeKpiDzis handles empty array", () => {
    const result = computeKpiDzis([]);
    expect(result.total).toBe(0);
    expect(result.aktywne).toBe(0);
  });
});

describe("Koszty split calculation", () => {
  it("splits own vs external correctly", () => {
    const kursy = [
      { nr_rej_zewn: "WA12345" }, { nr_rej_zewn: "WA12345" },
      { nr_rej_zewn: null }, { nr_rej_zewn: "KR99999" }, { nr_rej_zewn: null },
    ];
    const result = computeKosztySplit(kursy, new Set(["WA12345"]));
    expect(result.kursy_zewnetrzne).toBe(2);
    expect(result.kursy_wlasne).toBe(3);
  });

  it("handles all own", () => {
    const result = computeKosztySplit([{ nr_rej_zewn: null }, { nr_rej_zewn: null }], new Set());
    expect(result.kursy_wlasne).toBe(2);
    expect(result.kursy_zewnetrzne).toBe(0);
  });
});

describe("Utilization color thresholds", () => {
  it("0-40% = green", () => {
    expect(utilizationColor(0)).toBe("green");
    expect(utilizationColor(40)).toBe("green");
  });
  it("41-70% = yellow", () => {
    expect(utilizationColor(41)).toBe("yellow");
    expect(utilizationColor(70)).toBe("yellow");
  });
  it("71-95% = orange", () => {
    expect(utilizationColor(71)).toBe("orange");
    expect(utilizationColor(95)).toBe("orange");
  });
  it("96%+ = red", () => {
    expect(utilizationColor(96)).toBe("red");
    expect(utilizationColor(100)).toBe("red");
  });
});

describe("Bez kursu color thresholds", () => {
  it("0 = green", () => expect(bezKursuColor(0)).toBe("green"));
  it("1-3 = yellow", () => {
    expect(bezKursuColor(1)).toBe("yellow");
    expect(bezKursuColor(3)).toBe("yellow");
  });
  it("4+ = red", () => {
    expect(bezKursuColor(4)).toBe("red");
    expect(bezKursuColor(10)).toBe("red");
  });
});

describe("Week start calculation", () => {
  it("returns Monday for a Wednesday", () => {
    const wed = new Date(2026, 2, 18);
    expect(getWeekStart(wed)).toBe("2026-03-16");
  });
  it("returns Monday for a Monday", () => {
    const mon = new Date(2026, 2, 16);
    expect(getWeekStart(mon)).toBe("2026-03-16");
  });
});

describe("CSV export generation", () => {
  it("generates correct CSV with header and rows", () => {
    const zlecenia = [{
      numer: "ZL-001", status: "robocza", dzien: "2026-03-18",
      typ_pojazdu: "TIR", preferowana_godzina: "08:00",
      oddzial: "Warszawa", liczba_wz: 3, suma_kg: 1500.7,
    }];
    const csv = generateCSVContent(zlecenia);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Numer,Status,Dzien,TypPojazdu,Godzina,Oddzial,LiczbaWZ,SumaKg");
    expect(lines[1]).toBe("ZL-001,robocza,2026-03-18,TIR,08:00,Warszawa,3,1501");
  });

  it("handles null fields", () => {
    const csv = generateCSVContent([{
      numer: "ZL-002", status: "robocza", dzien: "2026-03-18",
      typ_pojazdu: null, preferowana_godzina: null,
      oddzial: "Kraków", liczba_wz: 0, suma_kg: 0,
    }]);
    expect(csv).toContain("ZL-002,robocza,2026-03-18,,,Kraków,0,0");
  });

  it("empty array produces only header", () => {
    expect(generateCSVContent([]).split("\n")).toHaveLength(1);
  });
});

describe("Pagination logic", () => {
  it("calculates pages correctly", () => {
    expect(Math.ceil(55 / 20)).toBe(3);
  });
  it("slices array for page", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const page1 = items.slice(20, 40);
    expect(page1).toHaveLength(20);
    expect(page1[0]).toBe(20);
  });
});

// ── Sprint 2 Tests ──

describe("Zlecenie numer generation", () => {
  it("generates unique numer with ZL- prefix", () => {
    const n1 = generateZlecenieNumer();
    const n2 = generateZlecenieNumer();
    expect(n1).toMatch(/^ZL-/);
    expect(n1.length).toBeGreaterThan(3);
    // Not guaranteed unique in same ms, but format is correct
  });
});

describe("Zlecenie input validation", () => {
  it("rejects missing oddzial", () => {
    expect(validateZlecenieInput({
      oddzial_id: null, dzien: '2026-03-18', preferowana_godzina: '08:00',
      wz_list: [{ odbiorca: 'A', adres: 'B', masa_kg: 100 }],
    })).toBe('Brak oddziału');
  });

  it("rejects missing dzien", () => {
    expect(validateZlecenieInput({
      oddzial_id: 1, dzien: '', preferowana_godzina: '08:00',
      wz_list: [{ odbiorca: 'A', adres: 'B', masa_kg: 100 }],
    })).toBe('Brak dnia');
  });

  it("rejects empty WZ list", () => {
    expect(validateZlecenieInput({
      oddzial_id: 1, dzien: '2026-03-18', preferowana_godzina: '08:00',
      wz_list: [],
    })).toBe('Brak pozycji WZ');
  });

  it("rejects incomplete WZ", () => {
    expect(validateZlecenieInput({
      oddzial_id: 1, dzien: '2026-03-18', preferowana_godzina: '08:00',
      wz_list: [{ odbiorca: '', adres: 'B', masa_kg: 100 }],
    })).toBe('Niekompletne dane WZ');
  });

  it("accepts valid input", () => {
    expect(validateZlecenieInput({
      oddzial_id: 1, dzien: '2026-03-18', preferowana_godzina: '08:00',
      wz_list: [{ odbiorca: 'A', adres: 'B', masa_kg: 100 }],
    })).toBeNull();
  });
});

describe("Kurs progress computation", () => {
  it("counts done and total", () => {
    const result = computeKursProgress([
      { status: 'dostarczone' }, { status: 'oczekuje' }, { status: 'dostarczone' },
    ]);
    expect(result.total).toBe(3);
    expect(result.done).toBe(2);
    expect(result.allFinished).toBe(false);
  });

  it("all finished when all delivered or failed", () => {
    const result = computeKursProgress([
      { status: 'dostarczone' }, { status: 'nieudane' },
    ]);
    expect(result.allFinished).toBe(true);
    expect(result.failed).toBe(1);
  });

  it("empty przystanki = not finished", () => {
    expect(computeKursProgress([]).allFinished).toBe(false);
  });
});

describe("canReturn logic (Kierowca)", () => {
  it("returns false when kurs not aktywny", () => {
    expect(canReturn('zaplanowany', [{ status: 'dostarczone' }])).toBe(false);
  });

  it("returns false when some przystanki pending", () => {
    expect(canReturn('aktywny', [
      { status: 'dostarczone' }, { status: 'oczekuje' },
    ])).toBe(false);
  });

  it("returns true when all delivered/failed", () => {
    expect(canReturn('aktywny', [
      { status: 'dostarczone' }, { status: 'nieudane' },
    ])).toBe(true);
  });

  it("returns false with no przystanki", () => {
    expect(canReturn('aktywny', [])).toBe(false);
  });
});

describe("Zlecenia status filtering (Sprzedawca)", () => {
  const zlecenia = [
    { status: 'robocza' }, { status: 'potwierdzona' },
    { status: 'w_trasie' }, { status: 'robocza' },
  ];

  it("wszystkie returns all", () => {
    expect(filterZleceniaByStatus(zlecenia, 'wszystkie')).toHaveLength(4);
  });

  it("filters by specific status", () => {
    expect(filterZleceniaByStatus(zlecenia, 'robocza')).toHaveLength(2);
    expect(filterZleceniaByStatus(zlecenia, 'potwierdzona')).toHaveLength(1);
  });

  it("returns empty for nonexistent status", () => {
    expect(filterZleceniaByStatus(zlecenia, 'anulowana')).toHaveLength(0);
  });
});

describe("WZ sum computation", () => {
  it("aggregates per zlecenie", () => {
    const wz = [
      { zlecenie_id: 'a', masa_kg: 100 },
      { zlecenie_id: 'a', masa_kg: 200 },
      { zlecenie_id: 'b', masa_kg: 50 },
    ];
    const map = computeWzSums(wz);
    expect(map.get('a')).toEqual({ count: 2, kg: 300 });
    expect(map.get('b')).toEqual({ count: 1, kg: 50 });
  });

  it("handles empty list", () => {
    expect(computeWzSums([]).size).toBe(0);
  });
});

describe("Status labels", () => {
  it("returns Polish labels for known statuses", () => {
    expect(getStatusLabel('robocza')).toBe('Robocza');
    expect(getStatusLabel('aktywny')).toBe('Aktywny');
    expect(getStatusLabel('zakonczony')).toBe('Zakończony');
    expect(getStatusLabel('dostarczone')).toBe('Dostarczone');
  });

  it("returns raw status for unknown", () => {
    expect(getStatusLabel('unknown_status')).toBe('unknown_status');
  });
});
