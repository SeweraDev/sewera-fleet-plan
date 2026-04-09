import { useState, useEffect, useCallback } from 'react';
import { Topbar } from '@/components/shared/Topbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useOddzialy } from '@/hooks/useOddzialy';
import { toast } from 'sonner';
import { UserPlus, Trash2, Edit2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ROLE_LABELS } from '@/types';
import type { UserRole } from '@/types';

interface UserRow {
  id: string;
  full_name: string;
  branch: string | null;
  created_at: string;
  roles: UserRole[];
  email: string | null;
}

const ALL_ROLES: UserRole[] = ['sprzedawca', 'dyspozytor', 'kierowca', 'zarzad', 'admin'];

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-800',
  zarzad: 'bg-purple-100 text-purple-800',
  dyspozytor: 'bg-blue-100 text-blue-800',
  sprzedawca: 'bg-green-100 text-green-800',
  kierowca: 'bg-orange-100 text-orange-800',
};

export default function AdminUzytkownicy() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { oddzialy } = useOddzialy();

  // Formularz nowego użytkownika
  const [showAdd, setShowAdd] = useState(false);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formBranch, setFormBranch] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('sprzedawca');
  const [creating, setCreating] = useState(false);

  // Edycja
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editBranch, setEditBranch] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('sprzedawca');
  const [saving, setSaving] = useState(false);

  // Usuwanie
  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);

    // Pobierz profile
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, branch, created_at')
      .order('created_at', { ascending: false });

    if (!profiles) { setLoading(false); return; }

    // Pobierz role
    const { data: rolesData } = await supabase
      .from('user_roles')
      .select('user_id, role');

    const rolesMap = new Map<string, UserRole[]>();
    (rolesData || []).forEach(r => {
      const list = rolesMap.get(r.user_id) || [];
      list.push(r.role as UserRole);
      rolesMap.set(r.user_id, list);
    });

    // Pobierz emaile z auth.users przez funkcję RPC (jeśli istnieje) lub profiles
    // Bez service_role key nie mamy dostępu do auth.users — email przechowujemy w profilu
    // Na razie email = null (widoczny dopiero po dodaniu kolumny email do profiles)

    const mapped: UserRow[] = profiles.map(p => ({
      id: p.id,
      full_name: p.full_name || '',
      branch: p.branch,
      created_at: p.created_at,
      roles: rolesMap.get(p.id) || [],
      email: null,
    }));

    setUsers(mapped);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Tworzenie użytkownika
  const handleCreate = async () => {
    if (!formName.trim() || !formEmail.trim() || !formPassword.trim()) {
      toast.error('Wypełnij wszystkie pola');
      return;
    }
    setCreating(true);

    // Zapisz aktualną sesję admina
    const { data: sessionData } = await supabase.auth.getSession();
    const adminSession = sessionData?.session;

    try {
      // 1. Utwórz konto auth
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: formEmail.trim(),
        password: formPassword.trim(),
        options: {
          data: { full_name: formName.trim() },
        },
      });

      if (signUpError) {
        toast.error('Błąd tworzenia konta: ' + signUpError.message);
        setCreating(false);
        return;
      }

      const newUserId = signUpData.user?.id;
      if (!newUserId) {
        toast.error('Nie udało się pobrać ID nowego użytkownika');
        setCreating(false);
        return;
      }

      // 2. Przywróć sesję admina (signUp wylogowuje)
      if (adminSession?.refresh_token) {
        await supabase.auth.setSession({
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token,
        });
      }

      // 3. Utwórz profil
      await supabase.from('profiles').upsert({
        id: newUserId,
        full_name: formName.trim(),
        branch: formBranch || null,
      } as any);

      // 4. Dodaj rolę
      await supabase.from('user_roles').insert({
        user_id: newUserId,
        role: formRole,
      } as any);

      toast.success(`Użytkownik ${formName.trim()} utworzony!`);
      setShowAdd(false);
      setFormName('');
      setFormEmail('');
      setFormPassword('');
      setFormBranch('');
      setFormRole('sprzedawca');
      fetchUsers();
    } catch (e: any) {
      toast.error('Błąd: ' + (e.message || 'Nieznany'));
    }

    setCreating(false);
  };

  // Edycja użytkownika
  const openEdit = (u: UserRow) => {
    setEditUser(u);
    setEditName(u.full_name);
    setEditBranch(u.branch || '');
    setEditRole(u.roles[0] || 'sprzedawca');
  };

  const handleSaveEdit = async () => {
    if (!editUser) return;
    setSaving(true);

    await supabase.from('profiles').update({
      full_name: editName.trim(),
      branch: editBranch || null,
    } as any).eq('id', editUser.id);

    // Zmień rolę — usuń starą, dodaj nową
    await supabase.from('user_roles').delete().eq('user_id', editUser.id);
    await supabase.from('user_roles').insert({
      user_id: editUser.id,
      role: editRole,
    } as any);

    toast.success('Zapisano zmiany');
    setEditUser(null);
    setSaving(false);
    fetchUsers();
  };

  // Usuwanie (dezaktywacja — usuwamy profil i role, konto auth zostaje)
  const handleDelete = async () => {
    if (!deleteUser) return;
    await supabase.from('user_roles').delete().eq('user_id', deleteUser.id);
    await supabase.from('profiles').delete().eq('id', deleteUser.id);
    toast.success('Użytkownik usunięty');
    setDeleteUser(null);
    fetchUsers();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Topbar />
      <main className="flex-1 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Użytkownicy</h1>
          <Button onClick={() => setShowAdd(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Dodaj użytkownika
          </Button>
        </div>

        {/* Lista */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Ładowanie...</div>
            ) : users.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">Brak użytkowników</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Imię i nazwisko</TableHead>
                    <TableHead>Oddział</TableHead>
                    <TableHead>Rola</TableHead>
                    <TableHead>Data dodania</TableHead>
                    <TableHead className="w-24">Akcje</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(u => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.full_name || '—'}</TableCell>
                      <TableCell>{u.branch || '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {u.roles.map(r => (
                            <Badge key={r} variant="secondary" className={ROLE_COLORS[r] || ''}>
                              {ROLE_LABELS[r] || r}
                            </Badge>
                          ))}
                          {u.roles.length === 0 && <span className="text-muted-foreground text-xs">brak roli</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(u.created_at).toLocaleDateString('pl-PL')}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteUser(u)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Dialog: Dodaj użytkownika */}
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Dodaj użytkownika</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Imię i nazwisko</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Jan Kowalski" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="jan.kowalski@sewera.pl" />
              </div>
              <div>
                <Label>Hasło</Label>
                <Input type="text" value={formPassword} onChange={e => setFormPassword(e.target.value)} placeholder="Sewera2026!" />
              </div>
              <div>
                <Label>Oddział</Label>
                <Select value={formBranch} onValueChange={setFormBranch}>
                  <SelectTrigger><SelectValue placeholder="Wybierz oddział" /></SelectTrigger>
                  <SelectContent>
                    {oddzialy.map(o => (
                      <SelectItem key={o.id} value={o.nazwa}>{o.nazwa}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Rola</Label>
                <Select value={formRole} onValueChange={v => setFormRole(v as UserRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.map(r => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAdd(false)}>Anuluj</Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? 'Tworzę...' : 'Utwórz konto'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: Edytuj użytkownika */}
        <Dialog open={!!editUser} onOpenChange={open => { if (!open) setEditUser(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edytuj użytkownika</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Imię i nazwisko</Label>
                <Input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div>
                <Label>Oddział</Label>
                <Select value={editBranch} onValueChange={setEditBranch}>
                  <SelectTrigger><SelectValue placeholder="Wybierz oddział" /></SelectTrigger>
                  <SelectContent>
                    {oddzialy.map(o => (
                      <SelectItem key={o.id} value={o.nazwa}>{o.nazwa}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Rola</Label>
                <Select value={editRole} onValueChange={v => setEditRole(v as UserRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.map(r => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditUser(null)}>Anuluj</Button>
              <Button onClick={handleSaveEdit} disabled={saving}>
                {saving ? 'Zapisuję...' : 'Zapisz'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: Usuń */}
        <ConfirmDialog
          open={!!deleteUser}
          onOpenChange={open => { if (!open) setDeleteUser(null); }}
          title="Usunąć użytkownika?"
          description={`Czy na pewno chcesz usunąć ${deleteUser?.full_name}? Profil i rola zostaną usunięte. Konto auth pozostanie (można je usunąć w Supabase).`}
          confirmLabel="Usuń"
          destructive
          onConfirm={handleDelete}
        />
      </main>
    </div>
  );
}
