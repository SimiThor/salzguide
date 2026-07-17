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

  // Höhe: p-1 (8) + py-1.5 (12) + Zeilenhöhe text-sm (20) = 40px. Diese 40 stecken in
  // --sg-sheet-peek (globals.css) – der Umschalter ist das, was im eingefahrenen Sheet
  // sichtbar bleiben MUSS. whitespace-nowrap sichert die Rechnung ab: eine längere
  // Übersetzung darf nicht umbrechen und die Zeile zweizeilig machen, sonst schneidet
  // die Tab-Leiste ihn wieder an.
  return (
    <div
      data-sg="season-toggle"
      className="inline-flex rounded-full bg-black/5 p-1 text-sm font-medium"
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={`sg-native-tap whitespace-nowrap rounded-full px-4 py-1.5 leading-5 transition-colors active:opacity-70 ${
            value === o.key ? "bg-white text-ink shadow-sm" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
