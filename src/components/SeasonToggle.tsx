"use client";

export type Season = "summer" | "winter";

// iOS-Segmented-Control für Sommer/Winter (docs/24).
export default function SeasonToggle({
  value,
  onChange,
  labels,
}: {
  value: Season;
  onChange: (s: Season) => void;
  labels: { summer: string; winter: string };
}) {
  const options: { key: Season; label: string }[] = [
    { key: "summer", label: `☀️ ${labels.summer}` },
    { key: "winter", label: `❄️ ${labels.winter}` },
  ];

  return (
    <div className="inline-flex rounded-full bg-black/5 p-1 text-sm font-medium">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={`rounded-full px-4 py-1.5 transition-colors ${
            value === o.key ? "bg-white text-ink shadow-sm" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
