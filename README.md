# Sewera — System Transportowy

System zarządzania transportem i logistyką dla firmy Sewera. Aplikacja webowa (React/Vite/TypeScript) z backendem na Lovable Cloud (Supabase).

---

## Role użytkowników

| Rola | Ścieżka | Opis |
|------|---------|------|
| `admin` | `/admin` | Zarządzanie kontami użytkowników (placeholder) |
| `zarzad` | `/zarzad` | Dashboard zarządu: KPI, Koszty, Raporty |
| `dyspozytor` | `/dyspozytor` | Główny panel operacyjny: Kursy, Historia zleceń, Flota |
| `sprzedawca` | `/sprzedawca` | Tworzenie zleceń, import WZ, Moje zlecenia |
| `kierowca` | `/kierowca` | Widok dzisiejszej trasy, potwierdzanie rozładunków |

Role przechowywane w tabeli `user_roles` (enum `app_role`). Użytkownik może mieć wiele ról. Autoryzacja przez `has_role()` SECURITY DEFINER + RLS.

---

## Architektura stron

### Dyspozytor (`/dyspozytor`)
Sidebar: Kursy | Historia zleceń | Flota

**Kursy** — główny widok operacyjny:
- Wybór oddziału i dnia
- Lista kursów dnia (karty z nagłówkiem 3-liniowym):
  - L1: `[nr_rej badge] · typ pojazdu · status`
  - L2: `Kierowca: imię · 📞 tel` (klikalny)
  - L3: `Rozładunki: x/y · ⚖️ kg · 📦 pal`
- Modal tworzenia kursu (wybór pojazdu, kierowcy, przypisanie zleceń)
- Akcje kursu: Wyjedź, Zakończ
- Przystanki: zmiana kolejności, potwierdzenie rozładunku

**Historia zleceń** (`ZleceniaTab`):
- Tabela zleceń oddziału z filtrami statusów
- Modal edycji zlecenia (`EdytujZlecenieModal`)

**Flota** (`FlotaSection`) — 4 zakładki:
- 🚛 **Pojazdy własne** — tabela z tabeli `flota`, CRUD (dodaj/edytuj/usuń)
- 🚚 **Zewnętrzni** — tabela z `flota_zewnetrzna`, pełny CRUD
  - Kolumny: Nr rej, Typ, Ładowność, Max palet, m³, Firma, Kierowca, Telefon, Oddział
  - Modal dodaj/edytuj z walidacją
- 👤 **Kierowcy** — tabela z `kierowcy`, CRUD
- 📅 **Kalendarz** — 10 dni roboczych, 3 sekcje:
  - Pojazdy × dni (blokady typ `pojazd`)
  - Kierowcy × dni (blokady typ `kierowca`)
  - Transport zewnętrzny × dni (blokady typ `zewnetrzny`)
  - Kliknięcie komórki toggle'uje blokadę w `dostepnosc_blokady`
  - Komórki z kursem pokazują status badge

### Sprzedawca (`/sprzedawca`)
Sidebar: Nowe zlecenie | Moje zlecenia

**Nowe zlecenie** — kreator 3-krokowy:
1. Typ pojazdu + oddział
2. Czas dostawy (dzień + godzina)
3. Lista WZ (ręczne + import PDF/XLS)

**Moje zlecenia** — tabela zleceń z filtrem statusów

### Kierowca (`/kierowca`)
- Widok dzisiejszej trasy (kursy przypisane do zalogowanego kierowcy)
- Potwierdzanie rozładunków per przystanek
- Import WZ przez kierowcę

### Zarząd (`/zarzad`)
Sidebar: KPI | Koszty | Raporty
- KPI — statystyki operacyjne
- Koszty — analiza kosztów (placeholder)
- Raporty — raporty (placeholder)

### Admin (`/admin`)
- Placeholder — zarządzanie kontami

---

## Schemat bazy danych

### Tabele

| Tabela | Opis |
|--------|------|
| `profiles` | Profil użytkownika (id = auth.uid, full_name, branch) |
| `user_roles` | Role użytkowników (user_id, role enum) |
| `oddzialy` | Oddziały firmy (id serial, nazwa) |
| `flota` | Pojazdy własne (nr_rej, typ, ładowność, max_palet, objętość, oddział) |
| `flota_zewnetrzna` | Zewnętrzni przewoźnicy (+ firma, kierowca, tel) |
| `kierowcy` | Kierowcy (imie_nazwisko, tel, uprawnienia, user_id, oddział) |
| `zlecenia` | Zlecenia transportowe (numer, dzień, status, typ_pojazdu, kurs_id, oddział) |
| `zlecenia_wz` | Dokumenty WZ per zlecenie (odbiorca, adres, masa, objętość, palety) |
| `kursy` | Kursy/trasy dzienne (dzień, pojazd, kierowca, status, godziny) |
| `kurs_przystanki` | Przystanki kursu (kolejność, zlecenie_id, status) |
| `dostepnosc_blokady` | Blokady kalendarza (zasob_id, dzien, typ: pojazd/kierowca/zewnetrzny) |

### Typy pojazdów (enum w UI)
`Dostawczy 1,2t` | `Winda 1,8t` | `Winda 6,3t` | `Winda MAX 15,8t` | `HDS 8,9t` | `HDS 9,1t` | `HDS 11,7t`

