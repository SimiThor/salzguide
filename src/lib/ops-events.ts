// ═══════════════════════════════════════════════════════════════════════════════════════
//  Der Katalog: was gemeldet wird, wie schlimm es ist, ab wann eine Mail rausgeht.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Das hier ist die EINE Liste. Jede Meldestelle im Code nennt einen Schlüssel aus diesem
// Katalog, und alles Weitere — Schwere, Schwelle, Ruhefenster, Überschrift, Handlungshinweis
// — steht nur hier. Der Grund ist derselbe wie beim Admin-Wächter (lib/admin-guard.ts):
// Stünde die Entscheidung „ist das eine Mail wert?" an jeder der hundert Meldestellen, wäre
// sie hundertmal anders, und beim Feintuning müsste man sie hundertmal suchen.
//
// WARUM DIESE DATEI KEIN "server-only" TRÄGT:
// Heute liest sie nur die Server-Seite. Aber sie enthält genau das, was eine Oberfläche
// braucht — Überschriften, Farben, Handlungshinweise — und sobald jemand daraus eine
// Filterleiste oder ein Kärtchen im Browser baut, wäre der Import aus einer server-only-Datei
// ein HTTP 500 auf JEDER Seite der App, ohne dass `tsc` oder ESLint ein Wort dazu sagen.
// Deshalb enthält diese Datei bewusst nur Daten und reine Funktionen. Alles, was eine
// Datenbank anfasst, steht in lib/ops.ts, und die trägt server-only.
//
// ───────────────────────────────────────────────────────────────────────────────────────
//  DIE VIER STUFEN, und wann welche
// ───────────────────────────────────────────────────────────────────────────────────────
//
//   info      Notiert, weil man es später vielleicht nachschlagen will. Nie eine Mail.
//             (Admin-Aktionen, geblockte Bots, erreichte Limits.)
//   warn      Auffällig, aber allein noch kein Grund aufzustehen. Mail erst als MUSTER,
//             also ab einer Schwelle.
//   error     Etwas hat nicht funktioniert. Mail, aber gedrosselt.
//   critical  Geld, Zugang oder Rechtsfrist betroffen. Mail sofort, Ruhefenster kurz.
//
// Die Zuordnung folgt der Frage: „Kostet es uns Geld, sperrt es jemanden aus, oder bricht
// es eine Zusage aus der Datenschutzerklärung?" Wenn ja, ist es critical. Alles andere darf
// warten, bis jemand hinschaut. Genau diese Trennung ist der Unterschied zwischen einem
// Alarm, den man liest, und einem Postfach, das man wegfiltert.

export type OpsSeverity = "info" | "warn" | "error" | "critical";

/** Grobe Ecke der Plattform. Nur zum Filtern in der Admin-Ansicht. */
export type OpsArea =
  | "app"
  | "auth"
  | "payment"
  | "ai"
  | "admin"
  | "cron"
  | "mail"
  | "media"
  | "data"
  | "security";

export type OpsPolicy = {
  area: OpsArea;
  severity: OpsSeverity;
  /** Überschrift in der Liste und in der Betreffzeile. Deutsch, kurz, ohne Fachjargon. */
  title: string;
  /**
   * Ab dem wievielten Vorfall im Ruhefenster geht eine Mail raus?
   *
   * 1 = sofort. Höher = erst als Muster (fünfzig Fehlversuche sind ein Angriff, einer ist
   * ein Tippfehler). 0 = nie mailen, nur ins Logbuch.
   */
  alertAfter: number;
  /**
   * Ruhefenster in Minuten. Innerhalb dieser Zeit geht zu demselben Fingerabdruck
   * HÖCHSTENS eine Mail raus, egal wie oft es knallt. Was dazwischen passiert, zählt die
   * nächste Mail nach ("und N weitere").
   */
  quietMinutes: number;
  /**
   * Was jetzt zu tun ist. Steht so in der Alarm-Mail.
   *
   * Bewusst als Pflichtfeld: Ein Alarm ohne nächsten Schritt ist eine Beunruhigung, keine
   * Information. Wer diese Mail um 23 Uhr auf dem Handy liest, soll in einem Satz wissen,
   * ob er aufstehen muss.
   */
  hint: string;
};

