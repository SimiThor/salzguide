import { getCategoriesAll, getLocalsAll } from "@/lib/admin";
import SpotForm from "@/components/admin/SpotForm";
import BackButton from "@/components/BackButton";

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
