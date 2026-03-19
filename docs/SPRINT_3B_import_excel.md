# SPRINT 3B — Import Excel (plan kursów + WZ)
📅 Data: 2026-03-19
🎯 Cel: Import pliku Excel z ERP — dyspozytor importuje plan dnia,
       sprzedawca importuje WZ ze zlecenia.

---

## Mapowanie typów pojazdów (kod ERP → system)

| Kod | Opis w ERP | Typ w systemie |
|-----|-----------|----------------|
| ~~A~~ | ~~BEZ WINDY DO 700 KG~~ | ~~pominięty~~ |
| B | BEZ WINDY DO 1,2T | Dostawczy 1,2t |
| C | WINDA DO 1,8T | Winda 1,8t |
| D | WINDA DO 6T | Winda 6,3t |
| E | WINDA DUŻA MAX 15,8T | Winda MAX 15,8t |
| F | HDS DUŻY | HDS 11,7t |
| G | HDS DUŻY + PRZYCZEPA | HDS 11,7t |
| H | HDS ŚREDNI | HDS 8,9t |
| H | HDS ŚREDNI OŚWIĘCIM | HDS 8,9t |
| I | HDS ŚREDNI + PRZYCZEPA | HDS 8,9t |
| I | HDS ŚREDNI OŚWIĘCIM + PRZYCZEPA | HDS 8,9t |

---

## TICKET S3B-001 — Edge Function: parse-excel-plan

```
KONTEKST: Nowa Edge Function do parsowania planu kursów z Excela.

ZADANIE: Stwórz Edge Function "parse-excel-plan".
Biblioteka: xlsx (SheetJS, npm)

Funkcja przyjmuje: multipart/form-data z plikiem XLS/XLSX
Funkcja zwraca: JSON z listą kursów i zleceń

── STRUKTURA PLIKU (szukaj po nazwach nagłówków) ──

Nagłówki kolumn do rozpoznania (case insensitive, trim):
  KIEROWCA / KIER       → kierowca (imię lub imię+nazwisko)
  KURS                  → nr kursu w pliku (1 KURS, 2 KURS itd.)
  KOD / NR INDEKSU      → kod kontrahenta (ignoruj)
  NAZWA KONTRAHENTA /
  KONTRAHENT            → odbiorca
  MIEJSCOWOŚĆ / MIASTO  → miasto dostawy
  ULICA / ADRES         → ulica dostawy
  NR WZ / WZ            → numer dokumentu WZ
  MASA / WAGA           → masa kg
  TYP SAMOCHODU /
  RODZAJ SAMOCHODU /
  TYP / KLASYFIKACJA    → kod typu pojazdu (A/B/C/D/E/F/G/H/I)
  RODZAJ DOSTAWY        → uwagi o rodzaju dostawy
  UWAGI / UWAGI DO ZAŁ. → uwagi dodatkowe

── MAPOWANIE TYPÓW POJAZDÓW ──
Zastosuj mapowanie:
  'A' → null (pomiń — typ nieobsługiwany, zaloguj ostrzeżenie)
  'B' → 'Dostawczy 1,2t'
  'C' → 'Winda 1,8t'
  'D' → 'Winda 6,3t'
  'E' → 'Winda MAX 15,8t'
  'F' → 'HDS 11,7t'
  'G' → 'HDS 11,7t'
  'H' → 'HDS 8,9t'
  'I' → 'HDS 8,9t'

── LOGIKA PARSOWANIA ──

1. Znajdź wiersz nagłówkowy (pierwszy wiersz gdzie jest
   przynajmniej 3 rozpoznane nagłówki)

2. Grupuj wiersze po KURS + KIEROWCA:
   Gdy zmienia się wartość w kolumnie KURS lub KIEROWCA
   → nowy kurs

3. Dla każdego kursu zbierz:
   {
     nr_kursu_w_pliku: string,    -- "1 KURS", "2 KURS"
     kierowca_nazwa: string,      -- "GRZEGORZ K 5,8 T WNDA SK1035N"
                                  -- wyciągnij samo imię/nazwisko
     kierowca_nr_rej: string,     -- wyciągnij nr rej z nazwy kierowcy
                                  -- wzorzec: [A-Z]{2}\d{4}[A-Z]
     typ_pojazdu_kod: string,     -- "D" (z pierwszego wiersza kursu)
     typ_pojazdu: string,         -- "Winda 6,3t" (po mapowaniu)
     zlecenia: [
       {
         nr_wz: string,
         odbiorca: string,
         miasto: string,
         ulica: string,
         adres_pelny: string,     -- miasto + ulica złączone
         masa_kg: number,
         rodzaj_dostawy: string,  -- np. "BORDA 7:30 ROZŁADUNEK RĘCZNY"
         uwagi: string,
         godzina_dostawy: string  -- wyciągnij z rodzaj_dostawy
                                  -- wzorzec: \d{1,2}:\d{2}
                                  -- np. "7:30" → "do 8:00"
                                  -- mapuj na sloty systemu:
                                  -- do 7:30 → "do 8:00"
                                  -- 7:30-9:30 → "do 10:00"
                                  -- 9:30-11:30 → "do 12:00"
                                  -- 11:30-13:30 → "do 14:00"
                                  -- 13:30-15:30 → "do 16:00"
       }
     ],
     suma_kg: number,             -- suma mas wszystkich zleceń
     liczba_wz: number
   }

4. Ignoruj wiersze z sumą (gdzie MASA jest sumą grupy)
   Rozpoznaj po: brak nr WZ w wierszu + masa jest sumą

ZWRACA:
{
  kursy: Kurs[],
  data_pliku: string | null,      -- jeśli jest data w nazwie pliku
  oddzial: string | null,         -- jeśli jest oddział w nagłówku
  liczba_kursow: number,
  liczba_wz: number,
  bledy: string[],                -- ostrzeżenia o nierozpoznanych wierszach
  pewnosc: number                 -- 0-100
}
```

