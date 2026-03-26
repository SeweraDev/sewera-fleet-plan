# BUGS.md — Znane błędy i status
📅 Ostatnia aktualizacja: 2026-03-26

---

## JAK UŻYWAĆ

Gdy znajdziesz błąd — dodaj tutaj przed naprawą.
Po naprawie: zmień status na ✅ i przenieś do sekcji Naprawione.

Format:
```
### BUG-XXX — Krótki opis
**Status:** 🔴 Aktywny / 🟡 W trakcie / ✅ Naprawiony
**Gdzie:** strona/komponent
**Opis:** co się dzieje
**Kroki:** jak odtworzyć
**Fix:** co zrobić / co zrobiono
```

---

## 🔴 AKTYWNE

### BUG-001 — Błędne dane w zleceniu ZL-MMVWSC9C
**Status:** 🔴 Aktywny
**Gdzie:** DyspozytoPage — zakładka Zlecenia
**Opis:** Zlecenie ma wpisane dane sprzedawcy zamiast odbiorcy.
Odbiorca: SEWERA POLSKA CHEMIA (błąd) zamiast MAXIMUS ZBH MUC
Adres: ul. Kościuszki 326 (błąd) zamiast ul. Wincentego Pola 38
Masa: 25 kg (błąd) zamiast 375 kg
**Fix:** Ręcznie przez dyspozytora → ✏️ edytuj zlecenie:
  Odbiorca: Przedsiębiorstwo Maximus ZBH Muc Sp.K.
  Adres: ul. Wincentego Pola 38, 40-596 Katowice
  Telefon: 509 013 198
  Masa: 375 kg
  Nr WZ: WZ KK/112/26/03/0005324
  Nr zamówienia: T7/KK/2026/03/00122
  Uwagi: domówienie

---

## 🟡 W TRAKCIE

*(brak)*

---

## ✅ NAPRAWIONE

### BUG-F21 — decodePUA nie obsługiwała zakresu F000
**Naprawiony:** 2026-03-26
**Fix:** Dodano dual-offset buildMap (0xE000 + 0xF000) w decodePUA

### BUG-F20 — parseSeweraDoc KROK 4/5: brak obsługi nagłówków PZ i nazwy obiektu
**Naprawiony:** 2026-03-26
**Fix:** KROK 4: dodano break na OdbiorcaInformacje; KROK 5: nazwaObiektu (Budowa/Hala/...) jako prefix adresu

### BUG-F19 — PasteTab: przycisk "Parsuj tekst" disabled mimo wklejonego tekstu
**Naprawiony:** 2026-03-25
**Fix:** Zmieniono warunek `!text.trim()` na `text.length === 0` — znaki PUA z PDF były traktowane jako whitespace

### BUG-F15 — Parser PDF: masa_kg brała przedostatni numer zamiast ostatniego
**Naprawiony:** 2026-03-20
**Fix:** Zmieniono `numery[numery.length - 2]` na `numery[numery.length - 1]`

### BUG-F16 — Parser PDF: kontakty nie parsowały osoby kontaktowej poprawnie
**Naprawiony:** 2026-03-20
**Fix:** Nowa logika zbierania kontaktów: Os. kontaktowa, Tel., imię+tel w jednej linii

### BUG-F17 — Parser PDF: nabywca KROK 4 nie rozpoznawał firmy poprawnie
**Naprawiony:** 2026-03-20
**Fix:** Rozdzielono logikę PZ (po linii `nr:`) vs WZ (po adresie oddziału SEWERA)

### BUG-F18 — Parser PDF: lines is not defined (runtime error 500)
**Naprawiony:** 2026-03-20
**Fix:** Dodano brakującą deklarację `const lines = text.split('\n')...` na początku parsera

### BUG-F11 — Edge Function parse-wz-pdf: Buffer is not defined
**Naprawiony:** 2026-03-19
**Fix:** Zamieniono `Buffer.from(buffer)` na `new Uint8Array(buffer)` (Deno nie ma Node Buffer)

### BUG-F12 — Parser tekstu WZ nie rozpoznaje nr zamówienia R7/
**Naprawiony:** 2026-03-19
**Fix:** Regex zamieniony z `T7/` na `[A-Z]\d/` — obsługuje R7/, T7/ i inne

### BUG-F13 — Parser tekstu WZ nie rozpoznaje odbiorcy bez prefixu
**Naprawiony:** 2026-03-19
**Fix:** Dodano fallback rozpoznający nazwy firm (SPÓŁKA Z O.O., S.A., SP.K. itd.)

### BUG-F14 — Parser tekstu WZ nie łapie masy bez "kg"
**Naprawiony:** 2026-03-19
**Fix:** Dodano fallback regex `wag[aę] netto razem: X` bez wymaganego suffixu "kg"

### BUG-F08 — Brak powiadomień bell w Topbarze
**Naprawiony:** Sprint 3C — 2026-03-19

### BUG-F09 — Brak informacji o deadline WZ
**Naprawiony:** Sprint 3C — 2026-03-19

### BUG-F10 — Cron check-deadline-wz nie istnieje
**Naprawiony:** Sprint 3C — 2026-03-19

### BUG-F01–F07 — Starsze naprawione błędy
Szczegóły w `docs/HISTORY_TASKS.md`
