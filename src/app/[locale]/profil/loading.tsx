import { PageHeadSkeleton, SettingsRowSkeleton } from "@/components/skeletons";

// Lade-Gerüst des Profils: dynamische Route (Auth + Profildaten). Formen und
// Abstände spiegeln die eingeloggte Ansicht (profil/page.tsx): Titel, dann der
// Stapel aus E-Mail-Karte (zwei Zeilen), Einstellungs-Zeilen im iOS-Stil und dem
// runden Abmelden-Knopf. Der Login-Screen für Gäste ist schmaler; das Gerüst
// richtet sich nach dem häufigeren Fall, dem eingeloggten Konto.
export default function Loading() {
  return (
    <div className="min-h-viewport pt-[var(--sg-page-top)] md:pt-6" aria-busy>
      <div className="mx-auto w-full max-w-[440px] px-4">
        <PageHeadSkeleton subtitle={false} />
        <div className="mt-5 space-y-3">
          <div className="rounded-[18px] bg-white p-5 shadow-sm" aria-hidden>
            <div className="sg-skeleton h-3 w-24 rounded" />
            <div className="sg-skeleton mt-2 h-4 w-48 rounded" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <SettingsRowSkeleton key={i} />
          ))}
          <div className="sg-skeleton h-11 w-full rounded-full" aria-hidden />
        </div>
      </div>
    </div>
  );
}
