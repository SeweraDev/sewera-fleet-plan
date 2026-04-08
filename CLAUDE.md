# CLAUDE.md — Sewera Fleet Plan

## Projekt

Aplikacja webowa do zarządzania transportem firmy **Sewera Polska Chemia** (8 oddziałów na Śląsku).
Role: sprzedawca, dyspozytor, kierowca, zarząd, admin.
Główne flow: sprzedawca tworzy zlecenie z WZ → dyspozytor planuje kursy → kierowca realizuje trasę.

## Stack technologiczny

- **Frontend**: React 18 + TypeScript + Vite
- **UI**: shadcn/ui (Radix) + Tailwind CSS
- **Backend**: Supabase (PostgreSQL, Auth, Realtime, RLS)
- **Geocoding**: Photon (Komoot) — darmowy, bez klucza
- **Routing**: OSRM — darmowy, km po drogach (korekta ×1.1 do 20 km)
- **Mapa**: Leaflet z CDN (unpkg.com) — bez npm
- **OCR**: Tesseract.js (dynamic import) — ograniczony dla tabel
- **PDF**: pdfjs-dist (dynamic import)
- **Excel**: xlsx/SheetJS (dynamic import)
- **Hosting**: Lovable (dev server + preview)

## Workflow — WAŻNE

- **Zawsze pracuj na branchu `main`** — nigdy nie twórz worktree ani feature branchy
- **Auto-commit + push** po każdej zmianie, bez pytania o potwierdzenie
- **Lovable** synchronizuje się z GitHub (branch main) — użytkownik weryfikuje tam zmiany
- Commituj małymi krokami — Lovable kompiluje na bieżąco, łatwiej znaleźć problem

## Kompatybilność z Lovable — KRYTYCZNE

1. **Dynamic imports** dla ciężkich bibliotek (pdfjs-dist, xlsx, tesseract.js) — nigdy top-level
2. **Proste typy TS** — unikaj złożonych generyków (`Map<string, Map<...>>`)
3. **Osobne `import type`** — nie `import { type Foo }` w jednym imporcie
4. **Realtime channels** — `Date.now()` + `Math.random().toString(36).slice(2)` (React StrictMode)
5. **SQL migracje nie przechodzą** — Lovable sync = tylko pliki kodu. ALTER TABLE/RLS ręcznie w Supabase
6. **Duże pliki lazy-load** — `React.lazy` + `Suspense`
7. **Preferuj client-side** — bez edge functions, bez migracji DB

## Struktura katalogów

```
src/
├── components/
│   ├── dyspozytor/     # EdytujKursModal, EdytujZlecenieModal, FlotaSection,
│   │                   # ImportExcelModal, PrzepnijModal, SuggestionPanel,
│   │                   # ZleceniaMapView, ZleceniaTab
│   ├── sprzedawca/     # TypPojazduStep, CzasDostawyStep, DostepnoscStep,
│   │                   # WzFormTabs, MojeZleceniaTab
│   ├── shared/         # ModalImportWZ (parser WZ), WycenTransportTab (kalkulator),
│   │                   # ConfirmDialog, AppLayout, Topbar, NotificationBell
│   ├── zarzad/         # KpiTab, KosztyTab, RaportyTab
│   └── ui/             # shadcn/ui components
├── hooks/
│   ├── useCreateZlecenie.ts    # Tworzenie zlecenia + WZ
│   ├── useCreateKurs.ts        # Tworzenie kursu + walidacja pojemności
│   ├── useFlotaOddzialu.ts     # Flota własna + zewnętrzna (jedno źródło)
│   ├── useKursyDnia.ts         # Kursy z przystankami i WZ (Realtime)
│   ├── useZleceniaOddzialu.ts  # Zlecenia z geocodingiem i km
│   ├── useZleceniaBezKursu.ts  # Zlecenia nieprzypisane do kursu
│   ├── useSprawdzDostepnosc.ts # Smart dostępność per slot + blokady
│   ├── useKursActions.ts       # Akcje na kursach (status, usuwanie)
│   └── ...
├── lib/
│   ├── oddzialy-geo.ts         # Współrzędne 8 oddziałów, OSRM, Photon, roundKm
│   ├── stawki-transportowe.ts  # Stawki wew/zew, fallback typu, obliczKoszt
│   ├── suggestRoutes.ts        # Podpowiedzi dyspozytora (TYP_CAPACITY)
│   ├── generateNumerZlecenia.ts # Format ZL-KAT/26/04/001
│   └── supabase.ts             # Klient Supabase
├── pages/
│   ├── dyspozytor/Dashboard.tsx  # Główny widok dyspozytora
│   ├── sprzedawca/Dashboard.tsx  # Formularz nowego zlecenia
│   ├── kierowca/MojaTrasa.tsx    # Widok kierowcy
│   └── zarzad/Dashboard.tsx      # KPI i raporty
└── integrations/supabase/        # Typy i klient Supabase
```

## Oddziały Sewera

| Kod | Miasto | Lat | Lng |
|-----|--------|-----|-----|
| KAT | Katowice | 50.2162 | 18.9836 |
| R | Katowice (ten sam adres co KAT) | 50.2162 | 18.9836 |
| SOS | Sosnowiec | 50.2870 | 19.1280 |
| GL | Gliwice | 50.2930 | 18.6720 |
| DG | Dąbrowa Górnicza (w bazie: D.Górnicza) | 50.3340 | 19.1890 |
| TG | Tarnowskie Góry (w bazie: T.Góry) | 50.4430 | 18.8570 |
| CH | Chrzanów | 50.1350 | 19.4050 |
| OS | Oświęcim | 50.0380 | 19.2440 |

## Typy pojazdów

Systemowe: `Dostawczy 1,2t`, `Winda 1,8t`, `Winda 6,3t`, `Winda MAX`, `HDS 9,0t`, `HDS 12,0t`
Zewnętrzne: prefix `zew:` np. `zew:HDS 12T`, `zew:Dostawczy 1,2t`
Aliasy w `TYP_MAPPING` i `CENNIKOWY_TO_SYSTEMOWE` (stawki-transportowe.ts)

## Kolory oddziałów (stałe)

KAT=#dc2626, R=#7c3aed, SOS=#1e40af, GL=#059669, DG=#ea580c, TG=#0891b2, CH=#be185d, OS=#ca8a04

## Baza danych (Supabase)

Kluczowe tabele: `zlecenia`, `zlecenia_wz`, `kursy`, `kurs_przystanki`, `flota`, `flota_zewnetrzna`, `blokady`, `powiadomienia`, `profile`
- Pojazdy zewnętrzne: FK przez `nr_rej_zewn` (tekst), nie `flota_id`
- Numery zleceń: `ZL-KAT/26/04/001` (generowane client-side)
- RLS: INSERT policies dla authenticated (anyone_insert_zlecenia, anyone_insert_zlecenia_wz)

## Język

Użytkownik komunikuje się po polsku. Commity i kod w mieszance PL/EN (nazwy biznesowe po polsku: zlecenie, kurs, dyspozytor, odbiorca).
