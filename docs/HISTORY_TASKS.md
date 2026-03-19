# HISTORY_TASKS.md — Historia ukończonych zadań
📅 Ostatnia aktualizacja: 2026-03-19

---

## SPRINT 0 — Baza danych
✅ Uruchomiono SPRINT_0_transport_v1.sql w Lovable Cloud
✅ Tabele: oddzialy, flota, flota_zewnetrzna, kierowcy,
   user_roles, zlecenia, zlecenia_wz, kursy, kurs_przystanki,
   dostepnosc_blokady, powiadomienia
✅ RLS włączony na wszystkich tabelach
✅ Seed: 9 oddziałów, 28 pojazdów, 21 kierowców
✅ Self-signup wyłączony

---

## SPRINT 1 — Szkielet + Auth
✅ Knowledge file wgrany do Lovable
✅ Routing dla 5 ról: /sprzedawca /dyspozytor /kierowca /zarzad /admin
✅ Topbar z nazwą użytkownika + badge roli + wyloguj
✅ Sidebar per rola
✅ ProtectedRoute z redirect po roli
✅ Szkielety 5 stron

---

## SPRINT 1.5 — Fix Auth (hardcode → Supabase)
✅ useAuth pobiera role z tabeli user_roles (nie hardcode)
✅ LoginPage używa supabase.auth.signInWithPassword()
✅ Redirect po logowaniu zależny od primaryRole
✅ ProtectedRoute sprawdza roles z bazy
✅ Konta testowe: 5 kont @sewera.pl z rolami
✅ Kierowca@sewera.pl powiązany z Michał S. w tabeli kierowcy

---

## SPRINT 2A — Sprzedawca
✅ Formularz zlecenia — drawer z krokami
✅ Krok 1: Oddział z bazy (useOddzialy)
✅ Krok 2: Typ pojazdu z floty (useFlotaOddzialu)
✅ Krok 3: Wybór dnia
✅ Krok 4: Preferowana godzina (do 8:00 / do 10:00 / ... / Dowolna)
✅ Krok 5: Dokumenty WZ (ręcznie + wklej tekst parser)
✅ INSERT do zlecenia + zlecenia_wz
✅ Lista "Moje zlecenia" z filtrami statusów
✅ Poprawione etykiety pól WZ (odbiorca ≠ sprzedawca)
✅ Opcja "Bez preferencji" w typie pojazdu
✅ Zakładki importu WZ (mock OCR + wklej tekst)

---

## SPRINT 2B — Dyspozytor
✅ Sidebar: Kursy / Zlecenia / Flota
✅ Automatyczne ustawienie oddziału z profilu
✅ Widok kursów z filtrami: Wszystkie/Zaplanowane/W trasie/Zakończone
✅ Banner ⚠️ zleceń bez kursu z przyciskiem "Przypisz"
✅ Kolumny aut z paskami zajętości kg/m³/palet
✅ KartaKursu: nr rej. + typ + kierowca + telefon + rozładunki
✅ Akcje: Wyjechał / Dostarczono / Wrócił → UPDATE bazy
✅ Realtime na tabeli kursy
✅ ModalBuilderKursu: tworzenie kursu z wyborem auta/kierowcy/zleceń
✅ Modal edycji zlecenia (✏️) z importem WZ
✅ Modal edycji kursu (⚙️)
✅ Modal przepięcia zlecenia (🔀) między kursami
✅ Zakładka Zlecenia: wszystkie zlecenia z filtrami + kolumna Kurs
✅ Zakładka Flota z 3 zakładkami: Pojazdy / Zewnętrzni / Kierowcy
✅ CRUD pojazdów własnych (add/edit/delete) — tylko dyspozytor
✅ CRUD kierowców (add/edit/delete) — tylko dyspozytor
✅ CRUD zewnętrznych przewoźników — tylko dyspozytor
✅ Kalendarz zajętości 10 dni roboczych (Pon-Pt)
✅ Toggle blokady pojazdu/kierowcy/zewnętrznego w kalendarzu
✅ Filtr zakresu dat (jeden dzień / zakres)
✅ Widok kursów: model Kurs→Rozładunek→WZ (grupowanie)

---

## SPRINT 2C — Kierowca
✅ Widok mobilny (max-width: 480px)
✅ Kursy na dziś z bazy (useMojeKursyDzis)
✅ Przystanki z ładunkiem per kurs
✅ Przyciski: Wyjeżdżam / Dostarczyłem / Wróciłem
✅ UPDATE bazy przy każdej akcji
✅ Realtime na kurs_przystanki
✅ Link Google Maps z trasą
✅ "Wróciłem" aktywny tylko gdy wszystkie rozładunki zakończone

---

## SPRINT 2D — Zarząd
✅ Dashboard KPI z 3 zakładkami: KPI / Koszty / Raporty
✅ Zakładka KPI: 4 kafelki + zajętość floty + live kursy + tabela oddziałów
✅ Alert zleceń bez kursu
✅ Zakładka Koszty: własne vs zewnętrzne + tabela przewoźników
✅ Zakładka Raporty: filtry daty+oddział + paginacja + eksport CSV
✅ Realtime + auto-refresh co 60s
✅ 42 testy — wszystkie przeszły
✅ RLS dla roli zarzad dodany

---

## MIGRACJE WYKONANE (chronologicznie)

1. Sprint 0 SQL — baza główna
2. RLS dla oddzialy/flota/kierowcy (SELECT authenticated)
3. Seed: 9 oddziałów, 28 aut, 21 kierowców
4. Konta testowe + role w user_roles
5. flota_zewnetrzna: dodano ladownosc_kg, kierowca, tel, oddzial_id, aktywny
6. flota: objetosc_m3 DROP NOT NULL
7. flota: ADD COLUMN max_palet INT
8. UPDATE flota: dane 28 pojazdów z max_palet
9. zlecenia_wz: ADD COLUMN ilosc_palet INT
10. dostepnosc_blokady: CREATE TABLE (toggle blokady)
11. zlecenia: ADD COLUMN deadline_wz, ma_wz, flaga_brak_wz
12. Funkcja oblicz_deadline_wz() + triggery
13. powiadomienia: CREATE TABLE
14. RLS dla dyspozytor: INSERT/UPDATE/DELETE na flota/kierowcy/kursy/zlecenia
15. RLS dla zarzad: SELECT na kursy/zlecenia/flota/kurs_przystanki

---

## PROBLEMY NAPOTKANE I ROZWIĄZANIA

| Problem | Rozwiązanie |
|---------|-------------|
| Auth hardcoded zamiast Supabase | Przepisano useAuth + LoginPage |
| Tabele puste po Sprint 0 | Seed wgrany osobno przez Lovable chat |
| flota.objetosc_m3 NOT NULL | ALTER COLUMN DROP NOT NULL |
| UNHANDLED_PROMISE_REJECTION w DyspozytoPage | Fix async w useEffect |
| Dyspozytor nie widział oddziału | Auto-set z user_roles przy mount |
| Terminologia "przystanek" | Zamieniono na "rozładunek" wszędzie |
| Odbiorca w WZ = sprzedawca (błąd UX) | Poprawiono etykiety pól |
| Palety hardcoded 33 zamiast z bazy | max_palet z tabeli flota |
| Kalendarz pokazywał weekendy | Fix funkcji generującej dni (DOW 1-5) |
