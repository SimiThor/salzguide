import AreaForm from "@/components/admin/AreaForm";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";

export default function NewAreaPage() {
  return (
    <div className="space-y-4">
      <BackButton fallbackHref="/admin/tours/gebiete" />
      <h1 className="text-2xl font-bold text-ink">Neues Gebiet</h1>
      <AreaForm />
    </div>
  );
}
