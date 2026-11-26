import { Loader2 } from "lucide-react";

export function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="animate-rise">
        {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-bold leading-tight md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, hint, tone = "accent", compact = false }) {
  const toneClasses = {
    gold: "bg-gold-soft text-gold-text",
    present: "bg-present-soft text-present",
    late: "bg-late-soft text-late",
    excused: "bg-excused-soft text-excused",
    absent: "bg-absent-soft text-absent",
    accent: "bg-accent-soft text-accent",
  };
  const toneClass = toneClasses[tone] || toneClasses.accent;
  return (
    <div className={`card animate-rise ${compact ? "min-w-0 p-3 sm:p-4" : "p-6"}`}>
      <div className={`icon-tile ${compact ? "h-10 w-10 rounded-xl" : ""} ${toneClass}`}>
        <Icon size={20} />
      </div>
      <p className={`${compact ? "mt-3 text-xs" : "mt-5 text-sm"} font-medium text-muted`}>{label}</p>
      <p className={`mt-1 whitespace-nowrap font-sans font-bold tabular-nums ${compact ? "text-2xl sm:text-3xl" : "text-4xl"}`}>
        {value ?? "—"}
      </p>
      {hint && <p className="mt-1 text-xs text-muted tabular-nums">{hint}</p>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center gap-3 py-16 text-muted">
      <Loader2 className="animate-spin" size={20} /> {label}
    </div>
  );
}

export function ErrorBox({ children }) {
  if (!children) return null;
  return (
    <div className="rounded-xl border border-absent bg-absent-soft px-4 py-3 text-sm font-medium text-absent">
      {children}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      {Icon && (
        <div className="icon-tile mb-4">
          <Icon size={20} />
        </div>
      )}
      <p className="font-display text-lg font-bold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
    </div>
  );
}

export function StatusChip({ status }) {
  const tone =
    status === "Present"
      ? "present"
      : status === "Late"
        ? "late"
        : status === "Excused"
          ? "excused"
          : status === "Absent"
            ? "absent"
            : "none";
  const colors = {
    present: "bg-present-soft text-present",
    late: "bg-late-soft text-late",
    excused: "bg-excused-soft text-excused",
    absent: "bg-absent-soft text-absent",
    none: "bg-none-soft text-muted",
  };
  return <span className={`chip ${colors[tone]}`}>{status}</span>;
}