// ───────────────────────────────────────────────────────────────────────────────────────
//  Der Katalog
// ───────────────────────────────────────────────────────────────────────────────────────
//
// Reihenfolge nach Ecken, innerhalb einer Ecke nach Schwere. Wer hier etwas ergänzt, muss
// nur diese eine Stelle anfassen — die Datenbank kennt `kind` als freien Text, damit ein
// neuer Eintrag keine Migration braucht.

export const OPS_EVENTS = {
  // ── App: alles, was als Ausnahme hochkommt ────────────────────────────────────────
  server_error: {
    area: "app",
    severity: "error",
    title: "Serverfehler",
    // Nicht sofort: Ein einzelner Fehler kann ein Bot sein, der eine kaputte Adresse
    // aufruft. Zwei gleiche in einer Stunde sind ein echtes Problem.
    alertAfter: 2,
    quietMinutes: 60,
    hint: "Pfad und Fehlermeldung unten prüfen. Kam es mit dem letzten Deploy (Release-Zeile)? Dann dorthin zurückrollen.",
  },
  client_error: {
    area: "app",
    severity: "warn",
    title: "Fehler im Browser",
    // Browser werfen viel: Erweiterungen, abgebrochene Ladevorgänge, uralte Geräte. Erst
    // eine Häufung an derselben Stelle ist ein Hinweis auf einen echten Fehler von uns.
    alertAfter: 10,
    quietMinutes: 180,
    hint: "Wenn viele Geräte denselben Fehler melden, liegt es an uns. Betrifft es nur eines, ist es meist eine Browser-Erweiterung.",
  },
  ops_selftest: {
    area: "app",
    // „Notiz" und trotzdem `alertAfter: 1` — der einzige Eintrag im Katalog, bei dem Stufe
    // und Mail auseinandergehen, und zwar mit Absicht: Der Test-Knopf im Admin soll die
    // GANZE Kette beweisen (Schreiben, Zählen, Rendern, Resend, Postfach), ohne dabei einen
    // roten Eintrag zu hinterlassen, der beim nächsten Blick nach einem echten Fehler
    // aussieht. Ruhefenster 0 heisst: Der Knopf funktioniert auch beim zweiten Drücken.
    severity: "info",
    title: "Testalarm",
    alertAfter: 1,
    quietMinutes: 0,
    hint: "Das war der Test-Knopf im Admin. Diese Mail zu sehen bedeutet: Die Alarmkette funktioniert. Nichts zu tun.",
  },
  db_unreachable: {
    area: "app",
    severity: "critical",
    title: "Datenbank nicht erreichbar",
    alertAfter: 1,
    quietMinutes: 30,
    hint: "Supabase-Status prüfen (status.supabase.com) und im Dashboard nachsehen, ob das Projekt pausiert oder am Verbindungslimit ist. Solange das anliegt, geht auf der Seite fast nichts.",
  },

  // ── Auth: der Weg ins Konto ───────────────────────────────────────────────────────
  login_mail_failed: {
    area: "auth",
    severity: "critical",
    title: "Anmeldelink konnte nicht verschickt werden",
    // Sofort. Diese Mail ist für alle ohne Google-Konto der EINZIGE Weg hinein
    // (siehe lib/login-link.ts) — hier hängt der Zugang der zahlenden Kunden dran.
    alertAfter: 1,
    quietMinutes: 30,
    hint: "Resend prüfen (Kontingent, Domain-Verifizierung, RESEND_KEY). Bis dahin kommt niemand ohne Google in sein Konto.",
  },
  auth_callback_failed: {
    area: "auth",
    severity: "warn",
    title: "Anmeldung am Rücksprung gescheitert",
    // Einzelfälle sind normal: abgelaufener Link, zweimal geklickt, Link aus dem Spam-
    // Ordner von gestern. Eine Häufung heisst, der Weg ist kaputt.
    alertAfter: 5,
    quietMinutes: 60,
    hint: "Meist abgelaufene Links (normal). Häufen sie sich, die Redirect-Allowlist in Supabase und NEXT_PUBLIC_SITE_URL prüfen.",
  },
  login_rate_limited: {
    area: "auth",
    severity: "warn",
    title: "Anmelde-Bremse hat gegriffen",
    // Der Zweck der Bremse ist, ein fremdes Postfach nicht zuschütten zu lassen. Dass sie
    // greift, ist ein Erfolg — aber gehäuft ist es ein Versuch, genau das zu tun.
    alertAfter: 20,
    quietMinutes: 60,
    hint: "Jemand fordert massenhaft Anmeldelinks an (Mail-Bombing). Die Bremse hält. Wenn es anhält, Turnstile-Einstellungen bei Cloudflare verschärfen.",
  },
  admin_forbidden: {
    area: "auth",
    severity: "critical",
    title: "Angemeldeter Nutzer hat eine Admin-Aktion versucht",
    // SOFORT, und ohne Schwelle. Das passiert im Normalbetrieb NIE: Wer keine Admin-Rolle
    // hat, sieht den Admin-Bereich gar nicht. Wer hier auftaucht, hat eine Server-Action
    // von Hand aufgerufen — das ist entweder ein Sicherheitstest oder ein Angriff auf ein
    // Konto, das schon in unserer Datenbank steht.
    alertAfter: 1,
    quietMinutes: 60,
    hint: "Das passiert nicht aus Versehen. Konto in Supabase (Auth -> Users) ansehen; im Zweifel sperren. Der Wächter hat gehalten, es ist nichts passiert.",
  },
  admin_page_denied: {
    area: "auth",
    severity: "warn",
    title: "Nutzer ohne Rechte auf einer Admin-Seite",
    // Anders als admin_forbidden: Eine Seite erreicht man durch Tippen in der Adresszeile,
    // und das macht früher oder später jeder neugierige Mensch einmal. Erst als Muster ist
    // es ein Abklopfen.
    alertAfter: 10,
    quietMinutes: 60,
    hint: "Meist Neugier. Kommt es gehäuft von derselben Kennung, das Konto in Supabase ansehen. Der Wächter hält, es ist nichts passiert.",
  },
  turnstile_failed: {
    area: "auth",
    severity: "info",
    title: "Roboter-Check nicht bestanden",
    alertAfter: 50,
    quietMinutes: 60,
    hint: "Bots klopfen am Login. Der Check hält sie. Nur relevant, wenn gleichzeitig echte Nutzer klagen, sie kämen nicht durch.",
  },

  // ── Zahlung: hier hängt Geld dran ─────────────────────────────────────────────────
  stripe_fulfillment_failed: {
    area: "payment",
    severity: "critical",
    title: "Bezahlt, aber Pro nicht freigeschaltet",
    // Der teuerste Fehler, den diese App machen kann: Jemand hat gezahlt und bekommt
    // nichts. Sofort, kurzes Ruhefenster.
    alertAfter: 1,
    quietMinutes: 15,
    hint: "Sofort ansehen. Stripe-Dashboard -> Zahlung suchen, im Admin unter Nutzer Pro von Hand setzen und die Person anschreiben. Stripe stellt den Webhook mehrfach zu, es kann sich auch von selbst lösen.",
  },
  stripe_webhook_failed: {
    area: "payment",
    severity: "critical",
    title: "Stripe-Webhook fehlgeschlagen",
    alertAfter: 1,
    quietMinutes: 15,
    hint: "Im Stripe-Dashboard unter Developers -> Webhooks die fehlgeschlagenen Zustellungen ansehen. Stripe versucht es mehrfach erneut.",
  },
  stripe_not_configured: {
    area: "payment",
    severity: "critical",
    title: "Stripe ist nicht eingerichtet",
    alertAfter: 1,
    quietMinutes: 720,
    hint: "STRIPE_SECRET_KEY oder STRIPE_WEBHOOK_SECRET fehlt in Vercel. Solange das so ist, kann niemand kaufen.",
  },
  stripe_bad_signature: {
    area: "payment",
    severity: "warn",
    title: "Webhook mit falscher Signatur",
    // Einzelne sind harmlos (Stripe-Testereignisse, alte Endpunkte). Eine Häufung heisst,
    // jemand schickt uns selbstgebaute Zahlungsereignisse.
    alertAfter: 5,
    quietMinutes: 120,
    hint: "Wenn das gehäuft kommt, versucht jemand gefälschte Zahlungen einzuspielen. Die Signaturprüfung hält. Prüfen, ob STRIPE_WEBHOOK_SECRET zum Endpunkt passt.",
  },

  // ── KI: hier hängt ebenfalls Geld dran, nur andersherum ───────────────────────────
  ai_provider_error: {
    area: "ai",
    severity: "error",
    title: "KI-Dienst antwortet nicht",
    alertAfter: 3,
    quietMinutes: 60,
    hint: "status.anthropic.com prüfen und das Guthaben in der Anthropic-Konsole. Toni antwortet solange nicht.",
  },
  ai_ip_cap_hit: {
    area: "ai",
    severity: "warn",
    title: "KI-Tageslimit einer Adresse ausgeschöpft",
    // Denial of Wallet: Wer unser Claude-Kontingent verbrennen will, läuft genau hier
    // gegen die Wand. Einzelne Treffer sind ein neugieriger Mensch, viele sind ein Skript.
    alertAfter: 10,
    quietMinutes: 180,
    hint: "Jemand fährt den KI-Chat automatisiert. Die Obergrenze hält und schützt die Rechnung. Bei Dauerbeschuss IP_GUEST_CAP senken.",
  },

  // ── Admin: die Nachvollziehbarkeit unserer eigenen Eingriffe ──────────────────────
  admin_action: {
    area: "admin",
    severity: "info",
    title: "Admin-Aktion",
    // Nie eine Mail — das sind wir selbst. Aber im Logbuch, weil OWASP A09 genau das
    // verlangt: Wer hat wann was über die Admin-Oberfläche geändert? Ohne diese Spur lässt
    // sich nach einem Zwischenfall nicht sagen, ob eine Änderung von uns kam.
    alertAfter: 0,
    quietMinutes: 0,
    hint: "Nur zur Nachvollziehbarkeit. Kein Handlungsbedarf.",
  },
  admin_action_failed: {
    area: "admin",
    severity: "error",
    title: "Admin-Aktion fehlgeschlagen",
    alertAfter: 3,
    quietMinutes: 60,
    hint: "Eine Änderung im Admin ist nicht durchgegangen. Meldung unten lesen und noch einmal versuchen.",
  },

  // ── Cron: die Läufe, die niemand sieht ────────────────────────────────────────────
  cron_failed: {
    area: "cron",
    severity: "error",
    title: "Hintergrund-Lauf fehlgeschlagen",
    alertAfter: 1,
    quietMinutes: 360,
    hint: "In Vercel unter Logs den Lauf ansehen. Ein Ausfall holt der nächste Lauf meist auf.",
  },
  cron_missing: {
    area: "cron",
    severity: "critical",
    title: "Hintergrund-Lauf bleibt aus",
    // Der Totmannschalter. Kritisch, weil am Aufräum-Cron die Löschfristen aus der
    // Datenschutzerklärung hängen: Läuft er nicht, sagt die Erklärung etwas Falsches zu
    // (Art. 13 DSGVO), und niemand würde es merken.
    alertAfter: 1,
    quietMinutes: 720,
    hint: "In Vercel unter Settings -> Cron Jobs prüfen, ob der Job noch existiert und aktiv ist, und ob CRON_SECRET dort und in den Umgebungsvariablen gleich ist.",
  },
  cron_unauthorized: {
    area: "cron",
    severity: "warn",
    title: "Fremder Zugriff auf einen Cron-Endpunkt",
    alertAfter: 5,
    quietMinutes: 120,
    hint: "Jemand klopft an /api/cron/* ohne gültiges Secret. Der Riegel hält. Nur handeln, wenn es massenhaft kommt.",
  },

  // ── Mail: die Zustellbarkeit selbst ───────────────────────────────────────────────
  mail_send_failed: {
    area: "mail",
    severity: "error",
    title: "E-Mail konnte nicht zugestellt werden",
    alertAfter: 2,
    quietMinutes: 60,
    hint: "Resend-Dashboard prüfen: Kontingent aufgebraucht, Domain nicht mehr verifiziert oder Key abgelaufen.",
  },

  // ── Medien ────────────────────────────────────────────────────────────────────────
  upload_failed: {
    area: "media",
    severity: "warn",
    title: "Upload fehlgeschlagen",
    alertAfter: 3,
    quietMinutes: 120,
    hint: "Storage-Kontingent in Supabase prüfen. Betrifft nur den Admin-Upload, nicht die Seite.",
  },

  // ── Daten: Fristen und Aufräumen ──────────────────────────────────────────────────
  retention_failed: {
    area: "data",
    severity: "critical",
    title: "Löschfristen nicht eingehalten",
    // Kritisch aus Rechtsgründen, nicht aus technischen: Die Datenschutzerklärung nennt
    // konkrete Fristen (2 Tage Salt, 90 Tage KI-Zähler). Werden die nicht eingehalten,
    // steht dort eine falsche Angabe (siehe lib/data-retention.ts).
    alertAfter: 1,
    quietMinutes: 720,
    hint: "Das Aufräumen ist nicht durchgelaufen. Wenn das mehrere Tage anhält, stimmen die Fristen in der Datenschutzerklärung nicht mehr. Meldung unten prüfen.",
  },

  // ── Sicherheit: Muster, die von aussen kommen ─────────────────────────────────────
  abuse_blocked: {
    area: "security",
    severity: "info",
    title: "Missbrauchs-Bremse hat gegriffen",
    alertAfter: 100,
    quietMinutes: 60,
    hint: "Eine Obergrenze hat gehalten. Nur bei massenhaftem Auftreten interessant.",
  },
  suspicious_request: {
    area: "security",
    severity: "warn",
    title: "Schreibzugriff von einer fremden Seite",
    // ═══════════════════════════════════════════════════════════════════════════════
    //  WARUM DIESES SIGNAL UND NICHT DAS NAHELIEGENDE
    // ═══════════════════════════════════════════════════════════════════════════════
    //
    // Der erste Gedanke war, 404-Scanner mitzuschreiben (/wp-login.php, /.env,
    // /.git/config). Dagegen sprechen zwei Dinge, und das zweite ist das entscheidende:
    //
    //   1. SIGNALWERT. Das bekommt JEDE Seite im Netz, rund um die Uhr, seit es das Netz
    //      gibt. Eine Meldung, die immer da ist, sagt nichts.
    //   2. TECHNISCH TEUER UND WACKLIG. Diese Pfade tragen einen Punkt und fallen deshalb
    //      aus dem Middleware-Matcher (proxy.ts). Sie einzufangen hiesse, Anfragen durch die
    //      Middleware zu schicken, die heute gar nicht erst hineinlaufen — und dort gibt es
    //      weder `node:crypto` noch den Service-Client, weil die Edge-Laufzeit beides nicht
    //      kennt. Man baute also eine zweite, andersartige Meldekette für das schwächste
    //      aller Signale.
    //
    // Was HIER gemeldet wird, ist stattdessen das, was wir ohnehin schon prüfen und was
    // wirklich etwas heisst: Ein POST auf unsere Schreib-Endpunkte, dessen `Origin` nicht
    // unsere Seite ist. Ein Browser setzt diesen Kopf selbst und lässt ihn nicht fälschen.
    // Wer dort auftaucht, hat entweder ein Skript gebaut oder unsere Seite in eine fremde
    // eingebettet. Beides ist Absicht, und Absicht ist das, was man sehen will.
    alertAfter: 30,
    quietMinutes: 120,
    hint: "Jemand schickt Daten von einer fremden Seite aus an unsere Endpunkte. Der Same-Origin-Riegel hält. Nur bei anhaltenden Wellen genauer hinsehen.",
  },
  config_missing: {
    area: "security",
    severity: "critical",
    title: "Wichtige Einstellung fehlt",
    alertAfter: 1,
    quietMinutes: 1440,
    hint: "Eine Umgebungsvariable fehlt in Vercel, und der zugehörige Schutz ist damit aus. Unten steht welche.",
  },
} as const satisfies Record<string, OpsPolicy>;

