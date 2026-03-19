# TASKS.md — Aktualne zadania
📅 Ostatnia aktualizacja: 2026-03-19

---

## JAK UŻYWAĆ

Na początku każdego promptu w Lovable wklej:
```
Przeczytaj KONTEKST.md i TASKS.md przed implementacją.
[właściwy prompt]
```

Po ukończeniu zadania Lovable dopisuje:
```
✅ DONE [data] — [co zrobił, jakie pliki zmienił]
```

---

## AKTUALNY SPRINT: Sprint 3 — Import WZ + Rezerwacje

---

### BLOK A: Import PDF (Edge Functions)

- [x] **S3-001** — Edge Function `parse-wz-pdf` ✅ 2026-03-19
  Parser PDF dokumentów WZ z systemu Ekonom/Proman.
  Pola: nr_wz, nr_zamowienia, odbiorca_nazwa, adres_dostawy,
  osoba_kontaktowa, tel, masa_kg, ilosc_palet, objetosc_m3,
  uwagi, pozycje_towarowe[], data_wz, pewnosc.
  Biblioteka: pdf-parse (npm)

- [x] **S3-002** — Edge Function `parse-excel-plan` ✅ 2026-03-19
  Parser planu kursów z Excela (eksport z ERP).
  Szuka po nazwach nagłówków (case insensitive).
  Grupuje wiersze po KURS + KIEROWCA.
  Mapowanie typów: B→Dostawczy, C→Winda 1,8t, D→Winda 6,3t,
  E→Winda MAX, F/G→HDS 11,7t, H/I→HDS 8,9t. Typ A → pomiń.
  Biblioteka: xlsx (SheetJS, npm)

- [x] **S3-003** — Komponent `ModalImportWZ` (shared) ✅ 2026-03-19
  4 zakładki: 📄 PDF / 📊 XLS / 📋 Wklej tekst / ✏️ Ręcznie
  Używany przez: SprzedawcaPage, DyspozytoPage, KierowcaPage
  Props: isOpen, onClose, onImport(wzData[])

- [x] **S3-004** — Integracja importu w SprzedawcaPage ✅ 2026-03-19
  Przycisk "📥 Importuj WZ" otwiera ModalImportWZ.
  Wiele WZ z XLS → wiele kart WZ w zleceniu.

- [x] **S3-005** — Integracja importu w DyspozytoPage ✅ 2026-03-19
  Przycisk "📥 Importuj z WZ" w modalu edycji zlecenia.

- [ ] **S3-006** — Domówienie kierowcy (KierowcaPage)
  Przycisk "➕ Domówienie" na aktywnym kursie.
  Otwiera ModalImportWZ (tylko PDF + Ręcznie).
  Tworzy zlecenie ze statusem `do_weryfikacji`.
  Dyspozytor widzi w bannerze ⚠️ i może zatwierdzić/odrzucić.
  MIGRACJA: ALTER TYPE zlecenie_status ADD VALUE 'do_weryfikacji'

---

### BLOK B: Import Excel — plan kursów (dyspozytor)

- [x] **S3B-001** — Modal importu planu Excela (DyspozytoPage) ✅ 2026-03-19
  Przycisk "📊 Importuj plan" obok "+ Nowy kurs".
  KROK 1: drag & drop XLS/XLSX → Edge Function parse-excel-plan
  KROK 2: podgląd kursów z walidacją kierowcy/auta
  KROK 3: dyspozytor zatwierdza → INSERT kursy + zlecenia + przystanki
  Nierozpoznany kierowca/auto → dropdown wyboru przed zatwierdzeniem
  Pole "Dzień importu" (date picker) — Excel nie zawiera daty!

- [x] **S3B-002** — Lista A-I w formularzu zlecenia (SprzedawcaPage) ✅ 2026-03-19
  W kroku 2 dodaj zakładki: "📋 Wybierz typ (B-I)" | "🚛 Wybierz pojazd"
  Tabela z kodami B-I i opisami → kliknięcie ustawia typ_pojazdu

- [x] **S3B-003** — Import WZ z Excela (SprzedawcaPage) ✅ 2026-03-19
  W zakładce XLS w ModalImportWZ: sprzedawca wybiera swój wiersz
  z planu kursów. Wypełnia formularz WZ.

---

### BLOK C: Rezerwacje i deadline WZ

- [x] **S3C-001** — Migracja deadline_wz ✅
  Kolumny: deadline_wz, ma_wz, flaga_brak_wz w tabeli zlecenia
  Funkcja oblicz_deadline_wz() — 2 dni robocze przed, godz. 16:00
  Trigger set_deadline_wz przy INSERT
  Trigger update_ma_wz przy INSERT do zlecenia_wz

- [x] **S3C-002** — Edge Function `check-deadline-wz` (cron co godzinę) ✅ 2026-03-19
  Flaguje zlecenia gdzie: ma_wz=false AND deadline_wz < NOW()
  UPDATE zlecenia SET flaga_brak_wz=true
  INSERT do powiadomienia dla nadawcy

- [x] **S3C-003** — Tabela powiadomienia + UI bell w Topbarze ✅ 2026-03-19
  Ikona 🔔 z badge nieprzeczytanych.
  Dropdown z listą powiadomień.
  Realtime na tabeli powiadomienia.

- [x] **S3C-004** — UI deadline w SprzedawcaPage ✅ 2026-03-19
  W karcie zlecenia: 🟡 "Dodaj WZ do [data] 16:00"
  Po przekroczeniu: 🔴 "Przekroczony deadline — oczekuje na decyzję"
  Po dodaniu WZ: 🟢 "✓ WZ dodane"

- [x] **S3C-005** — UI flag u dyspozytora (DyspozytoPage) ✅ 2026-03-19
  W zakładce Zlecenia: badge "⏰ Przekroczony deadline WZ"
  Przyciski: "❌ Anuluj dostawę" / "✅ Przedłuż termin"

---

### BLOK D: Weryfikacja zajętości przy składaniu zlecenia

- [ ] **S3D-001** — Sprawdzanie dostępności w formularzu (SprzedawcaPage)
  Po kroku 5 (WZ z masą/m³/paletami) → sprawdź zajętość w czasie rzeczywistym
  ✅ Mieści się → normalny INSERT, status 'robocza'
  ⚠️ Nie mieści się → dwa przyciski:
    "Zmień termin / pojazd" (wraca do kroku 3/2)
    "Złóż mimo to → do weryfikacji"

---

## NASTĘPNA SESJA

Zacznij od: **S3-001** (Edge Function parse-wz-pdf)
Wklej w Lovable → Edge Functions → New Function

---

## ZNANE PROBLEMY DO NAPRAWY

- [ ] Odbiorca w zleceniu ZL-MMVWSC9C jest błędny
  (wpisano sprzedawcę zamiast odbiorcy)
  Fix ręczny: dyspozytor → ✏️ edytuj zlecenie
  Poprawne dane z WZ KK/112/26/03/0005324:
    Odbiorca: Przedsiębiorstwo Maximus ZBH Muc Sp.K.
    Adres: ul. Wincentego Pola 38, 40-596 Katowice
    Masa: 375 kg, Tel: 509 013 198
