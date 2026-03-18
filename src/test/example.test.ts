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
      { status: "aktywny" },
      { status: "aktywny" },
      { status: "zaplanowany" },
      { status: "zakonczony" },
      { status: "zakonczony" },
      { status: "zakonczony" },
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
      { nr_rej_zewn: "WA12345" },
      { nr_rej_zewn: "WA12345" },
      { nr_rej_zewn: null },
      { nr_rej_zewn: "KR99999" },
      { nr_rej_zewn: null },
    ];
    const zewn = new Set(["WA12345"]);
    const result = computeKosztySplit(kursy, zewn);
    expect(result.kursy_zewnetrzne).toBe(2);
    expect(result.kursy_wlasne).toBe(3); // 2 null + 1 unknown nr_rej
  });

  it("handles all own", () => {
    const kursy = [{ nr_rej_zewn: null }, { nr_rej_zewn: null }];
    const result = computeKosztySplit(kursy, new Set());
    expect(result.kursy_wlasne).toBe(2);
    expect(result.kursy_zewnetrzne).toBe(0);
  });
});

describe("Utilization color thresholds (D-002)", () => {
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
    // 2026-03-18 is a Wednesday
    const wed = new Date(2026, 2, 18);
    const start = getWeekStart(wed);
    expect(start).toBe("2026-03-16");
  });

  it("returns Monday for a Monday", () => {
    const mon = new Date(2026, 2, 16);
    expect(getWeekStart(mon)).toBe("2026-03-16");
  });
});

describe("CSV export generation", () => {
  it("generates correct CSV with header and rows", () => {
    const zlecenia = [
      {
        numer: "ZL-001",
        status: "robocza",
        dzien: "2026-03-18",
        typ_pojazdu: "TIR",
        preferowana_godzina: "08:00",
        oddzial: "Warszawa",
        liczba_wz: 3,
        suma_kg: 1500.7,
      },
    ];
    const csv = generateCSVContent(zlecenia);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Numer,Status,Dzien,TypPojazdu,Godzina,Oddzial,LiczbaWZ,SumaKg");
    expect(lines[1]).toBe("ZL-001,robocza,2026-03-18,TIR,08:00,Warszawa,3,1501");
  });

  it("handles null fields", () => {
    const zlecenia = [{
      numer: "ZL-002", status: "robocza", dzien: "2026-03-18",
      typ_pojazdu: null, preferowana_godzina: null,
      oddzial: "Kraków", liczba_wz: 0, suma_kg: 0,
    }];
    const csv = generateCSVContent(zlecenia);
    expect(csv).toContain("ZL-002,robocza,2026-03-18,,,Kraków,0,0");
  });

  it("empty array produces only header", () => {
    const csv = generateCSVContent([]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(1);
  });
});

describe("Pagination logic", () => {
  it("calculates pages correctly", () => {
    const PAGE_SIZE = 20;
    const totalItems = 55;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    expect(totalPages).toBe(3);
  });

  it("slices array for page", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const PAGE_SIZE = 20;
    const page1 = items.slice(1 * PAGE_SIZE, 2 * PAGE_SIZE);
    expect(page1).toHaveLength(20);
    expect(page1[0]).toBe(20);
  });
});
