import { getCategoriesAll, getLocalsAll } from "@/lib/admin";
import SpotForm from "@/components/admin/SpotForm";
import BackButton from "@/components/BackButton";

// Die Server-Actions der Seite erben diese Grenze (wie die Runden-Seiten): "Anpassen" fragt
// den Routendienst je Stück bis 20 s, eine lange Spur hat mehrere Stücke (lib/routing/snap-spot.ts).
export const maxDuration = 60;

export default async function NewSpotPage() {
  const [categories, locals] = await Promise.all([
    getCategoriesAll(),
    getLocalsAll(),
  ]);
  return (
    <div className="space-y-4">
      <BackButton fallbackHref="/admin" />
      <SpotForm isNew categories={categories} locals={locals} />
    </div>
  );
}
