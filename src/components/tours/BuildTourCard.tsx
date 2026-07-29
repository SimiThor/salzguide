"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useLoginGate } from "@/components/auth/LoginGate";
import { useProGate } from "@/components/ProGate";
import ProBadge from "@/components/ProBadge";
import AiSparkle from "@/components/ai/AiSparkle";

// Einstiegskarte in den KI-Runden-Builder auf /touren.
//
// WARUM EINE CLIENT-KOMPONENTE: Vorher war das ein Server-<Link>, der Gäste direkt auf
// /profil warf – mitten aus der Tourenliste heraus, ohne ein Wort davor. Genau dieser
// Sprung irritiert: Man tippt auf „Runde bauen" und steht plötzlich auf einer Loginseite.
// Die App hat für diesen Moment längst EIN Muster (Merken-Knopf, gesperrte Spot-Karten):
// erst ein Sheet, das in einem Satz erklärt, DANN die Entscheidung des Nutzers.
//
// Drei Zustände, dieselbe Karte:
//   • Gast          -> Login-Gate (Anlass „buildTour", 🎧). Nach dem Login geht es
//                      direkt in den Builder weiter, nicht zurück auf die Liste –
//                      der Tipp auf die Karte WAR ja schon die Absicht zu bauen.
//   • ohne Pro      -> Pro-Gate. Dieselbe Bewegung wie beim Tipp auf einen gesperrten
//                      Spot, mit dem Builder-Teaser statt des Karten-Satzes. Die
//                      Kauf-Fläche auf /touren/bauen bleibt für Direktlinks bestehen
//                      (dasselbe Doppel wie Spot-Sheet + gesperrte Spot-Seite).
//   • mit Pro       -> normaler Link in den Builder.
export default function BuildTourCard({
  loggedIn,
  canSeePro,
  className = "",
}: {
  loggedIn: boolean;
  canSeePro: boolean;
  className?: string;
}) {
  const t = useTranslations("Tours");
  const locale = useLocale();
  const loginGate = useLoginGate();
  const proGate = useProGate();

  // Karteninhalt ist in allen drei Zuständen gleich aufgebaut – nur Untertitel und
  // Badge wechseln. Einmal gebaut, damit Link- und Button-Zweig nicht auseinanderlaufen.
  const inner = (
    <>
      <AiSparkle gradient className="h-[26px] w-[26px] shrink-0" />
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          {t("buildCard")}
          {loggedIn && !canSeePro && <ProBadge />}
        </span>
        <span className="block text-[13px] leading-snug text-muted">
          {!loggedIn
            ? t("buildNeedLogin")
            : canSeePro
              ? t("buildCardSub")
              : t("buildCardSubPro")}
        </span>
      </span>
      <span className="shrink-0 text-[17px] text-muted/50" aria-hidden>
        ›
      </span>
    </>
  );

  const cardClass = `${className} mt-5 flex w-full items-center gap-3 px-4 py-3.5 ring-1 ring-black/[0.05] transition active:scale-[0.99]`;

  if (loggedIn && canSeePro) {
    return (
      <Link href="/touren/bauen" className={cardClass}>
        {inner}
      </Link>
    );
  }

  function onClick() {
    if (!loggedIn) {
      // next MIT Locale-Präfix (Vertrag von GateOptions.next, siehe LoginGate.tsx).
      loginGate.show("buildTour", { next: `/${locale}/touren/bauen` });
      return;
    }
    // Angemeldet, aber ohne Pro: Hinweis-Sheet statt Sprung auf die Kauf-Fläche.
    // 🎧 ist das Zeichen dieser Funktion (loginReasons.ts), der Teaser derselbe Satz,
    // der auch auf /touren/bauen über dem Kaufknopf steht – ein Angebot, ein Wortlaut.
    proGate.show({ emoji: "🎧", subtitle: t("buildProTeaser") });
  }

  return (
    <button type="button" onClick={onClick} className={`cursor-pointer ${cardClass}`}>
      {inner}
    </button>
  );
}
