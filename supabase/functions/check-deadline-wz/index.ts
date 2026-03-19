import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Find overdue zlecenia without WZ
  const { data: overdue, error: fetchErr } = await supabase
    .from("zlecenia")
    .select("id, numer, dzien, nadawca_id, deadline_wz")
    .eq("ma_wz", false)
    .eq("flaga_brak_wz", false)
    .lt("deadline_wz", new Date().toISOString())
    .not("status", "in", '("anulowana","dostarczona")');

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!overdue || overdue.length === 0) {
    return new Response(JSON.stringify({ flagged: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let flagged = 0;

  for (const zl of overdue) {
    // Flag the zlecenie
    const { error: updErr } = await supabase
      .from("zlecenia")
      .update({ flaga_brak_wz: true })
      .eq("id", zl.id);

    if (updErr) continue;

    // Create notification for the sender
    if (zl.nadawca_id) {
      await supabase.from("powiadomienia").insert({
        user_id: zl.nadawca_id,
        typ: "brak_wz_deadline",
        tresc: `Zlecenie ${zl.numer} — minął deadline WZ. Dostawa ${zl.dzien}. Oczekuje na decyzję dyspozytora.`,
        zlecenie_id: zl.id,
        przeczytane: false,
      });
    }

    flagged++;
  }

  return new Response(JSON.stringify({ flagged }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
