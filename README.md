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

Role przechowywane w tabeli `user_roles` (enum `app_role`). Autoryzacja przez `has_role()` SECURITY DEFINER + RLS.

---

## Stack technologiczny

- **Frontend**: React 18, Vite 8, TypeScript, Tailwind CSS
- **UI**: shadcn/ui (Radix), Lucide icons, Recharts
- **Routing**: react-router-dom v6
- **State**: TanStack React Query
- **Backend**: Lovable Cloud (Supabase) — PostgreSQL, Auth, Edge Functions, RLS
- **Formularz**: react-hook-form + zod

---

## Schemat bazy danych

Szczegóły w `docs/HISTORY_TASKS.md` (sekcja Migracje).

| Tabela | Opis |
|--------|------|
| `profiles` | Profil użytkownika (id = auth.uid, full_name, branch) |
| `user_roles` | Role użytkowników (user_id, role enum) |
| `oddzialy` | Oddziały firmy (9 oddziałów) |
| `flota` | Pojazdy własne (28 pojazdów) |
| `flota_zewnetrzna` | Zewnętrzni przewoźnicy |
| `kierowcy` | Kierowcy (21 kierowców) |
| `zlecenia` | Zlecenia transportowe |
| `zlecenia_wz` | Dokumenty WZ per zlecenie |
| `kursy` | Kursy/trasy dzienne |
| `kurs_przystanki` | Rozładunki kursu |
| `dostepnosc_blokady` | Blokady kalendarza |
| `powiadomienia` | Powiadomienia użytkowników |

---

## Edge Functions

| Funkcja | Opis |
|---------|------|
| `parse-wz-pdf` | Parsowanie PDF/tekstu z danymi WZ (dual PUA decode 0xE000+0xF000, obsługa PZ i WZ) |
| `parse-wz-xls` | Parsowanie XLS z danymi WZ |
| `parse-excel-plan` | Parser planu kursów z Excela |
| `check-deadline-wz` | Cron — sprawdzanie deadline WZ |
| `seed-users` | Seedowanie użytkowników testowych |

---

## Struktura plików

```
src/
├── pages/
│   ├── LoginPage.tsx
│   ├── Index.tsx, NotFound.tsx, UnauthorizedPage.tsx
│   ├── admin/Uzytkownicy.tsx
│   ├── dyspozytor/Dashboard.tsx
│   ├── kierowca/MojaTrasa.tsx
│   ├── sprzedawca/Dashboard.tsx
│   └── zarzad/Dashboard.tsx
├── components/
│   ├── dyspozytor/
│   │   ├── EdytujKursModal.tsx, EdytujZlecenieModal.tsx
│   │   ├── FlotaSection.tsx, ImportExcelModal.tsx
│   │   ├── PrzepnijModal.tsx, ZleceniaTab.tsx
│   ├── sprzedawca/
│   │   ├── CzasDostawyStep.tsx, DostepnoscStep.tsx
│   │   ├── MojeZleceniaTab.tsx, TypPojazduStep.tsx, WzFormTabs.tsx
│   ├── zarzad/
│   │   ├── KosztyTab.tsx, KpiTab.tsx, RaportyTab.tsx
│   ├── shared/
│   │   ├── AppLayout.tsx, AppSidebar.tsx, Topbar.tsx, PageSidebar.tsx
│   │   ├── ProtectedRoute.tsx, RootRedirect.tsx
│   │   ├── ModalImportWZ.tsx, NotificationBell.tsx
│   │   ├── StatusBadge.tsx, ConfirmDialog.tsx, LoadingScreen.tsx
│   └── NavLink.tsx
├── hooks/ (21 hooków — useAuth, useKursyDnia, useCreateZlecenie, etc.)
├── providers/AuthProvider.tsx
├── types/ (auth.ts, index.ts)
├── integrations/supabase/ (client.ts, types.ts — auto-generated)
└── lib/ (supabase.ts, utils.ts)

supabase/functions/
├── check-deadline-wz/, parse-excel-plan/
├── parse-wz-pdf/, parse-wz-xls/, seed-users/

docs/
├── TASKS.md, BUGS.md, HISTORY_TASKS.md, SPRINT_3B_import_excel.md
```

---

## Dokumentacja

- `docs/TASKS.md` — Aktualne zadania i plan
- `docs/BUGS.md` — Znane błędy i status
- `docs/HISTORY_TASKS.md` — Historia ukończonych sprintów
- `docs/SPRINT_3B_import_excel.md` — Specyfikacja importu Excel
