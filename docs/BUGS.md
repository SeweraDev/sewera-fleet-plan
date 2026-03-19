# BUGS.md — Znane błędy i status
📅 Ostatnia aktualizacja: 2026-03-19

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

### BUG-F08 — Brak powiadomień bell w Topbarze (BUG-004)
**Naprawiony:** Sprint 3C — 2026-03-19
**Fix:** NotificationBell + usePowiadomienia + Realtime

### BUG-F09 — Brak informacji o deadline WZ (BUG-005)
**Naprawiony:** Sprint 3C — 2026-03-19
**Fix:** DeadlineBadge w MojeZleceniaTab (🟢/🟡/🔴)

### BUG-F10 — Cron check-deadline-wz nie istnieje (BUG-007)
**Naprawiony:** Sprint 3C — 2026-03-19
**Fix:** Edge Function check-deadline-wz + pg_cron co godzinę

### BUG-F01 — Auth hardcoded zamiast Supabase
**Naprawiony:** Sprint 1.5
**Fix:** Przepisano useAuth + LoginPage

### BUG-F02 — Tabele puste po uruchomieniu SQL
**Naprawiony:** Po Sprint 2
**Fix:** Seed wgrany przez Lovable chat

### BUG-F03 — UNHANDLED_PROMISE_REJECTION w DyspozytoPage
**Naprawiony:** Sprint 2B
**Fix:** async przeniesione do useEffect

### BUG-F04 — Dyspozytor nie widział swojego oddziału
**Naprawiony:** Sprint 2B
**Fix:** Auto-set oddziału z user_roles przy mount

### BUG-F05 — Kalendarz pokazywał weekendy
**Naprawiony:** Sprint 2B
**Fix:** Filtr DOW (1-5) w funkcji generowania dni

### BUG-F06 — Palety hardcoded 33 zamiast z bazy
**Naprawiony:** Sprint 2B
**Fix:** max_palet pobierany z tabeli flota

### BUG-F07 — flota.objetosc_m3 NOT NULL blokowało INSERT
**Naprawiony:** Migracja
**Fix:** ALTER COLUMN objetosc_m3 DROP NOT NULL
