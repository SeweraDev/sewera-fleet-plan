// Edge Function: raport-wyceny
// Wysyla mail z raportem statystyk wyceny transportu (dzienny / tygodniowy / miesieczny).
// Wywolywana przez pg_cron lub recznie z aplikacji.
//
// Query params:
//   ?okres=dzien    — domyslnie. Raport za wczoraj + porownanie z przedwczoraj.
//   ?okres=tydzien  — Raport za ostatnie 7 dni + porownanie z poprzednim tygodniem.
//   ?okres=miesiac  — Raport za ostatnie 30 dni + porownanie z poprzednim miesiacem.
//
// Wymagane secrets w Supabase:
//   RESEND_API_KEY      — klucz API z resend.com
//   RAPORT_EMAIL_TO     — adres odbiorcy (np. grzegorz.sekienda@sewera.pl)
//   RAPORT_EMAIL_FROM   — adres nadawcy (np. raporty@sewera.pl lub onboarding@resend.dev)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const KOD_TO_NAZWA: Record<string, string> = {
  KAT: "Katowice",
  R: "Katowice (R)",
  SOS: "Sosnowiec",
  GL: "Gliwice",
  DG: "D. Górnicza",
  TG: "T. Góry",
  CH: "Chrzanów",
  OS: "Oświęcim",
};

interface LogRow {
  id: number;
  created_at: string;
  query: string;
  oddzial_kod: string | null;
  typ_pojazdu: string | null;
  znaleziono_adres: string | null;
  has_house_number: boolean | null;
  name_match: boolean | null;
  uzyto_cache_klientow: boolean | null;
  zrodlo: string;
  zalogowany: boolean;
  wynik_km: number | null;
  wynik_koszt_netto: number | null;
}

interface OkresStats {
  total: number;
  sukces: number;
  problem: number;
  niezalogowani: number;
  zalogowani: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const okres = (url.searchParams.get("okres") || "dzien") as
    | "dzien"
    | "tydzien"
    | "miesiac";

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const emailTo = Deno.env.get("RAPORT_EMAIL_TO");
  const emailFrom = Deno.env.get("RAPORT_EMAIL_FROM") || "onboarding@resend.dev";

