"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  exportMyData,
  deleteMyAccount,
  setNewsletter,
} from "@/lib/account-actions";

// DSGVO-Steuerung auf der Profil-Seite (docs/34 §C7): Newsletter-Widerruf,
// Datenexport (Art. 15/20) + Konto-Löschung (Art. 17). Alles über Server-Actions.
export default function AccountDataControls({
  newsletter: newsletterInitial,
}: {
  newsletter: boolean;
}) {
  const t = useTranslations("Account");
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [action, setAction] = useState<null | "export" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [newsletter, setNewsletterState] = useState(newsletterInitial);
  const [newsletterBusy, startNewsletter] = useTransition();

  function onToggleNewsletter() {
    if (newsletterBusy) return;
    const next = !newsletter;
    setNewsletterState(next); // optimistisch
    startNewsletter(async () => {
      const res = await setNewsletter(next);
      if (!res.ok) setNewsletterState(!next); // bei Fehler zurück
    });
  }

  function onExport() {
    if (busy) return;
    setError(null);
    setAction("export");
    startTransition(async () => {
      const res = await exportMyData();
      if (!res.ok) {
        setError(t("exportError"));
        setAction(null);
        return;
      }
      // JSON als Download anbieten (rein clientseitig, kein weiterer Request).
      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "salzguide-meine-daten.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setAction(null);
    });
  }

  function onDelete() {
    if (busy) return;
    if (!confirm(t("deleteConfirm"))) return;
    setError(null);
    setAction("delete");
    startTransition(async () => {
      const res = await deleteMyAccount();
      if (!res.ok) {
        setError(t("deleteError"));
        setAction(null);
        return;
      }
      // Konto weg -> auf die öffentliche Startseite, Server-Zustand neu laden (ausgeloggt).
      // „/" ist hier ABSICHT und kein Überbleibsel des /-nach-/explore-Umzugs: wer sein
      // Konto gerade gelöscht hat, gehört nicht in die App, sondern nach draussen.
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-[18px] bg-white shadow-sm">
      {/* Drei klar getrennte Gruppen (iOS-Inset-Liste mit Haarlinien) – so kleben
          Hinweistexte nie am nächsten Button; Zuordnung bleibt in DE & EN eindeutig. */}
      <div className="divide-y divide-black/[0.06]">
        {/* Newsletter-Einwilligung (jederzeit widerrufbar): Titel + Hinweis links,
            Schalter rechts – gehören sichtbar zusammen. */}
        <div className="flex items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-ink">{t("newsletterLabel")}</p>
            <p className="mt-1 text-[12px] leading-snug text-muted">
              {t("newsletterHint")}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={newsletter}
            aria-label={t("newsletterLabel")}
            onClick={onToggleNewsletter}
            disabled={newsletterBusy}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
              newsletter ? "bg-accent" : "bg-black/20"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                newsletter ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Datenexport (Art. 15/20) */}
        <div className="p-5">
          <button
            type="button"
            onClick={onExport}
            disabled={busy}
            className="w-full rounded-full bg-black/5 px-5 py-3 text-sm font-semibold text-ink transition active:scale-[0.98] disabled:opacity-50"
          >
            {action === "export" ? t("exporting") : t("exportBtn")}
          </button>
          <p className="mt-2.5 text-center text-[12px] leading-snug text-muted">
            {t("exportHint")}
          </p>
        </div>

        {/* Konto-Löschung (Art. 17) */}
        <div className="p-5">
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="w-full rounded-full bg-accent/10 px-5 py-3 text-sm font-semibold text-accent transition active:scale-[0.98] disabled:opacity-50"
          >
            {action === "delete" ? t("deleting") : t("deleteBtn")}
          </button>
          <p className="mt-2.5 text-center text-[12px] leading-snug text-muted">
            {t("deleteHint")}
          </p>

          {error && (
            <p className="mt-3 text-center text-[13px] font-medium text-accent" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
