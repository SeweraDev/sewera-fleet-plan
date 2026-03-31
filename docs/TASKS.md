# TASKS.md — Aktualne zadania
📅 Ostatnia aktualizacja: 2026-03-30

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
- [x] **FIX-014** — decodePUA: generyczny dekoder (offset = Unicode codepoint) zamiast ręcznej mapy ✅ 2026-03-30
- [x] **FIX-015** — decodePUA: baza 0x100000 (Supplementary PUA-B) — root cause błędu dekodowania ✅ 2026-03-30
- [x] **FIX-016** — cleanText: rozszerzony regex o U+2000-U+215F (dashes, cudzysłowy, €) ✅ 2026-03-30
- [x] **FIX-017** — masa_kg: ostatnia liczba przed RAZEM: (obsługuje PDF table layout) ✅ 2026-03-30
- [x] **FIX-018** — adres: 4 priorytety (forward, backward, Budowa, siedziba firmy) ✅ 2026-03-30
- [x] **FIX-019** — tel: backward + forward od delivery anchor, obsługa myślników ✅ 2026-03-30
- [x] **FIX-020** — uwagi: obsługa "Uwagi dot. wysyłki:", stop na "Wystawił:" ✅ 2026-03-30
- [x] **FIX-021** — os.kontaktowa: regex na pełnym tekście, zbiera WSZYSTKIE kontakty + tel ✅ 2026-03-30
- [x] **FIX-022** — odbiorca: skip pozycji towarowych, producentów w nawiasach, S.A.?, S.C. ✅ 2026-03-30
- [x] **FIX-023** — odbiorca: nazwa + adres siedziby + kontynuacja nazwy firmy ✅ 2026-03-30
- [x] **FIX-024** — WZS: obsługa prefixu WZS oprócz WZ ✅ 2026-03-30
- [x] **FIX-025** — m³/palety: wyłączona auto-ekstrakcja z nazw towarów (ręczne wpisywanie) ✅ 2026-03-30
- [x] **FIX-026** — merge PasteTab: fallback na local parser dla osoba_kontaktowa ✅ 2026-03-30

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

- [ ] **Edge function parse-wz-pdf** — wymaga redeployu na Supabase
  Kod OK (baza 0x100000 w repo). Uruchom: `npx supabase functions deploy parse-wz-pdf --project-ref nnjsfeipkuesdxfljgul`
- [ ] **BUG-001: Zlecenie ZL-MMVWSC9C** — błędne dane (sprzedawca zamiast odbiorcy)
  Fix: SQL UPDATE w Supabase SQL Editor (patrz BUGS.md)
- [ ] **Lovable gitsync 403** — reconnect GitHub w Lovable Dashboard → Settings → GitHub Integration
