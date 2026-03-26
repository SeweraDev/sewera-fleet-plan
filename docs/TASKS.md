# TASKS.md — Aktualne zadania
📅 Ostatnia aktualizacja: 2026-03-26

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

## UKOŃCZONE SPRINTY

Wszystkie zadania Sprintów 0–3 (Bloki A–D) zostały ukończone ✅
Szczegóły w `docs/HISTORY_TASKS.md`

---

## POPRAWKI PO SPRINCIE 3

- [x] **FIX-001** — Edge Function parse-wz-pdf: Buffer → Uint8Array (Deno) ✅ 2026-03-19
- [x] **FIX-002** — Parser tekstu WZ: nr zamówienia R7/ oprócz T7/ ✅ 2026-03-19
- [x] **FIX-003** — Parser tekstu WZ: odbiorca bez prefixu "Odbiorca:" ✅ 2026-03-19
- [x] **FIX-004** — Parser tekstu WZ: masa "Waga netto razem: X" bez "kg" ✅ 2026-03-19
- [x] **FIX-005** — Parser PDF: masa_kg — bierze ostatni numer (nie przedostatni) ✅ 2026-03-20
- [x] **FIX-006** — Parser PDF: kontakty — obsługa osoby kontaktowej + tel w różnych formatach ✅ 2026-03-20
- [x] **FIX-007** — Parser PDF: nabywca KROK 4 — rozdzielenie PZ vs WZ (szuka po adresie SEWERA) ✅ 2026-03-20
- [x] **FIX-008** — Parser PDF: lines is not defined — dodano brakującą deklarację ✅ 2026-03-20
- [x] **FIX-009** — PasteTab: disabled przycisk na text.trim() → text.length===0 (PUA chars) ✅ 2026-03-25
- [x] **FIX-010** — decodePUA: dual-offset (0xE000 + 0xF000) dla dokumentów Sewery ✅ 2026-03-26
- [x] **FIX-011** — parseSeweraDoc KROK 4: obsługa nagłówków OdbiorcaInformacje/NabywcaSprzedawca ✅ 2026-03-26
- [x] **FIX-012** — parseSeweraDoc KROK 5: nazwaObiektu (Budowa/Plac/Hala...) jako prefix adresu ✅ 2026-03-26
- [x] **FIX-013** — parse-wz-pdf: console.log AFTER_CLEAN_START do debugowania dekodowania PUA ✅ 2026-03-26

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
