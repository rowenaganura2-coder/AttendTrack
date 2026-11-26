import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Clock3,
  Download,
  KeyRound,
  Loader2,
  Plus,
  Radio,
  Search,
  Users,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { downloadWorkbook, instructorWorkbook, safeFileName } from "../lib/exportExcel";
import { Empty, ErrorBox, PageHeader, Spinner } from "../components/ui";

function InstructorClasses() {
  const navigate = useNavigate();
  const toast = useToast();
  const [classes, setClasses] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [startingId, setStartingId] = useState(null);
  const [exportingId, setExportingId] = useState(null);

  useEffect(() => {
    api("/classes")
      .then((data) => setClasses(data.classes))
      .catch((e) => setError(e.message));
  }, []);

  const filteredClasses = useMemo(() => {
    if (!classes) return [];
    const query = search.trim().toLowerCase();
    if (!query) return classes;
    return classes.filter((cls) =>
      [cls.subject, cls.class_code, cls.section, cls.schedule]
        .some((value) => String(value || "").toLowerCase().includes(query)),
    );
  }, [classes, search]);

  const startOrResume = async (cls) => {
    if (cls.active_session_id) {
      navigate(`/sessions/${cls.active_session_id}`);
      return;
    }
    setStartingId(cls.id);
    try {
      const result = await api(`/classes/${cls.id}/sessions`, { method: "POST" });
      navigate(`/sessions/${result.session_id}`);
    } catch (e) {
      toast(e.message, "error");
      setStartingId(null);
    }
  };

  const exportClass = async (cls) => {
    setExportingId(cls.id);
    try {
      const data = await api(`/export/${cls.id}`);
      const workbook = await instructorWorkbook(data);
      await downloadWorkbook(workbook, `attendance-${safeFileName(cls.subject)}.xlsx`);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setExportingId(null);
    }
  };

  const countLabel = `${filteredClasses.length} ${filteredClasses.length === 1 ? "course" : "courses"}`;

  return (
    <>
      <PageHeader
        eyebrow="Instructor"
        title="Classes & Rosters"
        subtitle="Manage your courses, roster validations, and start or resume live QR sessions."
      >
        <Link to="/dashboard" className="btn btn-gold shadow-gold">
          <Plus size={16} /> Create a class
        </Link>
      </PageHeader>

      <ErrorBox>{error}</ErrorBox>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-xl">
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="field py-3 pl-11"
            type="search"
            placeholder="Search class, code, or section..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search classes"
          />
        </label>
        {classes && <p className="shrink-0 text-sm text-muted">Showing {countLabel}</p>}
      </div>

      {!classes ? (
        !error && <Spinner />
      ) : classes.length === 0 ? (
        <Empty icon={BookOpen} title="No classes yet">
          Create your first class from the dashboard to add a roster and start attendance sessions.
        </Empty>
      ) : filteredClasses.length === 0 ? (
        <Empty icon={Search} title="No matching classes">
          Try another subject, class code, or section.
        </Empty>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {filteredClasses.map((cls) => {
            const hasActiveSession = Boolean(cls.active_session_id);
            const busyStarting = startingId === cls.id;
            const busyExporting = exportingId === cls.id;
            return (
              <li key={cls.id} className="min-w-0">
                <article className="group h-full rounded-2xl border border-line bg-surface p-5 shadow-card backdrop-blur-xl transition hover:border-gold/50 hover:shadow-gold sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent-soft font-display text-xl font-bold text-accent">
                        {cls.id}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs font-bold uppercase tracking-[0.16em] text-accent">
                          Course {cls.id}
                        </p>
                        <span className="mt-1 inline-flex max-w-full truncate rounded-full border border-gold/25 bg-gold-soft px-2.5 py-1 font-mono text-[0.68rem] font-bold tracking-wider text-gold-text">
                          {cls.section} · {cls.class_code}
                        </span>
                      </div>
                    </div>
                    {hasActiveSession ? (
                      <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-present/30 bg-present-soft px-3 py-1.5 text-xs font-semibold text-present">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-present opacity-60" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-present" />
                        </span>
                        Resumable
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface-strong px-3 py-1.5 text-xs font-semibold text-muted">
                        Ready
                      </span>
                    )}
                  </div>

                  <h2 className="mt-5 font-display text-xl font-bold leading-snug text-ink sm:text-2xl">
                    {cls.subject}
                  </h2>

                  <div className="mt-4 grid gap-3 text-sm text-muted sm:grid-cols-2">
                    <p className="flex min-w-0 items-center gap-2">
                      <Clock3 size={16} className="shrink-0 text-accent" />
                      <span className="truncate">{cls.section}{cls.schedule ? ` · ${cls.schedule}` : " · Schedule not set"}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Users size={16} className="shrink-0 text-accent" />
                      <span>{cls.enrolled_count}/{cls.roster_count} enrolled</span>
                    </p>
                  </div>

                  <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-surface-strong/70 px-3 py-2.5 text-xs">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${hasActiveSession ? "animate-pulse bg-present" : "bg-muted"}`} />
                    <span className={hasActiveSession ? "font-semibold text-present" : "text-muted"}>
                      {hasActiveSession ? "Session active · ready to resume" : "No active session"}
                    </span>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                    <button
                      type="button"
                      onClick={() => startOrResume(cls)}
                      disabled={busyStarting}
                      className="btn btn-gold min-w-40 flex-1 shadow-gold"
                    >
                      {busyStarting ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Radio size={16} />
                      )}
                      {hasActiveSession ? "Resume Session" : "Start Session"}
                    </button>
                    <button
                      type="button"
                      onClick={() => exportClass(cls)}
                      disabled={busyExporting}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-present/40 px-3 py-2 text-sm font-semibold text-present transition hover:bg-present-soft disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busyExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                      Export Excel
                    </button>
                    <Link
                      to={`/classes/${cls.id}`}
                      aria-label={`Open ${cls.subject} class details`}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line text-muted transition hover:border-gold hover:text-gold-text"
                    >
                      <ArrowRight size={18} />
                    </Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function StudentClasses() {
  const [classes, setClasses] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api("/classes")
      .then((data) => setClasses(data.classes))
      .catch((e) => setError(e.message));
  }, []);

  const filteredClasses = useMemo(() => {
    if (!classes) return [];
    const query = search.trim().toLowerCase();
    if (!query) return classes;
    return classes.filter((cls) =>
      [cls.subject, cls.class_code, cls.section, cls.instructor_name]
        .some((value) => String(value || "").toLowerCase().includes(query)),
    );
  }, [classes, search]);

  return (
    <>
      <PageHeader
        eyebrow="Student"
        title="My Classes"
        subtitle="View your enrolled classes and attendance."
      >
        <Link to="/join" className="btn btn-gold">
          <KeyRound size={16} /> Join a class
        </Link>
      </PageHeader>
      <ErrorBox>{error}</ErrorBox>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-xl">
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="field py-3 pl-11"
            type="search"
            placeholder="Search class, code, or section..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search classes"
          />
        </label>
        {classes && <p className="shrink-0 text-sm text-muted">Showing {filteredClasses.length} {filteredClasses.length === 1 ? "course" : "courses"}</p>}
      </div>
      {!classes ? (
        !error && <Spinner />
      ) : classes.length === 0 ? (
        <Empty icon={KeyRound} title="Not enrolled in any classes">
          Join a class with the code shared by your instructor.
        </Empty>
      ) : filteredClasses.length === 0 ? (
        <Empty icon={Search} title="No matching classes">Try another subject, class code, or section.</Empty>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {filteredClasses.map((cls) => (
            <li key={cls.id}>
              <div className="rounded-2xl border border-line bg-surface p-5 shadow-card transition hover:border-gold/50 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <span className="rounded-full border border-gold/25 bg-gold-soft px-3 py-1.5 font-mono text-xs font-bold tracking-wider text-gold-text">
                    {cls.section} · {cls.class_code}
                  </span>
                  <span className={`chip shrink-0 tabular-nums ${
                    cls.risk === "at_risk"
                      ? "bg-absent-soft text-absent"
                      : cls.risk === "warning"
                        ? "bg-gold-soft text-gold-text"
                        : "bg-present-soft text-present"
                  }`}>
                    {cls.attendance_rate == null
                      ? "No rate yet"
                      : `${cls.attendance_rate}% · ${cls.risk === "at_risk" ? "At Risk" : cls.risk === "warning" ? "Warning" : "Good"}`}
                  </span>
                </div>
                <h2 className="mt-4 font-display text-xl font-bold capitalize">{cls.subject}</h2>
                <p className="mt-2 text-sm text-muted"><span className="capitalize">{cls.instructor_name}</span>{cls.schedule ? ` · ${cls.schedule}` : ""}</p>
                {cls.active_session_id && (
                  <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-present/30 bg-present-soft px-3 py-1.5 text-xs font-semibold text-present">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-present opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-present" />
                    </span>
                    Live Session Active
                  </span>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                  <Link to={`/classes/${cls.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-accent">
                    View class <ArrowRight size={16} />
                  </Link>
                  <Link to={`/classes/${cls.id}#excuse-requests`} className="btn btn-gold px-3 py-2 text-xs">
                    Submit Excuse
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ClassesPage() {
  const { user } = useAuth();
  return user.role === "instructor" ? <InstructorClasses /> : <StudentClasses />;
}
