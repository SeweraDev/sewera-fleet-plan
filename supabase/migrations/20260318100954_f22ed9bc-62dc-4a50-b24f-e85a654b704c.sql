
-- 1. Assign roles to users
INSERT INTO public.user_roles (user_id, role)
SELECT au.id, 'sprzedawca'::app_role
FROM auth.users au WHERE au.email = 'sprzedawca@sewera.pl'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT au.id, 'dyspozytor'::app_role
FROM auth.users au WHERE au.email = 'dyspozytor@sewera.pl'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT au.id, 'kierowca'::app_role
FROM auth.users au WHERE au.email = 'kierowca@sewera.pl'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT au.id, 'zarzad'::app_role
FROM auth.users au WHERE au.email = 'zarzad@sewera.pl'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT au.id, 'admin'::app_role
FROM auth.users au WHERE au.email = 'admin@sewera.pl'
ON CONFLICT (user_id, role) DO NOTHING;

-- 2. Update profiles with branch info
UPDATE public.profiles SET branch = 'Gliwice'
WHERE id = (SELECT id FROM auth.users WHERE email = 'sprzedawca@sewera.pl');

UPDATE public.profiles SET branch = 'Katowice'
WHERE id = (SELECT id FROM auth.users WHERE email = 'dyspozytor@sewera.pl');

-- 3. Link kierowca@sewera.pl to kierowcy record
UPDATE public.kierowcy
SET user_id = (SELECT id FROM auth.users WHERE email = 'kierowca@sewera.pl')
WHERE imie_nazwisko = 'Michał S.';