---

## TICKET S3B-002 — Modal importu Excela (dyspozytor)

```
KONTEKST: DyspozytoPage — zakładka Kursy.

ZADANIE: Dodaj przycisk "📊 Importuj plan" obok "+ Nowy kurs".

Po kliknięciu otwiera modal "Import planu kursów z Excela"
(shadcn Dialog, szerokość 800px).

── KROK 1: Wybór pliku ──
Strefa drag & drop + "Wybierz plik Excel"
Accept: .xls, .xlsx
Max: 10MB

Po wyborze → wywołaj Edge Function parse-excel-plan
Podczas parsowania: spinner "Analizuję plik..."

── KROK 2: Podgląd i weryfikacja ──
Po parsowaniu pokaż podgląd zgrupowany po kursach:

┌─────────────────────────────────────────────┐
│ 🚛 KURS 1 · Winda 6,3t (D)                  │
│ Kierowca: Grzegorz K. · SK1035N             │
│ Suma: 4 396 kg · 3 rozładunki               │
│                                              │
│ # | Nr WZ              | Odbiorca    | Kg    │
│ 1 | RE/112/26/03/001208| ERFARB...   | 9     │
│ 2 | RE/112/26/03/001202| ERFARB...   | 2079  │
│ 3 | RE/112/26/03/001201| NARMAL...   | 2308  │
│                                              │
│ ⚠️ Kierowca "GRZEGORZ K" → Grzegorz K. ✓   │
│ ⚠️ Auto SK1035N → znaleziono w flocie ✓     │
└─────────────────────────────────────────────┘

Walidacja per kurs:
  ✅ Kierowca rozpoznany w tabeli kierowcy
  ✅ Nr rej. rozpoznany w tabeli flota
  ⚠️ Kierowca nierozpoznany → dropdown wyboru z listy
  ⚠️ Nr rej. nierozpoznany → dropdown wyboru z floty
  ❌ Suma kg przekracza ładowność auta → ostrzeżenie czerwone

Pole "Dzień importu" (date picker) — domyślnie dziś
  (Excel zwykle nie zawiera daty — dyspozytor ustawia ręcznie)

Checkbox per kurs: zaznacz które kursy importować
(domyślnie wszystkie zaznaczone)

── KROK 3: Zatwierdzenie ──
Przycisk "✅ Importuj zaznaczone kursy ([N])"

Po kliknięciu dla każdego zaznaczonego kursu:

  1. Dopasuj kierowcę:
     SELECT id FROM kierowcy
     WHERE imie_nazwisko ILIKE '%[imie]%'
     AND oddzial_id = [oddzialId]

  2. Dopasuj auto:
     SELECT id FROM flota WHERE nr_rej = [nr_rej]

  3. INSERT INTO kursy:
     { jednostka_id, dzien, flota_id, kierowca_id, status:'zaplanowany' }

  4. Dla każdego WZ w kursie:
     INSERT INTO zlecenia:
     { oddzial_id, typ_pojazdu, dzien, preferowana_godzina,
       nadawca_id: auth.uid(), status:'potwierdzona' }

     INSERT INTO zlecenia_wz:
     { zlecenie_id, nr_wz, odbiorca, adres, masa_kg, uwagi }

     INSERT INTO kurs_przystanki:
     { kurs_id, zlecenie_id, kolejnosc, status:'oczekuje' }

5. Toast "✅ Zaimportowano [N] kursów, [M] zleceń"
6. Zamknij modal, odśwież widok kursów

── OBSŁUGA BŁĘDÓW ──
Jeśli kurs ma błędy (brak kierowcy/auta) → zaznacz czerwono
Dyspozytor musi ręcznie wybrać z dropdownu przed zatwierdzeniem

NIE RUSZAJ: istniejące kursy, zakładka Flota, inne strony.
```