### Statusy zleceń
`nowe` → `przypisane` → `w_trasie` → `dostarczone`

### Statusy kursów
`zaplanowany` → `aktywny` → `zakończony`

---

## Kluczowe hooki

| Hook | Tabela | Opis |
|------|--------|------|
| `useAuth` | profiles, user_roles | Logowanie, sesja, role |
| `useOddzialy` | oddzialy | Lista oddziałów |
| `useFlotaOddzialu` | flota | Pojazdy własne oddziału |
| `useFlotaZewnetrzna` | flota_zewnetrzna | Zewnętrzni przewoźnicy |
| `useKierowcyOddzialu` | kierowcy | Kierowcy oddziału |
| `useKierowcyStatusDnia` | kierowcy + kursy | Status kierowców danego dnia |
| `useKursyDnia` | kursy + przystanki + flota + kierowcy | Kursy dnia z pełnymi danymi |
| `useKursActions` | kursy, kurs_przystanki | Akcje: wyjedź, zakończ, potwierdź rozładunek |
| `useCreateKurs` | kursy, kurs_przystanki, zlecenia | Tworzenie nowego kursu |
| `useCreateZlecenie` | zlecenia, zlecenia_wz | Tworzenie zlecenia z WZ |
| `useZleceniaBezKursu` | zlecenia | Zlecenia nieprzypisane do kursu |
| `useZleceniaOddzialu` | zlecenia | Zlecenia oddziału (historia) |
| `useMojeZlecenia` | zlecenia | Zlecenia sprzedawcy |
| `useMojeKursyDzis` | kursy | Kursy kierowcy na dziś |
| `useKalendarzFloty` | kursy | Kursy w kalendarzu floty |
| `useBlokady` | dostepnosc_blokady | Blokady kalendarza |
| `useZarzadKPI` | zlecenia, kursy | KPI zarządu |

---

## Edge Functions

| Funkcja | Opis |
|---------|------|
| `parse-wz-pdf` | Parsowanie PDF z danymi WZ |
| `parse-wz-xls` | Parsowanie XLS z danymi WZ |
| `seed-users` | Seedowanie użytkowników testowych |

---

## Polityki RLS (podsumowanie)

- **profiles**: użytkownik widzi/edytuje swoje, admin widzi/edytuje wszystkie
- **user_roles**: użytkownik widzi swoje, admin CRUD
- **flota / flota_zewnetrzna / kierowcy**: SELECT dla authenticated, INSERT/UPDATE/DELETE dla dyspozytor+admin
- **zlecenia**: INSERT sprzedawca+kierowca, SELECT+UPDATE dyspozytor, SELECT zarząd+sprzedawca
- **zlecenia_wz**: INSERT sprzedawca+kierowca, SELECT dyspozytor+sprzedawca+zarząd, UPDATE dyspozytor
- **kursy / kurs_przystanki**: INSERT+SELECT+UPDATE dyspozytor, SELECT+UPDATE kierowca (own), SELECT zarząd
- **dostepnosc_blokady**: INSERT+DELETE dyspozytor+admin, SELECT authenticated
- **oddzialy**: SELECT dla authenticated

---

## Stack technologiczny

- **Frontend**: React 18, Vite 8, TypeScript, Tailwind CSS
- **UI**: shadcn/ui (Radix), Lucide icons, Recharts
- **Routing**: react-router-dom v6
- **State**: TanStack React Query
- **Backend**: Lovable Cloud (Supabase) — PostgreSQL, Auth, Edge Functions, RLS
- **Formularz**: react-hook-form + zod

---

## Struktura plików

```
src/
├── pages/
│   ├── LoginPage.tsx
│   ├── admin/Uzytkownicy.tsx
│   ├── dyspozytor/Dashboard.tsx      # Główny panel dyspozytora
│   ├── kierowca/MojaTrasa.tsx
│   ├── sprzedawca/Dashboard.tsx
│   └── zarzad/Dashboard.tsx
├── components/
│   ├── dyspozytor/
│   │   ├── FlotaSection.tsx           # Flota: 4 zakładki + kalendarz
│   │   ├── ZleceniaTab.tsx            # Historia zleceń
│   │   └── EdytujZlecenieModal.tsx
│   ├── sprzedawca/
│   │   ├── TypPojazduStep.tsx
│   │   ├── CzasDostawyStep.tsx
│   │   ├── WzFormTabs.tsx
│   │   └── MojeZleceniaTab.tsx
│   ├── zarzad/
│   │   ├── KpiTab.tsx
│   │   ├── KosztyTab.tsx
│   │   └── RaportyTab.tsx
│   └── shared/
│       ├── AppLayout.tsx / AppSidebar.tsx
│       ├── Topbar.tsx / PageSidebar.tsx
│       ├── ProtectedRoute.tsx / RootRedirect.tsx
│       ├── ModalImportWZ.tsx
│       ├── StatusBadge.tsx / ConfirmDialog.tsx
│       └── LoadingScreen.tsx
├── hooks/                             # Wszystkie hooki opisane wyżej
├── providers/AuthProvider.tsx
├── types/
│   ├── auth.ts                        # AppRole, UserProfile, ROLE_ROUTES
│   └── index.ts                       # Re-export
└── integrations/supabase/
    ├── client.ts                      # Auto-generated
    └── types.ts                       # Auto-generated
```
