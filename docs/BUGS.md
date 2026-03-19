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

### BUG-002 — Import WZ z PDF nie działa (mock)
**Status:** 🔴 Aktywny — zaplanowany Sprint 3
**Gdzie:** SprzedawcaPage / DyspozytoPage — zakładka 📷 PDF
**Opis:** Przycisk "Wgraj zdjęcie WZ" nie parsuje danych —
to jest placeholder bez prawdziwej Edge Function.
**Fix:** Implementacja S3-001 (Edge Function parse-wz-pdf)

---

### BUG-003 — Import XLS nie działa (mock)
**Status:** 🔴 Aktywny — zaplanowany Sprint 3B
**Gdzie:** SprzedawcaPage / DyspozytoPage — zakładka 📊 XLS
**Opis:** Zakładka XLS nie wywołuje Edge Function.
**Fix:** Implementacja S3-002 (Edge Function parse-excel-plan)

---

### BUG-006 — Weryfikacja zajętości nie sprawdza masy/m³/palet
**Status:** 🔴 Aktywny — zaplanowany Sprint 3D
**Gdzie:** SprzedawcaPage — formularz zlecenia krok 2-4
**Opis:** Dostępność auta sprawdzana tylko orientacyjnie
(bez znajomości masy bo WZ w kroku 5). Po wpisaniu WZ
brak ostrzeżenia gdy ładunek przekracza pojemność auta.
**Fix:** Implementacja S3D-001

---

## 🟡 W TRAKCIE

*(brak)*

---

## ✅ NAPRAWIONE

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