---

## TICKET S3B-003 — Wybór typu pojazdu A-I w formularzu

```
KONTEKST: Formularz nowego zlecenia (SprzedawcaPage) —
          krok wyboru pojazdu.

ZADANIE: Dodaj listę wyboru typów A-I jako alternatywę
dla kafelków pojazdów.

── ZMIANA W KROKU 2 FORMULARZA ──
Nad kafelkami pojazdów dodaj zakładki:
  📋 Wybierz typ (A-I)  |  🚛 Wybierz pojazd

Zakładka "📋 Wybierz typ (A-I)":
  Tabela/lista z kodami i opisami:

  | Kod | Opis | Typ w systemie |
  |-----|------|----------------|
  | B | Bez windy do 1,2t | Dostawczy 1,2t |
  | C | Winda do 1,8t | Winda 1,8t |
  | D | Winda do 6t | Winda 6,3t |
  | E | Winda duża MAX 15,8t | Winda MAX 15,8t |
  | F | HDS duży | HDS 11,7t |
  | G | HDS duży + przyczepa | HDS 11,7t |
  | H | HDS średni | HDS 8,9t |
  | I | HDS średni + przyczepa | HDS 8,9t |

  Kliknięcie wiersza = wybór tego typu
  Podświetlony wiersz: granatowe tło
  Po wyborze: automatycznie ustaw typ_pojazdu w stanie formularza

Zakładka "🚛 Wybierz pojazd":
  Obecne kafelki pojazdów bez zmian

Oba sposoby wyboru prowadzą do tego samego wyniku
(typ_pojazdu zapisany w zleceniu)

NIE RUSZAJ: kroki 1, 3, 4, 5 formularza, INSERT do bazy.
```

---

## TICKET S3B-004 — Import WZ z Excela (sprzedawca)

```
KONTEKST: SprzedawcaPage — krok WZ w formularzu zlecenia.

ZADANIE: W zakładce "📊 XLS/XLSX" w ModalImportWZ
dodaj parser pod strukturę planu kursów z Ekonom.

Sprzedawca może wgrać ten sam plik Excel co dyspozytor
i wybrać swój wiersz (swoje WZ).

── LOGIKA ──
Po wgraniu pliku → wywołaj Edge Function parse-excel-plan
Wynik: lista wszystkich WZ ze wszystkich kursów

Pokaż tabelę z wierszami:
  Checkbox | Nr WZ | Odbiorca | Miasto | Ulica | Masa kg | Typ

Sprzedawca zaznacza swoje WZ (jedno lub kilka)
Przycisk "✅ Użyj zaznaczonych WZ"

Po wyborze:
  Wypełnij formularz WZ danymi z wybranego wiersza:
    nr_wz       ← nr_wz
    odbiorca    ← odbiorca
    adres       ← adres_pelny (miasto + ulica)
    masa_kg     ← masa_kg
    uwagi       ← uwagi + rodzaj_dostawy
  Ustaw typ_pojazdu w formularzu ← typ_pojazdu z kolumny TYP

NIE RUSZAJ: inne zakładki importu, kroki 1-4 formularza.
```

---

## Checklist Sprint 3B — przed pinem

```
✅ Edge Function parse-excel-plan parsuje przykładowy plik
✅ Grupowanie po kursach działa poprawnie
✅ Kierowca wyciągany z nazwy kolumny (np. "GRZEGORZ K 5,8T SK1035N")
✅ Nr rej. wyciągany z nazwy kierowcy (wzorzec [A-Z]{2}\d{4}[A-Z])
✅ Typy A-I mapowane na typy systemowe
✅ Godziny mapowane na sloty (7:30 → "do 8:00")
✅ Modal podglądu pokazuje kursy z walidacją
✅ Nierozpoznany kierowca/auto → dropdown wyboru
✅ Import tworzy kursy + zlecenia + przystanki w bazie
✅ Sprzedawca może wybrać swój WZ z pliku
✅ Formularz wypełnia się danymi z wybranego wiersza
✅ Lista A-I dostępna w kroku wyboru pojazdu
→ PIN
```

---

## Kolejność wykonania

```
S3B-001  Edge Function parse-excel-plan   → Lovable Edge Functions
S3B-002  Modal importu (dyspozytor)       → implementacja
S3B-003  Lista A-I w formularzu           → implementacja
S3B-004  Import WZ z Excela (sprzedawca) → implementacja
→ PIN
```
