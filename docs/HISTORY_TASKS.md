# HISTORY_TASKS.md — Historia ukończonych zadań
📅 Ostatnia aktualizacja: 2026-03-30

---

## SPRINT 0 — Baza danych
✅ Tabele: oddzialy, flota, flota_zewnetrzna, kierowcy, user_roles, zlecenia, zlecenia_wz, kursy, kurs_przystanki, dostepnosc_blokady, powiadomienia
✅ RLS włączony na wszystkich tabelach
✅ Seed: 9 oddziałów, 28 pojazdów, 21 kierowców

## SPRINT 1 — Szkielet + Auth
✅ Routing dla 5 ról, Topbar, Sidebar, ProtectedRoute

## SPRINT 1.5 — Fix Auth (hardcode → Supabase)
✅ useAuth + LoginPage przepisane na Supabase Auth

## SPRINT 2A — Sprzedawca
✅ Formularz zlecenia (5 kroków), lista "Moje zlecenia", import WZ (wklej tekst)

## SPRINT 2B — Dyspozytor
✅ Kursy, Zlecenia, Flota (4 zakładki), Kalendarz, CRUD pojazdów/kierowców/zewnętrznych, Realtime

## SPRINT 2C — Kierowca
✅ Widok mobilny, kursy na dziś, potwierdzanie rozładunków, Google Maps

## SPRINT 2D — Zarząd
✅ KPI, Koszty, Raporty, Realtime + auto-refresh

## SPRINT 3A — Import WZ (PDF + komponenty)
✅ Edge Function `parse-wz-pdf`, `parse-excel-plan`, `ModalImportWZ` (4 zakładki)

## SPRINT 3B — Import Excel (plan kursów)
✅ Modal importu planu Excela, lista typów A-I, import WZ z Excela

## SPRINT 3C — Deadline WZ + Powiadomienia
✅ deadline_wz, check-deadline-wz (cron), NotificationBell, DeadlineBadge

## SPRINT 3D — Weryfikacja zajętości
✅ useSprawdzDostepnosc, DostepnoscStep, status do_weryfikacji

---

## POPRAWKI (2026-03-19 – 2026-03-26)

| ID | Opis | Data |
|----|------|------|
| FIX-001 | parse-wz-pdf: Buffer → Uint8Array | 2026-03-19 |
| FIX-002 | Parser WZ: R7/ oprócz T7/ | 2026-03-19 |
| FIX-003 | Parser WZ: odbiorca bez prefixu | 2026-03-19 |
| FIX-004 | Parser WZ: masa bez "kg" | 2026-03-19 |
| FIX-005 | Parser PDF: masa_kg last index | 2026-03-20 |
| FIX-006 | Parser PDF: kontakty | 2026-03-20 |
| FIX-007 | Parser PDF: nabywca PZ vs WZ | 2026-03-20 |
| FIX-008 | Parser PDF: lines not defined | 2026-03-20 |
| FIX-009 | PasteTab: disabled button PUA chars | 2026-03-25 |
| FIX-010 | decodePUA: dual-offset 0xE000+0xF000 | 2026-03-26 |
| FIX-011 | parseSeweraDoc KROK 4: nagłówki PZ | 2026-03-26 |
| FIX-012 | parseSeweraDoc KROK 5: nazwaObiektu prefix | 2026-03-26 |
| FIX-013 | parse-wz-pdf: debug log AFTER_CLEAN | 2026-03-26 |
| FIX-014 | decodePUA: generyczny dekoder (offset = Unicode codepoint) | 2026-03-30 |
| FIX-015 | decodePUA: baza 0x100000 (Supplementary PUA-B) — root cause | 2026-03-30 |
| FIX-016 | cleanText: rozszerzony regex U+2000-U+215F | 2026-03-30 |
| FIX-017 | masa_kg: ostatnia liczba przed RAZEM: | 2026-03-30 |
| FIX-018 | adres: 4 priorytety (forward, backward, Budowa, siedziba) | 2026-03-30 |
| FIX-019 | tel: backward+forward, myślniki | 2026-03-30 |
| FIX-020 | uwagi: "Uwagi dot. wysyłki:", stop "Wystawił:" | 2026-03-30 |
| FIX-021 | os.kontaktowa: pełny tekst, multi-kontakt | 2026-03-30 |
| FIX-022 | odbiorca: skip pozycji, producentów, S.A.?/S.C. | 2026-03-30 |
| FIX-023 | odbiorca: nazwa + adres siedziby | 2026-03-30 |
| FIX-024 | WZS: obsługa prefixu WZS | 2026-03-30 |
| FIX-025 | m³/palety: wyłączona auto-ekstrakcja | 2026-03-30 |
| FIX-026 | merge: fallback local osoba_kontaktowa | 2026-03-30 |

---

## MIGRACJE WYKONANE

1. Sprint 0 SQL — baza główna
2. RLS dla oddzialy/flota/kierowcy
3. Seed: 9 oddziałów, 28 aut, 21 kierowców
4. Konta testowe + role
5. flota_zewnetrzna: ladownosc_kg, kierowca, tel, oddzial_id, aktywny
6. flota: objetosc_m3 DROP NOT NULL
7. flota: ADD max_palet
8. UPDATE flota: dane 28 pojazdów
9. zlecenia_wz: ADD ilosc_palet
10. dostepnosc_blokady: CREATE TABLE
11. zlecenia: ADD deadline_wz, ma_wz, flaga_brak_wz
12. Funkcja oblicz_deadline_wz() + triggery
13. powiadomienia: CREATE TABLE
14. RLS dla dyspozytor: INSERT/UPDATE/DELETE
15. RLS dla zarzad: SELECT
