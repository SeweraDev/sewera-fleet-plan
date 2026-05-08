import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WycenTransportTab } from '@/components/shared/WycenTransportTab';

// Lista oddzialow Sewery (statyczna — to publiczna informacja, nie wymaga query do DB).
// Aktualizuj tu jesli kiedys dojdzie nowy oddzial.
const ODDZIALY_PUBLICZNE = [
  'Katowice',
  'Sosnowiec',
  'Gliwice',
  'D.Górnicza',
  'T.Góry',
  'Chrzanów',
  'Oświęcim',
];

/**
 * Publiczna strona wyceny transportu — dostepna bez logowania pod /wycena.
 * Dla wewnetrznego uzytku Sewery — kazdy z zespolu moze wejsc, wybrac swoj oddzial,
 * typ pojazdu i adres dostawy zeby otrzymac szybka wycene.
 *
 * Inaczej niz w aplikacji glownej:
 *  - Brak logowania (tylko ten kalkulator)
 *  - Oddzial wybierany przez user'a (a nie z `profile.branch`)
 *  - Bez sidebara, bez nawigacji do innych modulow
 */
export default function WycenaPublicznaPage() {
  const [oddzialNazwa, setOddzialNazwa] = useState<string>('');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950">
      {/* Naglowek */}
      <header className="bg-white dark:bg-slate-800 border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <img
            src="/sewera-logo.png"
            alt="Sewera"
            className="h-10 w-auto"
            onError={(e) => {
              // Fallback gdy logo nie wgrane — pokaz tekstowe
              (e.target as HTMLImageElement).style.display = 'none';
              const fb = document.getElementById('logo-fallback');
              if (fb) fb.style.display = 'block';
            }}
          />
          <div id="logo-fallback" className="hidden">
            <div className="font-bold text-lg leading-tight">SEWERA</div>
            <div className="text-xs text-muted-foreground leading-tight">Polska Chemia</div>
          </div>
          <div className="border-l pl-4">
            <h1 className="text-base font-semibold">Wyceń transport</h1>
            <p className="text-xs text-muted-foreground">Kalkulator dostawy · Cennik od 1.04.2026</p>
          </div>
        </div>
      </header>

      {/* Glowny content */}
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Wybierz oddział</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-w-xs">
              <Label className="text-xs text-muted-foreground">Twój oddział</Label>
              <Select value={oddzialNazwa} onValueChange={setOddzialNazwa}>
                <SelectTrigger>
                  <SelectValue placeholder="-- wybierz --" />
                </SelectTrigger>
                <SelectContent>
                  {ODDZIALY_PUBLICZNE.map(o => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {oddzialNazwa && <WycenTransportTab oddzialNazwa={oddzialNazwa} />}

        {!oddzialNazwa && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              👆 Najpierw wybierz oddział powyżej, potem przejdziesz do wyceny.
            </CardContent>
          </Card>
        )}

        {/* Stopka */}
        <footer className="pt-4 pb-8 text-center text-xs text-muted-foreground">
          <p>Sewera Polska Chemia · Wewnętrzny kalkulator transportu</p>
          <p className="mt-1">Pytania? Skontaktuj się z dyspozytorem swojego oddziału.</p>
        </footer>
      </main>
    </div>
  );
}
