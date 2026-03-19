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

## UKOŃCZONY SPRINT: Sprint 3 — Import WZ + Rezerwacje

Wszystkie zadania Sprintu 3 (Bloki A–D) zostały ukończone ✅

---

### BLOK A: Import PDF (Edge Functions)

- [x] **S3-001** — Edge Function `parse-wz-pdf` ✅ 2026-03-19
- [x] **S3-002** — Edge Function `parse-excel-plan` ✅ 2026-03-19
- [x] **S3-003** — Komponent `ModalImportWZ` (shared) ✅ 2026-03-19
- [x] **S3-004** — Integracja importu w SprzedawcaPage ✅ 2026-03-19
- [x] **S3-005** — Integracja importu w DyspozytoPage ✅ 2026-03-19
- [x] **S3-006** — Domówienie kierowcy (KierowcaPage) ✅ 2026-03-19

### BLOK B: Import Excel — plan kursów (dyspozytor)

- [x] **S3B-001** — Modal importu planu Excela (DyspozytoPage) ✅ 2026-03-19
- [x] **S3B-002** — Lista A-I w formularzu zlecenia (SprzedawcaPage) ✅ 2026-03-19
- [x] **S3B-003** — Import WZ z Excela (SprzedawcaPage) ✅ 2026-03-19

### BLOK C: Rezerwacje i deadline WZ

- [x] **S3C-001** — Migracja deadline_wz ✅
- [x] **S3C-002** — Edge Function `check-deadline-wz` ✅ 2026-03-19
- [x] **S3C-003** — Tabela powiadomienia + UI bell w Topbarze ✅ 2026-03-19
- [x] **S3C-004** — UI deadline w SprzedawcaPage ✅ 2026-03-19
- [x] **S3C-005** — UI flag u dyspozytora (DyspozytoPage) ✅ 2026-03-19

### BLOK D: Weryfikacja zajętości przy składaniu zlecenia

- [x] **S3D-001** — Sprawdzanie dostępności w formularzu (SprzedawcaPage) ✅ 2026-03-19

---

## POPRAWKI PO SPRINCIE 3 (2026-03-19)

- [x] **FIX-001** — Edge Function parse-wz-pdf: Buffer → Uint8Array (Deno) ✅ 2026-03-19
- [x] **FIX-002** — Parser tekstu WZ: nr zamówienia R7/ oprócz T7/ ✅ 2026-03-19
- [x] **FIX-003** — Parser tekstu WZ: odbiorca bez prefixu "Odbiorca:" ✅ 2026-03-19
- [x] **FIX-004** — Parser tekstu WZ: masa "Waga netto razem: X" bez "kg" ✅ 2026-03-19

---

## NASTĘPNY SPRINT: Sprint 4 — do zaplanowania

Możliwe kierunki:
- Optymalizacja tras (Google Maps API)
- Raportowanie i eksport danych
- Powiadomienia push/email
- Panel admina — pełne CRUD użytkowników
- Integracja z ERP (API dwukierunkowe)

---

## ZNANE PROBLEMY DO NAPRAWY

- [ ] Odbiorca w zleceniu ZL-MMVWSC9C jest błędny
  (wpisano sprzedawcę zamiast odbiorcy)
  Fix ręczny: dyspozytor → ✏️ edytuj zlecenie
