import { notFound } from "next/navigation";
import { getEventForEdit } from "@/lib/events";
import { utcIsoToViennaWall } from "@/lib/events-format";
import EventForm from "@/components/admin/EventForm";
import BackButton from "@/components/BackButton";

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await getEventForEdit(id);
  if (!row) notFound();

  // translations: JSONB (0032) bevorzugen; sonst Alt-EN-Spalten (Rückwärtskompatibilität).
  const translations: Record<string, { title: string; description: string }> =
    row.translations && Object.keys(row.translations).length
      ? Object.fromEntries(
          Object.entries(row.translations).map(([l, t]) => [
            l,
            { title: t?.title ?? "", description: t?.description ?? "" },
          ]),
        )
      : row.title_en || row.description_en
        ? { en: { title: row.title_en ?? "", description: row.description_en ?? "" } }
        : {};

  const initial = {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    translations,
    translationsSourceHash: row.source_hash ?? undefined,
    emoji: row.emoji ?? "",
    startsAt: utcIsoToViennaWall(row.starts_at),
    endsAt: row.ends_at ? utcIsoToViennaWall(row.ends_at) : "",
    allDay: row.all_day,
    locationName: row.location_name ?? "",
    category: row.category,
    isHighlight: row.is_highlight,
    isFree: row.is_free ?? false,
    sourceUrl: row.source_url ?? "",
    imageUrl: row.image_url ?? "",
    status: row.status,
  };

  return (
    <div className="space-y-4">
      <BackButton fallbackHref="/admin/events" />
      <EventForm initial={initial} isNew={false} />
    </div>
  );
}
