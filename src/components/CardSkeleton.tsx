// Sektions-Skeleton (iOS-2026): weiße Karte mit sanft schimmernden Platzhalter-Zeilen,
// ungefähr in der Größe der echten Sektion. Für Suspense-Fallbacks (streamende Inhalte).
export default function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div
      className="space-y-3 rounded-[18px] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]"
      aria-hidden
    >
      <div className="sg-skeleton h-4 w-28 rounded-md" />
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`sg-skeleton h-3 rounded ${i === lines - 1 ? "w-4/6" : "w-full"}`}
        />
      ))}
    </div>
  );
}
