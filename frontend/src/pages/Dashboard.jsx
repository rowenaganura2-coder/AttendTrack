import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BellRing,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  KeyRound,
  Layers,
  Loader2,
  Percent,
  Plus,
  Radio,
  ScanLine,
  Star,
  Users,
  XCircle,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { Empty, ErrorBox, PageHeader, Spinner, StatCard } from "../components/ui";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function HonorRoll({ students, showSubject = true, completed }) {
  return (
    <div className="card p-6 md:p-8">
      <div className="flex items-center gap-3">
        <div className="icon-tile bg-gold-soft text-gold-text">
          <Star size={20} fill="currentColor" />
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold">Perfect Attendance (100%)</h2>
          <p className="text-sm text-muted tabular-nums">
            Students present at every completed session{completed != null ? ` · ${completed} completed` : ""}.
          </p>
        </div>
      </div>
      {students.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          No one on the honor roll yet — it fills in once sessions are completed.
        </p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {students.map((s) => (
            <li
              key={`${s.class_id ?? ""}-${s.student_user_id}`}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface-strong px-4 py-3"
            >
              <Star size={16} className="shrink-0 text-gold-text" fill="currentColor" />
              <div className="min-w-0">
                <p className="truncate font-semibold capitalize">{s.full_name}</p>
                <p className="truncate text-xs text-muted">
                  {s.student_id_number}
                  {showSubject && s.subject ? ` · ${s.subject}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InstructorDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [classes, setClasses] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ subject: "", section: "INF3G", schedule: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([api("/dashboard"), api("/classes")]);
      setStats(d);
      setClasses(c.classes);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api("/classes", { method: "POST", body: form });
      toast(`Class created. Join code: ${r.class_code}`);
      setForm({ subject: "", section: "INF3G", schedule: "" });
      load();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Instructor dashboard"
        title={<>{greeting()}, <span className="capitalize">{user.full_name.split(" ")[0]}</span></>}
        subtitle="Create classes, upload the official classlist, and run live QR sessions."
      />
      <ErrorBox>{error}</ErrorBox>
      {!stats ? (
        !error && <Spinner />
      ) : (
        <div className="flex flex-col gap-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={BookOpen} label="Total Classes" value={stats.total_classes} />
            <StatCard icon={Users} label="Total Students" value={stats.total_students} hint="Enrolled across classes" />
            <StatCard icon={Layers} label="All Sessions" value={stats.all_sessions} />
            <StatCard icon={CalendarClock} label="Today's Sessions" value={stats.today_sessions} tone="gold" />
          </div>

          <section className={`card p-4 ${stats.pending_excuses?.length ? "border-late/30 bg-late-soft/30" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-late-soft text-late">
                  <BellRing size={17} />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold">Excuse requests</h2>
                  <p className="text-xs text-muted">Review submitted documents</p>
                </div>
              </div>
              <span className="chip bg-late-soft px-2 py-1 text-[11px] text-late">
                {stats.pending_excuses?.length || 0} pending
              </span>
            </div>
            {stats.pending_excuses?.length ? (
              <ul className="mt-3 max-h-48 divide-y divide-line overflow-y-auto border-t border-line">
                {stats.pending_excuses.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={`/sessions/${item.session_id}`}
                      className="flex items-center justify-between gap-3 py-2.5 transition hover:text-gold-text"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{item.full_name} · {item.subject}</p>
                        <p className="truncate text-xs text-muted">{item.reason}</p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-gold-text">
                        Review <ArrowRight size={14} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 border-t border-line pt-3 text-xs text-muted">No pending excuse requests.</p>
            )}
          </section>

          <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
            <div className="card p-6 md:p-8">
              <h2 className="font-display text-2xl font-bold">Your classes</h2>
              {classes?.length === 0 ? (
                <div className="mt-6">
                  <Empty icon={BookOpen} title="No classes yet">
                    Create your first class on the right, then import the official roster spreadsheet.
                  </Empty>
                </div>
              ) : (
                <ul className="mt-6 flex flex-col gap-3">
                  {classes?.map((c) => (
                    <li key={c.id}>
                      <Link
                        to={`/classes/${c.id}`}
                        className="group flex flex-col gap-3 rounded-2xl border border-line bg-surface-strong p-5 transition hover:border-gold sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-display text-lg font-bold">{c.subject}</p>
                            {c.active_session_id && (
                              <span className="chip bg-present-soft text-present">
                                <Radio size={12} /> Live
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-muted">
                            {c.section}
                            {c.schedule ? ` · ${c.schedule}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted">
                          <span className="chip bg-gold-soft font-mono tracking-widest text-gold-text">{c.class_code}</span>
                          <span>
                            {c.enrolled_count}/{c.roster_count} enrolled
                          </span>
                          <ArrowRight size={18} className="text-muted transition group-hover:translate-x-1 group-hover:text-gold-text" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form onSubmit={create} className="card flex flex-col gap-4 self-start p-6 md:p-8">
              <h2 className="font-display text-2xl font-bold">New class</h2>
              <input
                className="field"
                placeholder="Subject (e.g. IT 312 – Web Systems)"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                required
              />
              <input
                className="field"
                placeholder="Section"
                value={form.section}
                onChange={(e) => setForm({ ...form, section: e.target.value })}
              />
              <input
                className="field"
                placeholder="Schedule (e.g. MWF 8:00–9:00 AM)"
                value={form.schedule}
                onChange={(e) => setForm({ ...form, schedule: e.target.value })}
              />
              <button className="btn btn-gold" disabled={busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Create class
              </button>
            </form>
          </div>

          <HonorRoll students={stats.perfect_attendance} />
        </div>
      )}
    </>
  );
}

function StudentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [classes, setClasses] = useState(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    Promise.all([api("/dashboard"), api("/classes")])
      .then(([d, c]) => {
        setStats(d);
        setClasses(c.classes);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeader
        eyebrow={`Student · ${user.student_id_number}`}
        title={<>{greeting()}, <span className="capitalize">{user.full_name.split(" ")[0]}</span></>}
        subtitle="Scan the QR on the projector to check in. After the 15-minute grace period, scans are marked Late."
      />
      <ErrorBox>{error}</ErrorBox>
      {!stats ? (
        !error && <Spinner />
      ) : (
        <div className="flex flex-col gap-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={BookOpen} label="Enrolled Classes" value={stats.enrolled_classes} />
            <StatCard icon={CheckCircle2} label="Present" value={stats.present} tone="present" />
            <StatCard icon={XCircle} label="Absent" value={stats.absent} tone="absent" />
            <StatCard
              icon={Percent}
              label="Attendance Rate"
              value={stats.rate == null ? "—" : `${stats.rate}%`}
              hint={`${stats.present} Present · ${stats.late} Late · ${stats.excused} Excused · ${stats.absent} Absent`}
              tone="gold"
            />
          </div>

          {classes && (
            <section className="card p-6 md:p-8">
              <div className="flex items-center gap-3">
                <div className="icon-tile bg-gold-soft text-gold-text">!</div>
                <div>
                  <h2 className="font-display text-2xl font-bold">Academic standing</h2>
                  <p className="text-sm text-muted tabular-nums">
                    Overall: {stats.present}/{stats.completed_sessions} completed sessions marked Present
                    {stats.rate == null ? "." : ` · ${stats.rate}% attendance.`}
                    {" "}Late and Excused are included in the session total.
                  </p>
                </div>
              </div>
              {classes.some((item) => item.risk !== "safe") ? (
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                  {classes.filter((item) => item.risk !== "safe").map((item) => (
                    <li key={item.id}>
                      <Link to={`/classes/${item.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-strong p-4 hover:border-gold">
                        <div className="min-w-0">
                          <p className="font-semibold capitalize">{item.subject}</p>
                          <p className="mt-1 text-xs text-muted">
                            {item.risk_reason || "Attendance requires attention"}
                          </p>
                        </div>
                        <span className={`chip ${item.risk === "at_risk" ? "bg-absent-soft text-absent" : "bg-gold-soft text-gold-text"}`}>
                          {item.attendance_rate == null ? item.risk : `${item.attendance_rate}%`}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-5 rounded-xl border border-present/20 bg-present-soft p-4 text-sm text-present">
                  You are on track in all enrolled classes.
                </p>
              )}
            </section>
          )}

          <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
            <div className="card p-6 md:p-8">
              <h2 className="font-display text-2xl font-bold">My classes</h2>
              {classes?.length === 0 ? (
                <div className="mt-6">
                  <Empty icon={KeyRound} title="Not enrolled yet">
                    Ask your instructor for the 6-character class code or invite link.
                  </Empty>
                </div>
              ) : (
                <ul className="mt-6 flex flex-col gap-3">
                  {classes?.map((c) => (
                    <li key={c.id}>
                      <div className="rounded-2xl border border-line bg-surface-strong p-5 transition hover:border-gold">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <Link to={`/classes/${c.id}`} className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-display text-lg font-bold capitalize">{c.subject}</p>
                            {c.active_session_id && (
                              <span className="chip border border-present/30 bg-present-soft text-present">
                                <span className="relative flex h-2 w-2">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-present opacity-60" />
                                  <span className="relative inline-flex h-2 w-2 rounded-full bg-present" />
                                </span>
                                Live Session Active
                              </span>
                            )}
                            </div>
                            <p className="mt-1 text-sm text-muted">
                              <span className="capitalize">{c.instructor_name}</span>
                              {c.schedule ? ` · ${c.schedule}` : ""}
                            </p>
                          </Link>
                          <span className={`chip shrink-0 tabular-nums ${
                            c.risk === "at_risk"
                              ? "bg-absent-soft text-absent"
                              : c.risk === "warning"
                                ? "bg-gold-soft text-gold-text"
                                : "bg-present-soft text-present"
                          }`}>
                            {c.attendance_rate == null
                              ? "No rate yet"
                              : `${c.attendance_rate}% · ${c.risk === "at_risk" ? "At Risk" : c.risk === "warning" ? "Warning" : "Good"}`}
                          </span>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                          <Link to={`/classes/${c.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-accent">
                            View class <ArrowRight size={16} />
                          </Link>
                          <Link to={`/classes/${c.id}#excuse-requests`} className="btn btn-gold px-3 py-2 text-xs">
                            Submit Excuse
                          </Link>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-6">
              <form
                className="card flex flex-col gap-4 p-6 md:p-8"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.trim()) navigate(`/join?code=${encodeURIComponent(code.trim().toUpperCase())}`);
                }}
              >
                <h2 className="font-display text-2xl font-bold">Join a class</h2>
                <input
                  className="field font-mono uppercase tracking-[0.3em]"
                  placeholder="IT3G01"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <button className="btn btn-gold">
                  <KeyRound size={16} /> Continue
                </button>
              </form>
              <div className="card flex flex-wrap items-center gap-4 p-6 transition hover:border-gold">
                <div className="icon-tile bg-gold-soft text-gold-text">
                  <ScanLine size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-bold">How to check in</p>
                  <p className="text-sm text-muted">Point your phone camera at the class QR.</p>
                </div>
                <Link to="/scan" className="btn btn-gold">
                  <ScanLine size={16} /> Scan Class QR
                </Link>
              </div>
              <Link to="/calendar" className="card flex items-center gap-4 p-6 transition hover:border-gold">
                <div className="icon-tile">
                  <CalendarCheck size={20} />
                </div>
                <div>
                  <p className="font-display text-lg font-bold">My calendar</p>
                  <p className="text-sm text-muted">Present, Late, Excused, and Absent by month or week.</p>
                </div>
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  return user.role === "instructor" ? <InstructorDashboard /> : <StudentDashboard />;
}
