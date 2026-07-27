"use client";

import { useState, useTransition } from "react";
import { sendTestAlert } from "@/lib/ops-actions";
import { adminErrorText } from "@/lib/admin-errors";
import { BTN_SECONDARY } from "@/lib/ui";

// Der Knopf, der beweist, dass die Alarmkette funktioniert.
//
// WARUM ER SICHTBAR AUF DER SEITE STEHT UND NICHT IRGENDWO VERSTECKT:
// Alles andere hier meldet sich von selbst, wenn etwas kaputt ist. Der Alarmweg selbst nicht
// — er ist die einzige Funktion, die man im Normalbetrieb nie benutzt und deren Ausfall man
// deshalb erst am Tag des ersten echten Vorfalls bemerkt. Ein Knopf, den man vor jedem
// grösseren Deploy einmal drückt, kostet zehn Sekunden und schliesst genau diese Lücke.
//
// Ein Zustand mit drei Fällen statt eines Häkchens: „geschickt" heisst NICHT „angekommen".
// Ob Resend die Mail wirklich zugestellt hat, weiss diese Seite nicht und darf sie deshalb
// auch nicht behaupten. Der Text sagt genau das und schickt einen ins Postfach.
export default function TestAlertButton() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h2 className="text-[17px] font-bold text-ink">Alarm testen</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Schickt eine Testmail über denselben Weg wie ein echter Alarm. Nach jeder Änderung an
        den Mail-Einstellungen einmal drücken.
      </p>

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await sendTestAlert();
            setState(res.ok ? "sent" : "failed");
            if (!res.ok) setError(adminErrorText(res.error));
          })
        }
        className={`${BTN_SECONDARY} mt-4 disabled:opacity-60`}
      >
        {pending ? "Wird geschickt …" : "Testalarm schicken"}
      </button>

      {state === "sent" && (
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          Raus. Sie sollte in ein bis zwei Minuten da sein. Kommt nichts an: OPS_ALERT_EMAIL,
          RESEND_KEY und EMAIL_FROM in Vercel prüfen, und im Spam-Ordner nachsehen.
        </p>
      )}
      {state === "failed" && error && (
        <p className="mt-3 text-[13px] leading-relaxed text-accent">{error}</p>
      )}
    </div>
  );
}