  if (!resendKey || !emailTo) {
    return new Response(
      JSON.stringify({
        error: "Brak konfiguracji. Ustaw RESEND_API_KEY i RAPORT_EMAIL_TO w Supabase secrets.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Wyznacz zakres czasowy dla wybranego okresu + okres poprzedni do porownania.
  const now = new Date();
  const dzisRano = new Date(now);
  dzisRano.setUTCHours(0, 0, 0, 0);

  let okresOd: Date;
  let okresDo: Date;
  let prevOd: Date;
  let prevDo: Date;
  let tytul: string;
  let opisOkresu: string;

  if (okres === "dzien") {
    okresDo = dzisRano;
    okresOd = new Date(dzisRano);
    okresOd.setUTCDate(okresOd.getUTCDate() - 1);
    prevDo = okresOd;
    prevOd = new Date(prevDo);
    prevOd.setUTCDate(prevOd.getUTCDate() - 1);
    tytul = `Raport dzienny — ${okresOd.toLocaleDateString("pl-PL")}`;
    opisOkresu = "wczoraj";
  } else if (okres === "tydzien") {
    okresDo = dzisRano;
    okresOd = new Date(dzisRano);
    okresOd.setUTCDate(okresOd.getUTCDate() - 7);
    prevDo = okresOd;
    prevOd = new Date(prevDo);
    prevOd.setUTCDate(prevOd.getUTCDate() - 7);
    tytul = `Raport tygodniowy — ${okresOd.toLocaleDateString("pl-PL")} do ${new Date(okresDo.getTime() - 86400000).toLocaleDateString("pl-PL")}`;
    opisOkresu = "ostatnie 7 dni";
  } else {
    okresDo = dzisRano;
    okresOd = new Date(dzisRano);
    okresOd.setUTCDate(okresOd.getUTCDate() - 30);
    prevDo = okresOd;
    prevOd = new Date(prevDo);
    prevOd.setUTCDate(prevOd.getUTCDate() - 30);
    tytul = `Raport miesieczny — ${okresOd.toLocaleDateString("pl-PL")} do ${new Date(okresDo.getTime() - 86400000).toLocaleDateString("pl-PL")}`;
    opisOkresu = "ostatnie 30 dni";
  }

  // Pobierz logi z okresu + okresu poprzedniego w jednym query
  const { data: logs, error: logsErr } = await supabase
    .from("wyszukiwania_log")
    .select("*")
    .gte("created_at", prevOd.toISOString())
    .lt("created_at", okresDo.toISOString())
    .order("created_at", { ascending: false })
    .limit(10000);

  if (logsErr) {
    return new Response(
      JSON.stringify({ error: logsErr.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const allLogs = (logs || []) as LogRow[];

  // Podziel na biezacy okres i poprzedni
  const biezace = allLogs.filter(
    (l) => new Date(l.created_at) >= okresOd && new Date(l.created_at) < okresDo
  );
  const poprzednie = allLogs.filter(
    (l) => new Date(l.created_at) >= prevOd && new Date(l.created_at) < prevDo
  );

  const stats = (rows: LogRow[]): OkresStats => ({
    total: rows.length,
    sukces: rows.filter((l) => l.wynik_km != null && l.wynik_km > 0).length,
    problem: rows.filter((l) => l.name_match === false).length,
    niezalogowani: rows.filter((l) => !l.zalogowany).length,
    zalogowani: rows.filter((l) => l.zalogowany).length,
  });

  const sBiezace = stats(biezace);
  const sPoprzednie = stats(poprzednie);

  // TOP frazy
  const frazyMap = new Map<string, { query: string; liczba: number; sukcesy: number; problemy: number }>();
  for (const l of biezace) {
    const key = (l.query || "").trim().toLowerCase();
    if (!key) continue;
    const e = frazyMap.get(key);
    if (e) {
      e.liczba++;
      if (l.wynik_km != null && l.wynik_km > 0) e.sukcesy++;
      if (l.name_match === false) e.problemy++;
    } else {
      frazyMap.set(key, {
        query: l.query,
        liczba: 1,
        sukcesy: l.wynik_km != null && l.wynik_km > 0 ? 1 : 0,
        problemy: l.name_match === false ? 1 : 0,
      });
    }
  }
  const topFrazy = [...frazyMap.values()]
    .sort((a, b) => b.liczba - a.liczba)
    .slice(0, 10);

  // Wyceny z problemem
  const problemy = biezace
    .filter((l) => l.name_match === false)
    .slice(0, 10);

  // TOP oddzialy
  const oddzialMap = new Map<string, number>();
  for (const l of biezace) {
    const k = l.oddzial_kod || "?";
    oddzialMap.set(k, (oddzialMap.get(k) || 0) + 1);
  }
  const topOddzialy = [...oddzialMap.entries()]
    .map(([kod, liczba]) => ({ kod, liczba }))
    .sort((a, b) => b.liczba - a.liczba);

  // Buduj HTML maila
  const html = buildHtml({
    tytul,
    opisOkresu,
    sBiezace,
    sPoprzednie,
    topFrazy,
    problemy,
    topOddzialy,
  });

  // Wyslij przez Resend
  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Sewera Raporty <${emailFrom}>`,
      to: [emailTo],
      subject: tytul,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errBody = await resendRes.text();
    return new Response(
      JSON.stringify({ error: "Resend API blad", details: errBody }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const resendData = await resendRes.json();
  return new Response(
    JSON.stringify({
      ok: true,
      okres,
      total: sBiezace.total,
      sent_to: emailTo,
      resend_id: resendData.id,
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});

// ============================================================
// HTML BUILDER
// ============================================================

function buildHtml(d: {
  tytul: string;
  opisOkresu: string;
  sBiezace: OkresStats;
  sPoprzednie: OkresStats;
  topFrazy: { query: string; liczba: number; sukcesy: number; problemy: number }[];
  problemy: LogRow[];
  topOddzialy: { kod: string; liczba: number }[];
}): string {
  const delta = d.sBiezace.total - d.sPoprzednie.total;
  const procent = d.sPoprzednie.total > 0 ? Math.round((delta / d.sPoprzednie.total) * 100) : null;
  const dynamicaText = procent === null
    ? "(brak danych z poprzedniego okresu)"
    : `${delta >= 0 ? "+" : ""}${procent}% vs poprzedni okres (${d.sPoprzednie.total})`;
  const dynamicaColor = delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "#6b7280";

  const procentSukces = d.sBiezace.total > 0
    ? Math.round((d.sBiezace.sukces / d.sBiezace.total) * 100)
    : 0;
  const procentProblem = d.sBiezace.total > 0
    ? Math.round((d.sBiezace.problem / d.sBiezace.total) * 100)
    : 0;

  const frazyRows = d.topFrazy.length === 0
    ? `<tr><td colspan="4" style="padding:12px;color:#6b7280;text-align:center;">Brak wyszukiwan w tym okresie.</td></tr>`
    : d.topFrazy
        .map(
          (f, i) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#6b7280;">${i + 1}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-weight:500;">"${escapeHtml(f.query)}"</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:center;">${f.liczba}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:center;">
            <span style="color:#16a34a;">${f.sukcesy} sukces</span>
            ${f.problemy > 0 ? ` · <span style="color:#dc2626;">${f.problemy} problem</span>` : ""}
          </td>
        </tr>`
        )
        .join("");

  const problemyRows = d.problemy.length === 0
    ? `<tr><td colspan="3" style="padding:12px;color:#16a34a;text-align:center;">Brak problemow w tym okresie.</td></tr>`
    : d.problemy
        .map(
          (l) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #fef2f2;font-weight:500;">"${escapeHtml(l.query)}"</td>
          <td style="padding:6px 10px;border-bottom:1px solid #fef2f2;color:#6b7280;font-size:13px;">${escapeHtml(l.znaleziono_adres || "nie znaleziono")}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #fef2f2;text-align:center;font-size:12px;color:#6b7280;">${KOD_TO_NAZWA[l.oddzial_kod || ""] || l.oddzial_kod || "—"}</td>
        </tr>`
        )
        .join("");

  const totalOddz = d.topOddzialy.reduce((s, x) => s + x.liczba, 0);
  const oddzialyRows = d.topOddzialy.length === 0
    ? `<tr><td colspan="3" style="padding:12px;color:#6b7280;text-align:center;">Brak danych.</td></tr>`
    : d.topOddzialy
        .map(
          (o) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-weight:500;">${KOD_TO_NAZWA[o.kod] || o.kod}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${o.liczba}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;color:#6b7280;">${totalOddz > 0 ? Math.round((o.liczba / totalOddz) * 100) : 0}%</td>
        </tr>`
        )
        .join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f8fafc; padding:20px; color:#0f172a;">
  <div style="max-width:680px; margin:0 auto; background:white; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.1);">

    <div style="background:#0f172a; color:white; padding:24px 32px;">
      <div style="font-size:13px; opacity:0.7; letter-spacing:0.5px; text-transform:uppercase;">Sewera Polska Chemia</div>
      <div style="font-size:22px; font-weight:600; margin-top:4px;">${escapeHtml(d.tytul)}</div>
      <div style="font-size:13px; opacity:0.8; margin-top:4px;">Statystyki kalkulatora wyceny transportu</div>
    </div>

    <div style="padding:24px 32px;">
      <div style="background:#f8fafc; border-radius:6px; padding:16px; margin-bottom:24px;">
        <div style="display:flex; align-items:baseline; gap:10px;">
          <div style="font-size:42px; font-weight:700;">${d.sBiezace.total}</div>
          <div style="color:#6b7280; font-size:14px;">wyszukiwań ${d.opisOkresu}</div>
        </div>
        <div style="font-size:13px; color:${dynamicaColor}; margin-top:4px; font-weight:500;">${dynamicaText}</div>

        <div style="margin-top:14px; font-size:13px; line-height:1.8;">
          <div>✅ Udane wyliczenia: <strong>${d.sBiezace.sukces}</strong> (${procentSukces}%)</div>
          <div>⚠️ Z problemem (nazwa nie pasowała): <strong style="color:${d.sBiezace.problem > 0 ? "#dc2626" : "inherit"};">${d.sBiezace.problem}</strong> (${procentProblem}%)</div>
          <div style="color:#6b7280; padding-top:6px; border-top:1px solid #e2e8f0; margin-top:6px;">
            🔓 Bez logowania: ${d.sBiezace.niezalogowani} · 🔐 Zalogowani: ${d.sBiezace.zalogowani}
          </div>
        </div>
      </div>

      <h3 style="font-size:15px; margin:24px 0 8px;">🔍 Najczęściej wyszukiwane</h3>
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead><tr style="background:#f1f5f9;">
          <th style="padding:8px 10px; text-align:left; font-weight:600; color:#475569;">#</th>
          <th style="padding:8px 10px; text-align:left; font-weight:600; color:#475569;">Co wpisano</th>
          <th style="padding:8px 10px; text-align:center; font-weight:600; color:#475569;">Razem</th>
          <th style="padding:8px 10px; text-align:center; font-weight:600; color:#475569;">Wynik</th>
        </tr></thead>
        <tbody>${frazyRows}</tbody>
      </table>

      <h3 style="font-size:15px; margin:24px 0 8px;">⚠️ Wyceny z problemem</h3>
      <p style="font-size:12px; color:#6b7280; margin:0 0 8px;">System znalazł COŚ INNEGO niż wpisano (np. centroid miasta zamiast firmy).</p>
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead><tr style="background:#fef2f2;">
          <th style="padding:8px 10px; text-align:left; font-weight:600; color:#475569;">Co wpisano</th>
          <th style="padding:8px 10px; text-align:left; font-weight:600; color:#475569;">System znalazł</th>
          <th style="padding:8px 10px; text-align:center; font-weight:600; color:#475569;">Oddział</th>
        </tr></thead>
        <tbody>${problemyRows}</tbody>
      </table>

      <h3 style="font-size:15px; margin:24px 0 8px;">📍 Najaktywniejsze oddziały</h3>
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead><tr style="background:#f1f5f9;">
          <th style="padding:8px 10px; text-align:left; font-weight:600; color:#475569;">Oddział</th>
          <th style="padding:8px 10px; text-align:right; font-weight:600; color:#475569;">Wycen</th>
          <th style="padding:8px 10px; text-align:right; font-weight:600; color:#475569;">Udział</th>
        </tr></thead>
        <tbody>${oddzialyRows}</tbody>
      </table>
    </div>

    <div style="background:#f8fafc; padding:16px 32px; border-top:1px solid #e2e8f0; font-size:11px; color:#6b7280; text-align:center;">
      Raport automatyczny · Sewera Polska Chemia<br>
      Pełen widok: <a href="https://sewera-fleet-plan.lovable.app/admin/statystyki-wyceny" style="color:#3b82f6;">statystyki w aplikacji</a>
    </div>

  </div>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