/** Alle bekannten Ereignis-Arten. Meldestellen können nur diese Schlüssel nennen. */
export type OpsKind = keyof typeof OPS_EVENTS;

export const OPS_KINDS = Object.keys(OPS_EVENTS) as OpsKind[];

/**
 * Die Regel zu einer Art. Nimmt auch einen unbekannten String, weil die Admin-Ansicht
 * alte Zeilen aus der Datenbank rendert — auch solche, deren Art es im Code nicht mehr gibt.
 */
export function opsPolicy(kind: string): OpsPolicy {
  return (
    (OPS_EVENTS as Record<string, OpsPolicy>)[kind] ?? {
      area: "app",
      severity: "warn",
      title: kind,
      alertAfter: 0,
      quietMinutes: 60,
      hint: "Unbekannte Ereignis-Art (vermutlich aus einer älteren Version).",
    }
  );
}

/** Rangfolge der Stufen. Für „ab error aufwärts" in Filtern und Zusammenfassungen. */
export const SEVERITY_RANK: Record<OpsSeverity, number> = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
};

/** Farbe und Wort je Stufe. Eine Quelle für Admin-Liste und Alarm-Mail. */
export const SEVERITY_LOOK: Record<OpsSeverity, { label: string; hex: string }> = {
  // Warmes Grau statt Blau: Die App kennt kein Blau, und „info" soll nicht wie ein
  // Hinweisdialog aussehen.
  info: { label: "Notiz", hex: "#6C5B57" },
  warn: { label: "Auffällig", hex: "#b8791f" },
  error: { label: "Fehler", hex: "#cc2924" },
  // Das Rot der Marke ist schon für „Fehler" vergeben. Kritisch bekommt ein dunkleres,
  // damit die Stufen auch nebeneinander unterscheidbar bleiben.
  critical: { label: "Kritisch", hex: "#8c1a16" },
};

