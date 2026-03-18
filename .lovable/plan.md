

## Plan: Włączenie Lovable Cloud i implementacja backendu

### 1. Włączenie Lovable Cloud (Supabase)
Aktywacja Lovable Cloud w regionie Europa — to stworzy instancję Supabase z bazą danych.

### 2. Struktura bazy danych

**Tabela `profiles`** (automatycznie tworzona przez trigger przy rejestracji):
- `id` UUID (FK → auth.users, ON DELETE CASCADE)
- `full_name` TEXT
- `branch` TEXT (nullable)
- `created_at` TIMESTAMPTZ

**Tabela `user_roles`** (osobna tabela ról — zgodnie z best practices bezpieczeństwa):
- `id` UUID (PK)
- `user_id` UUID (FK → auth.users, ON DELETE CASCADE)
- `role` app_role ENUM ('admin', 'zarzad', 'dyspozytor', 'sprzedawca', 'kierowca')
- UNIQUE(user_id, role)

**Funkcja `has_role`** (SECURITY DEFINER) — zapobiega rekurencji RLS.

**Polityki RLS:**
- `profiles`: użytkownik widzi swój profil; admin widzi wszystkie
- `user_roles`: użytkownik widzi swoje role; admin widzi/zarządza wszystkimi

**Trigger** `on_auth_user_created` — automatycznie tworzy wiersz w `profiles` po rejestracji.

### 3. Aktualizacja AuthProvider
Zamiana mockowanej logiki na prawdziwy Supabase:
- `supabase.auth.signInWithPassword()` zamiast mock signIn
- `onAuthStateChange` + `getSession` do śledzenia sesji
- Pobieranie profilu z `profiles` + ról z `user_roles`
- `supabase.auth.signOut()` zamiast mock signOut

### 4. Utworzenie `src/integrations/supabase/client.ts`
Klient Supabase z auto-generowanymi typami.

### 5. Seed data
Utworzenie testowych użytkowników (admin, dyspozytor, sprzedawca, kierowca, zarzad) z odpowiednimi rolami w bazie.

### Kolejność implementacji
1. Włącz Lovable Cloud
2. Migracje: enum → profiles → user_roles → trigger → RLS → has_role
3. Zaktualizuj AuthProvider na prawdziwy Supabase
4. Dodaj seed użytkowników przez SQL

