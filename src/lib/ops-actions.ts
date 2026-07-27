"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "./admin-guard";
import { logOps } from "./ops";

// Die einzige Aktion der Systemseite: den Alarmweg von Hand auslösen.
//
// WARUM EIN TEST-KNOPF KEIN LUXUS IST:
// Diese ganze Kette (schreiben -> zählen -> Schwelle -> rendern -> Resend -> Postfach) läuft
// nur dann, wenn etwas kaputt ist. Sie ist damit die einzige Funktion der App, die man im
// Normalbetrieb NIE benutzt — und deshalb die einzige, bei der man nicht merkt, dass sie
// selbst kaputt ist. Ein falsch geschriebenes OPS_ALERT_EMAIL, ein abgelaufener
// Resend-Schlüssel, eine Domain, deren Verifizierung ausgelaufen ist: All das fällt erst am
// Tag des ersten echten Vorfalls auf, also am schlechtesten möglichen Tag.
//
// Der Knopf beweist die Kette in zehn Sekunden. Er gehört nach jedem Deploy gedrückt, bei
// dem sich am Mailversand oder an den Umgebungsvariablen etwas geändert hat.

export type TestAlertResult = { ok: boolean; error?: string };

export async function sendTestAlert(): Promise<TestAlertResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  await logOps("ops_selftest", {
    message: "Testalarm von der Systemseite ausgelöst.",
    subject: `admin:${gate.userId}`,
    // `force`: Der Knopf soll auch lokal wirklich senden. Sonst könnte man den Mailweg
    // ausgerechnet dort nicht prüfen, wo man ihn baut (siehe `active()` in lib/ops.ts).
    force: true,
  });

  // Damit die neue Zeile sofort in der Liste darunter steht. Ohne das müsste man raten,
  // ob der Knopf etwas getan hat.
  revalidatePath("/[locale]/admin/settings/system", "page");
  return { ok: true };
}
