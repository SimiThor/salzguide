import EventForm from "@/components/admin/EventForm";
import BackButton from "@/components/BackButton";

export default function NewEventPage() {
  return (
    <div className="space-y-4">
      <BackButton fallbackHref="/admin/events" />
      <EventForm isNew />
    </div>
  );
}
