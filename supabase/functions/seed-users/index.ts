import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SEED_USERS = [
  { email: "admin@sewera.pl", password: "Admin123!", full_name: "Jan Kowalski", role: "admin", branch: null },
  { email: "zarzad@sewera.pl", password: "Zarzad123!", full_name: "Anna Nowak", role: "zarzad", branch: null },
  { email: "dyspozytor@sewera.pl", password: "Dysp123!", full_name: "Piotr Wiśniewski", role: "dyspozytor", branch: "Warszawa" },
  { email: "sprzedawca@sewera.pl", password: "Sprz123!", full_name: "Maria Zielińska", role: "sprzedawca", branch: "Kraków" },
  { email: "kierowca@sewera.pl", password: "Kier123!", full_name: "Tomasz Lewandowski", role: "kierowca", branch: "Warszawa" },
];

Deno.serve(async (req) => {
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results = [];

  for (const u of SEED_USERS) {
    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { full_name: u.full_name },
    });

    if (authError) {
      results.push({ email: u.email, error: authError.message });
      continue;
    }

    const userId = authData.user.id;

    // Update profile with branch
    if (u.branch) {
      await supabase.from("profiles").update({ branch: u.branch }).eq("id", userId);
    }

    // Assign role
    await supabase.from("user_roles").insert({ user_id: userId, role: u.role });

    results.push({ email: u.email, id: userId, role: u.role, status: "created" });
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
