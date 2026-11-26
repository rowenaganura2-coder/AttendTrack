import nemsuLogo from "../assets/nemsu-logo.png";

export function Emblem({ size = 60 }) {
  return (
    <img
      src={nemsuLogo}
      alt="North Eastern Mindanao State University seal"
      className="shrink-0 rounded-full border border-line bg-white object-cover shadow-gold"
      style={{ width: size, height: size }}
    />
  );
}

export default function Brand({ compact = false }) {
  return (
    <div className="flex items-center gap-4">
      <Emblem size={compact ? 46 : 60} />
      <div className="min-w-0">
        <p className={`font-display font-bold leading-tight text-ink ${compact ? "text-base" : "text-xl md:text-2xl"}`}>
          {compact ? "NEMSU AttendTrack" : "North Eastern Mindanao State University"}
        </p>
        <span className="mt-1 inline-block whitespace-nowrap rounded-md bg-gold-soft px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-gold-text">
          {compact ? "Cantilan • BSIT 3G" : "Cantilan Campus • BSIT 3G"}
        </span>
      </div>
    </div>
  );
}
