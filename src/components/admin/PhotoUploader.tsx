"use client";

import { useId, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { compressImage, uploadImage } from "@/lib/image-upload";

// Fotos hochladen und ihre Reihenfolge per Ziehen bestimmen.
//
// DIE REIHENFOLGE IST DIE EINZIGE HERO-WAHL:
// Position 0 = Hero. Es gibt bewusst KEIN zweites Feld „welches ist das Hero" – zwei
// Wahrheiten würden früher oder später auseinanderlaufen (Reihenfolge sagt A, Hero-Feld
// sagt B, und niemand weiß, was die Detailseite zeigt). Wer das Hero wechselt, zieht das
// Foto nach vorn; der ★-Knopf tut genau dasselbe in einem Klick, für lange Listen.
//
// Beim Speichern legt der Server für Position 0 eine 160px-Vorschau ab (lib/blur-preview),
// die gesperrte Pro-Spots als unscharfen Teaser zeigen. Siehe saveSpot in lib/admin-actions.

/** Maus: erst ab 8px Weg ziehen – sonst verschluckt der Drag jeden Klick auf ✕ und ★. */
const MOUSE_ACTIVATION_DISTANCE = 8;
/** Touch: erst nach 200ms Halten ziehen – sonst scrollt die Seite nicht mehr. */
const TOUCH_ACTIVATION_DELAY_MS = 200;
const TOUCH_ACTIVATION_TOLERANCE = 6;

const TILE = "relative h-20 w-28 shrink-0 overflow-hidden rounded-[10px] bg-black/5";

function PhotoTile({
  url,
  index,
  ordered,
  onRemove,
  onMakeHero,
}: {
  url: string;
  index: number;
  ordered: boolean;
  onRemove: () => void;
  onMakeHero: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: url,
    disabled: !ordered,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // Das gezogene Original blass stehen lassen: Es markiert die Lücke, während das
      // DragOverlay am Finger klebt. Ganz ausblenden ließe das Raster zappeln.
      className={`${TILE} ${ordered ? "cursor-grab active:cursor-grabbing" : ""} ${
        isDragging ? "opacity-30" : ""
      }`}
      {...attributes}
      {...listeners}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />
      {ordered && index === 0 && (
        <span className="absolute left-1 top-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
          Hero
        </span>
      )}
      <div className="absolute right-1 top-1 flex gap-1">
        {ordered && index !== 0 && (
          <button
            type="button"
            // Ohne stopPropagation startet der Sensor einen Drag und der Klick geht verloren.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onMakeHero}
            title="Als Hero nach vorn"
            className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-[11px] text-ink shadow"
          >
            ★
          </button>
        )}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          title="Entfernen"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-[11px] text-accent shadow"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function PhotoUploader({
  images,
  onChange,
  ordered = true,
}: {
  images: string[];
  onChange: (urls: string[]) => void;
  /**
   * false = ein einzelnes Bild ohne Rangfolge (Events): kein Hero-Abzeichen, kein Ziehen.
   * Ein „Hero" unter genau einem Bild wäre eine Auswahl, die es nicht gibt.
   */
  ordered?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const dndId = useId(); // sonst warnt React beim Hydrieren über wechselnde dnd-kit-IDs

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: MOUSE_ACTIVATION_DISTANCE } }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: TOUCH_ACTIVATION_DELAY_MS,
        tolerance: TOUCH_ACTIVATION_TOLERANCE,
      },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setErr("");
    setBusy(true);
    const added: string[] = [];
    try {
      for (const file of files) {
        const { blob } = await compressImage(file);
        added.push(await uploadImage(blob));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      // Was schon oben liegt, wird auch übernommen: Ein Fehler beim vierten Foto darf die
      // ersten drei nicht verwerfen – die lägen sonst verwaist im Storage.
      //
      // ordered=false heißt ERSETZEN, nicht anhängen: Dort gibt es nur Platz für ein Bild,
      // und der Aufrufer nimmt images[0]. Angehängt landete das neue Foto auf Position 1
      // und würde stillschweigend verworfen – man lädt hoch und nichts passiert.
      if (added.length) onChange(ordered ? [...images, ...added] : added.slice(-1));
      setBusy(false);
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // erneutes Wählen derselben Datei erlauben
    await addFiles(files);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    await addFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/")));
  }

  function onDragStart(e: DragStartEvent) {
    setActiveUrl(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveUrl(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = images.indexOf(String(active.id));
    const to = images.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onChange(arrayMove(images, from, to));
  }

  function remove(url: string) {
    onChange(images.filter((u) => u !== url));
  }

  function makeHero(url: string) {
    onChange([url, ...images.filter((u) => u !== url)]);
  }

  return (
    <div
      // Fotos direkt aufs Feld ziehen: derselbe Weg, den man vom Schreibtisch kennt.
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`space-y-2 rounded-[12px] border-2 border-dashed p-2 transition-colors ${
        dragOver ? "border-accent bg-accent/5" : "border-transparent"
      }`}
    >
      {images.length > 0 && (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveUrl(null)}
        >
          <SortableContext items={images} strategy={rectSortingStrategy}>
            <div className="flex flex-wrap gap-2">
              {images.map((url, i) => (
                <PhotoTile
                  key={url}
                  url={url}
                  index={i}
                  ordered={ordered}
                  onRemove={() => remove(url)}
                  onMakeHero={() => makeHero(url)}
                />
              ))}
            </div>
          </SortableContext>
          {/* Hebt das gezogene Foto sichtbar aus dem Raster – ohne Overlay „springt“ es
              beim Umbruch in eine neue Zeile und man verliert es aus den Augen. */}
          <DragOverlay>
            {activeUrl && (
              <div className={`${TILE} scale-105 cursor-grabbing shadow-lg ring-2 ring-accent`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={activeUrl} alt="" className="h-full w-full object-cover" />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-full bg-black/5 px-3.5 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
        >
          {busy ? "lädt hoch …" : "📷 Foto hinzufügen"}
        </button>
        {images.length > 0 && ordered && (
          <span className="text-xs text-muted">
            {images.length} Foto(s) · ziehen zum Sortieren · erstes = Hero
          </span>
        )}
        {err && <span className="text-xs text-accent">{err}</span>}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple={ordered}
        onChange={onPick}
        className="hidden"
      />
    </div>
  );
}
