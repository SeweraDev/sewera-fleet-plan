

## System Transportowy Sewera — Plan Struktury

### 1. Strony / Routes (`src/pages/`)

```
src/pages/
├── LoginPage.tsx                    — /login (public)
├── UnauthorizedPage.tsx             — /403
├── sprzedawca/
│   └── Dashboard.tsx                — /sprzedawca
├── dyspozytor/
│   └── Dashboard.tsx                — /dyspozytor
├── kierowca/
│   └── MojaTrasa.tsx                — /kierowca (mobile-first)
├── zarzad/
│   └── Dashboard.tsx                — /zarzad (read-only)
└── admin/
    └── Uzytkownicy.tsx              — /admin
```

Każda rola dostaje własny folder — gotowy na rozbudowę o podstrony (np. `/sprzedawca/zlecenia`, `/dyspozytor/flota`).

---

### 2. Struktura folderów

```
src/
├── api/                  — Zapytania Supabase (queries, mutations)
├── components/
│   ├── ui/               — shadcn/ui (istniejące, bez zmian)
│   ├── shared/           — Komponenty współdzielone między rolami
│   ├── sprzedawca/       — Komponenty specyficzne dla sprzedawcy
│   ├── dyspozytor/       — Komponenty specyficzne dla dyspozytora
│   ├── kierowca/         — Komponenty specyficzne dla kierowcy
│   ├── zarzad/           — Komponenty specyficzne dla zarządu
│   └── admin/            — Komponenty specyficzne dla admina
├── hooks/                — useAuth, useDebounce, etc.
├── lib/
│   ├── supabase.ts       — Klient Supabase
│   └── utils.ts          — (istniejący)
├── providers/
│   └── AuthProvider.tsx  — Context sesji + profilu
├── types/
│   ├── auth.ts           — Profile, Role, etc.
│   └── database.ts       — Typy tabel Supabase
└── pages/                — Jak wyżej
```

---

### 3. ProtectedRoute

Komponent-wrapper z props `allowedRoles: string[]`:

1. Pobiera `{ user, profile, loading }` z hooka `useAuth`
2. **Loading** → pełnoekranowy `LoadingScreen` z logotypem Sewera (pulse)
3. **Brak sesji** (`!user`) → redirect na `/login`
4. **Sesja OK, ale rola nie pasuje** → redirect na właściwą stronę wg `roles[0]` (lub `/403` jeśli brak ról)
5. **Sesja OK + rola OK** → renderuje `<Outlet />` / children

Zastosowanie w routingu:
```
<Route element={<ProtectedRoute allowedRoles={['dyspozytor']} />}>
  <Route path="/dyspozytor" element={<DyspozytoPage />} />
</Route>
```

---

### 4. Hook `useAuth` (via AuthProvider)

**Eksportuje:**
- `user` — obiekt `User | null` z Supabase Auth
- `profile` — `{ id, full_name, roles, branch } | null` z tabeli `user_profiles`
- `loading` — `boolean` (true podczas pobierania sesji + profilu)
- `signOut()` — wylogowanie + redirect na `/login`

**Logika:**
1. `onAuthStateChange` nasłuchuje zmian sesji (ustawiony PRZED `getSession`)
2. Po wykryciu sesji → `.from('user_profiles').select('*').eq('id', user.id).single()`
3. Wylogowanie → czyszczenie stanu + `supabase.auth.signOut()`

---

### 5. Redirect po logowaniu

Słownik mapujący `roles[0]` na ścieżkę:

| `roles[0]`   | Redirect        |
|---------------|-----------------|
| `admin`       | `/admin`        |
| `zarzad`      | `/zarzad`       |
| `dyspozytor`  | `//dyspozytor`  |
| `sprzedawca`  | `/sprzedawca`   |
| `kierowca`    | `/kierowca`     |

Route `/` → odczytuje `profile.roles[0]`, przekierowuje wg mapy. Użytkownik z wieloma rolami trafia tam, gdzie wskazuje pierwsza rola.

---

### 6. Shared Komponenty (`components/shared/`)

| Komponent        | Opis |
|------------------|------|
| **AppLayout**    | Wrapper: Sidebar (desktop) + Topbar + content area |
| **Sidebar**      | Nawigacja dynamiczna wg roli użytkownika, granatowe tło `#0f2744` |
| **Topbar**       | Breadcrumbs, nazwa użytkownika, przycisk wylogowania |
| **StatusBadge**  | Warianty kolorystyczne: "W trasie" (blue), "Dostarczono" (green), "Opóźnienie" (red) |
| **LoadingScreen**| Pełnoekranowy spinner z logotypem Sewera |
| **ConfirmDialog**| Modal do akcji destrukcyjnych (np. usuwanie zlecenia) |
| **ProtectedRoute**| Wrapper chroniący strony wg ról |
| **DataTable**    | Tabela z sortowaniem i filtrowaniem (bazowa dla wszystkich widoków) |

---

### 7. Design

- **Kolory:** Granatowy `#0f2744` (dominant), pomarańczowy `#f97316` (akcent), białe tło
- **Font:** Geist Sans, `tabular-nums` w tabelach
- **Mobile-first** wyłącznie dla `/kierowca` (max 480px), reszta desktop-first z sidebar
- **Border-radius:** max 8px — operacyjny, techniczny charakter

---

### 8. Supabase (backend)

- Tabela `user_profiles`: `id (FK auth.users)`, `full_name`, `roles TEXT[]`, `branch TEXT`
- RLS na wszystkich tabelach
- Brak self-signup — admin tworzy konta via `supabase.auth.admin.createUser()`
- Tabele docelowe: `vehicles`, `drivers`, `orders`, `order_documents`, `routes`, `route_stops`, `vehicle_availability`

> **Pierwszy krok implementacji:** AuthProvider + LoginPage + ProtectedRoute + AppLayout z pustymi dashboardami dla każdej roli.

