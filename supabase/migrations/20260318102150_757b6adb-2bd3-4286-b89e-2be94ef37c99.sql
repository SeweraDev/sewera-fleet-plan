
-- Oddziały
INSERT INTO oddzialy (nazwa) VALUES
  ('Katowice'),('Redystrybucja'),('Sosnowiec'),('Gliwice'),
  ('T.Góry'),('Chrzanów'),('D.Górnicza'),('Oświęcim'),('Dobromir');

-- Flota własna (objetosc_m3 is NOT NULL default 0, so use 0 instead of NULL)
INSERT INTO flota (nr_rej, typ, oddzial_id, ladownosc_kg, objetosc_m3, aktywny) VALUES
  ('SK726PY','HDS 11,7t',    (SELECT id FROM oddzialy WHERE nazwa='Katowice'),      11700, 0,    true),
  ('SK0355J','HDS 8,9t',     (SELECT id FROM oddzialy WHERE nazwa='Katowice'),       8900, 0,    true),
  ('SK6839G','HDS 8,9t',     (SELECT id FROM oddzialy WHERE nazwa='Katowice'),       8900, 0,    true),
  ('SK7839G','HDS 8,9t',     (SELECT id FROM oddzialy WHERE nazwa='Katowice'),       8900, 0,    true),
  ('SK0703J','Winda 6,3t',   (SELECT id FROM oddzialy WHERE nazwa='Katowice'),       6300, 32.0, true),
  ('SK3022G','Winda 6,3t',   (SELECT id FROM oddzialy WHERE nazwa='Katowice'),       6300, 32.0, true),
  ('SK720KH','Dostawczy 1,2t',(SELECT id FROM oddzialy WHERE nazwa='Katowice'),      1200, 18.5, true),
  ('SK8G013','Winda MAX 15,8t',(SELECT id FROM oddzialy WHERE nazwa='Redystrybucja'),15800,60.0, true),
  ('SK1035N','Winda 6,3t',   (SELECT id FROM oddzialy WHERE nazwa='Redystrybucja'),  6300, 32.0, true),
  ('SK159PW','Dostawczy 1,2t',(SELECT id FROM oddzialy WHERE nazwa='Gliwice'),       1200, 18.5, true),
  ('SK2115V','Winda 6,3t',   (SELECT id FROM oddzialy WHERE nazwa='Gliwice'),        6300, 32.0, true);

-- Kierowcy
INSERT INTO kierowcy (imie_nazwisko, uprawnienia, oddzial_id, aktywny) VALUES
  ('Michał S.',   'C',    (SELECT id FROM oddzialy WHERE nazwa='Katowice'),      true),
  ('Sebastian D.','C_HDS',(SELECT id FROM oddzialy WHERE nazwa='Katowice'),      true),
  ('Michał K.',   'C',    (SELECT id FROM oddzialy WHERE nazwa='Katowice'),      true),
  ('Nocoń W.',    'C',    (SELECT id FROM oddzialy WHERE nazwa='Sosnowiec'),     true),
  ('Michał B.',   'C',    (SELECT id FROM oddzialy WHERE nazwa='Sosnowiec'),     true),
  ('Piotr B.',    'C',    (SELECT id FROM oddzialy WHERE nazwa='Sosnowiec'),     true),
  ('Patryk S.',   'B',    (SELECT id FROM oddzialy WHERE nazwa='Gliwice'),       true),
  ('Janusz K.',   'B',    (SELECT id FROM oddzialy WHERE nazwa='Gliwice'),       true),
  ('Mikołaj B.',  'C',    (SELECT id FROM oddzialy WHERE nazwa='Gliwice'),       true),
  ('Bogumił S.',  'C_HDS',(SELECT id FROM oddzialy WHERE nazwa='T.Góry'),        true),
  ('Maciej S.',   'C',    (SELECT id FROM oddzialy WHERE nazwa='T.Góry'),        true),
  ('Adam B.',     'C_HDS',(SELECT id FROM oddzialy WHERE nazwa='Chrzanów'),      true),
  ('Marcin R.',   'C',    (SELECT id FROM oddzialy WHERE nazwa='Chrzanów'),      true),
  ('Adam S.',     'B',    (SELECT id FROM oddzialy WHERE nazwa='Chrzanów'),      true),
  ('Krzysztof K.','C_HDS',(SELECT id FROM oddzialy WHERE nazwa='Oświęcim'),      true),
  ('Sławomir R.', 'C_HDS',(SELECT id FROM oddzialy WHERE nazwa='Oświęcim'),      true),
  ('Tomasz F.',   'C',    (SELECT id FROM oddzialy WHERE nazwa='Oświęcim'),      true),
  ('Bartosz W.',  'C',    (SELECT id FROM oddzialy WHERE nazwa='D.Górnicza'),    true),
  ('Maciej F.',   'C',    (SELECT id FROM oddzialy WHERE nazwa='D.Górnicza'),    true),
  ('Marcin M.',   'C_HDS',(SELECT id FROM oddzialy WHERE nazwa='Redystrybucja'), true),
  ('Grzegorz K.', 'C',    (SELECT id FROM oddzialy WHERE nazwa='Redystrybucja'), true);

-- Flota zewnętrzna (only columns that exist in schema: firma, nr_rej, typ)
INSERT INTO flota_zewnetrzna (firma, nr_rej, typ) VALUES
  ('HDS Katowice','SL52567A','HDS 11,7t');

-- Powiąż kierowcę z kontem
UPDATE kierowcy
SET user_id = (SELECT id FROM auth.users WHERE email='kierowca@sewera.pl')
WHERE imie_nazwisko = 'Michał S.';