// ───────────────────────────────────────────────────────────────────────────────────────
//  Der Totmannschalter: welche Jobs es gibt und wann sie als überfällig gelten
// ───────────────────────────────────────────────────────────────────────────────────────
//
// Die Fristen sind grosszügig gegenüber dem Fahrplan aus vercel.json: Der tägliche Lauf
// darf einen Tag ausfallen, der wöchentliche zehn Tage. Sonst meldet sich ein Alarm bei
// jeder kleinen Verzögerung — und ein Alarm, der oft grundlos kommt, wird weggeklickt,
// gerade dann, wenn er einmal stimmt.

export type OpsJob = {
  /** Schlüssel in ops_heartbeats. */
  job: string;
  /** Wie er in der Ansicht heisst. */
  label: string;
  /** Fahrplan im Klartext (aus vercel.json). */
  schedule: string;
  /** Ab wie vielen Stunden ohne Lauf gilt er als überfällig? */
  overdueHours: number;
};

export const OPS_JOBS: readonly OpsJob[] = [
  {
    job: "cleanup",
    label: "Tägliches Aufräumen",
    schedule: "täglich 03:30",
    // 36 statt 24 Stunden: Vercel schiebt Cron-Läufe um bis zu eine Stunde, und ein
    // einzelner verpasster Lauf ist noch kein Problem. Zwei aufeinanderfolgende schon.
    overdueHours: 36,
  },
  {
    job: "events",
    label: "Wöchentliche Event-Recherche",
    schedule: "montags 05:00",
    overdueHours: 24 * 10,
  },
] as const;
