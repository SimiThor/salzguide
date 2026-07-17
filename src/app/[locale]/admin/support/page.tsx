import { setRequestLocale } from "next-intl/server";
import { getSupportRequests } from "@/lib/admin";
import AdminNav from "@/components/admin/AdminNav";
import AdminSupportList from "@/components/admin/AdminSupportList";

// Service-Anfragen. force-dynamic: Eine Arbeitsliste aus dem Cache wäre eine Lüge über
// den Stand – und offene Anfragen sind genau das, was man nicht verpassen darf.
export const dynamic = "force-dynamic";

export default async function AdminSupportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { status } = await searchParams;
  const showDone = status === "done";
  const requests = await getSupportRequests(showDone ? "done" : "open");

  return (
    <div className="space-y-4 pb-12">
      <AdminNav active="support" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Admin · Support</h1>
        <div className="inline-flex rounded-full bg-black/5 p-1">
          {[
            { key: "open", label: "Offen" },
            { key: "done", label: "Erledigt" },
          ].map((t) => (
            <a
              key={t.key}
              href={`/${locale}/admin/support?status=${t.key}`}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                (t.key === "done") === showDone ? "bg-white text-ink shadow-sm" : "text-muted"
              }`}
            >
              {t.label}
            </a>
          ))}
        </div>
      </div>

      <AdminSupportList requests={requests} />

      <p className="px-1 text-xs leading-relaxed text-muted">
        Jede Anfrage kommt zusätzlich per E-Mail — antworten kannst du direkt aus dem
        Postfach, die Antwort-Adresse steht schon richtig drin. Diese Liste sagt dir nur, was
        noch offen ist. Löschen ist für Auskunftsverlangen nach Art. 17 DSGVO von Leuten ohne
        Konto: Wer ein Konto hat, dessen Anfragen gehen beim Löschen des Kontos automatisch mit.
      </p>
    </div>
  );
}
