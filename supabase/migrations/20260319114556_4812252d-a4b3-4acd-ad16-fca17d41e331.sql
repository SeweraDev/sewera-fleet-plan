
-- Dodaj kolumny do tabeli zlecenia
ALTER TABLE zlecenia
  ADD COLUMN IF NOT EXISTS deadline_wz TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ma_wz BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flaga_brak_wz BOOLEAN NOT NULL DEFAULT false;

-- Funkcja obliczająca deadline (2 dni robocze przed, godz. 16:00)
CREATE OR REPLACE FUNCTION oblicz_deadline_wz(dzien_dostawy DATE)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  deadline DATE;
  dni_cofniete INT := 0;
  sprawdzany DATE;
BEGIN
  sprawdzany := dzien_dostawy - INTERVAL '1 day';
  WHILE dni_cofniete < 2 LOOP
    IF EXTRACT(DOW FROM sprawdzany) NOT IN (0, 6) THEN
      dni_cofniete := dni_cofniete + 1;
      IF dni_cofniete = 2 THEN
        deadline := sprawdzany;
      END IF;
    END IF;
    IF dni_cofniete < 2 THEN
      sprawdzany := sprawdzany - INTERVAL '1 day';
    END IF;
  END LOOP;
  RETURN (deadline || ' 16:00:00')::TIMESTAMPTZ;
END;
$$ LANGUAGE plpgsql;

-- Trigger: ustaw deadline_wz przy INSERT zlecenia
CREATE OR REPLACE FUNCTION set_deadline_wz()
RETURNS TRIGGER AS $$
BEGIN
  NEW.deadline_wz := oblicz_deadline_wz(NEW.dzien::DATE);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_deadline_wz
  BEFORE INSERT ON zlecenia
  FOR EACH ROW
  EXECUTE FUNCTION set_deadline_wz();

-- Trigger: ustaw ma_wz = true gdy dodano pierwszy WZ
CREATE OR REPLACE FUNCTION update_ma_wz()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE zlecenia SET ma_wz = true
  WHERE id = NEW.zlecenie_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_ma_wz
  AFTER INSERT ON zlecenia_wz
  FOR EACH ROW
  EXECUTE FUNCTION update_ma_wz();
