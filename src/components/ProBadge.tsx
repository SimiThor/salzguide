// Einheitliches „Pro"-Badge (iOS-2026, trustworthy). PLATTFORMWEIT die EINZIGE Quelle für
// den Pro-Look -> überall identisch. Der Badge-Text ist IMMER nur „Pro"; wo eine Wortmarke
// „SalzGuide Pro" gebraucht wird, steht der Name als eigener Text daneben (ProWordmark).
const SIZES = {
  sm: "px-2 py-0.5 text-[11px]",
  md: "px-2.5 py-1 text-[12px]",
} as const;

export default function ProBadge({
  size = "sm",
  className = "",
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-gradient-to-b from-[#d8342f] to-accent font-bold leading-none tracking-wide text-white shadow-sm ring-1 ring-inset ring-white/20 ${SIZES[size]} ${className}`}
    >
      Pro
    </span>
  );
}

// Wortmarke „SalzGuide Pro“: Name als Text + einheitliches Badge (Badge = nur „Pro“).
export function ProWordmark({
  name,
  size = "md",
  className = "",
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="font-bold tracking-tight text-ink">{name}</span>
      <ProBadge size={size} />
    </span>
  );
}
