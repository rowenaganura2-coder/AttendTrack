import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { api, fromISO, prettyDate, toISO } from "../lib/api";
import { downloadWorkbook, instructorWorkbook, safeFileName, studentWorkbook } from "../lib/exportExcel";
import { useToast } from "./Toast";
import { ErrorBox } from "./ui";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_TONES = {
  Present: { border: "border-present", fill: "bg-present-soft", text: "text-present", dot: "bg-present" },
  Late: { border: "border-late", fill: "bg-late-soft", text: "text-late", dot: "bg-late" },
  Excused: { border: "border-excused", fill: "bg-excused-soft", text: "text-excused", dot: "bg-excused" },
  Absent: { border: "border-absent", fill: "bg-absent-soft", text: "text-absent", dot: "bg-absent" },
};

function StudentCell({ day, big }) {
  const weekend = day.weekday >= 5;
  const statuses = day.statuses?.length ? day.statuses : day.status in STATUS_TONES ? [day.status] : [];
  const tone = statuses.length === 1
    ? `${STATUS_TONES[statuses[0]].border} ${STATUS_TONES[statuses[0]].fill}`
    : weekend && !statuses.length
      ? "border-transparent bg-transparent"
      : "border-line bg-surface-strong";
  return (
    <div className="flex h-full flex-col gap-1">
      <div className={`flex flex-1 flex-col justify-between rounded-xl border p-2 ${tone}`}>
        <div className="flex min-h-2.5 items-center justify-end gap-1">
          {statuses.length
            ? statuses.map((status) => (
              <span key={status} aria-label={status} className={`h-2.5 w-2.5 rounded-full ${STATUS_TONES[status].dot}`} />
            ))
            : <span aria-label="No class" className="h-2.5 w-2.5 rounded-full bg-none" />}
        </div>
        {big || day.status !== "No Class" ? (
          <span
            className={`text-[0.7rem] font-bold ${STATUS_TONES[day.status]?.text || "text-muted"}`}
          >
            {day.status}
          </span>
        ) : null}
        {big &&
          day.entries?.map((e, i) => (
            <span key={`${e.subject}-${i}`} className={`truncate text-[0.7rem] ${STATUS_TONES[e.status]?.text || "text-muted"}`}>
              {e.subject} · {e.status}
            </span>
          ))}
      </div>
    </div>
  );
}

function InstructorCell({ day }) {
  if (!day.has_session)
    return <div aria-label="No session" className={`flex-1 rounded-xl border p-2 ${day.weekday >= 5 ? "border-transparent" : "border-line bg-surface-strong"}`} />;
  return (
    <div className="grid flex-1 grid-cols-2 content-end gap-1 rounded-xl border border-line bg-surface-strong p-2">
      <span className="chip justify-center bg-present-soft px-1.5 text-present">P {day.present}</span>
      <span className="chip justify-center bg-late-soft px-1.5 text-late">L {day.late}</span>
      <span className="chip justify-center bg-excused-soft px-1.5 text-excused">E {day.excused}</span>
      <span className="chip justify-center bg-absent-soft px-1.5 text-absent">A {day.absent}</span>
    </div>
  );
}

export default function AttendanceCalendar({ classId, role, title = "Attendance calendar" }) {
  const toast = useToast();
  const [view, setView] = useState("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const iso = toISO(anchor);

  useEffect(() => {
    let alive = true;
    setError("");
    api(`/calendar?view=${view}&date=${iso}${classId ? `&class_id=${classId}` : ""}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [classId, view, iso]);

  const shift = (dir) => {
    const d = new Date(anchor);
    if (view === "week") d.setDate(d.getDate() + 7 * dir);
    else {
      d.setDate(1);
      d.setMonth(d.getMonth() + dir);
    }
    setAnchor(d);
  };

  const cells = useMemo(() => {
    if (!data) return [];
    const lead = view === "month" ? fromISO(data.start).getDay() : 0;
    const blanks = view === "month" ? (lead + 6) % 7 : 0;
    const list = [...Array(blanks).fill(null), ...data.days];
    while (list.length % 7) list.push(null);
    return list;
  }, [data, view]);

  const summary = useMemo(() => {
    if (!data) return null;
    if (role === "student") {
      return {
        present: data.days.reduce((total, day) => total + (day.counts?.Present || 0), 0),
        late: data.days.reduce((total, day) => total + (day.counts?.Late || 0), 0),
        excused: data.days.reduce((total, day) => total + (day.counts?.Excused || 0), 0),
        absent: data.days.reduce((total, day) => total + (day.counts?.Absent || 0), 0),
      };
    }
    return { a: data.days.filter((d) => d.has_session).length };
  }, [data, role]);

  const heading = data
    ? view === "month"
      ? fromISO(data.start).toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : `${prettyDate(data.start, { month: "short", day: "numeric" })} – ${prettyDate(data.end, { month: "short", day: "numeric", year: "numeric" })}`
    : "";

  const exportExcel = async () => {
    if (!classId) return;
    setExporting(true);
    try {
      const d = await api(`/export/${classId}`);
      const safe = safeFileName(d.class.subject);
      if (role === "student") {
        await downloadWorkbook(
          await studentWorkbook(d),
          `attendance-${safe}-${safeFileName(d.student.student_id_number)}.xlsx`,
        );
      } else {
        await downloadWorkbook(await instructorWorkbook(d), `attendance-${safe}.xlsx`);
      }
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="card p-5 md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">{title}</h2>
          <p className="text-sm text-muted tabular-nums">
            {heading}
            {summary &&
              (role === "student"
                ? ` · ${summary.present} Present · ${summary.late} Late · ${summary.excused} Excused · ${summary.absent} Absent`
                : ` · ${summary.a} session day${summary.a === 1 ? "" : "s"}`)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-line bg-surface-strong p-1">
            {["month", "week"].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize transition ${
                  view === v ? "bg-gold text-gold-ink" : "text-muted hover:text-ink"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <button onClick={() => shift(-1)} className="btn btn-ghost px-3" aria-label="Previous">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setAnchor(new Date())} className="btn btn-ghost px-3 text-sm">
            Today
          </button>
          <button onClick={() => shift(1)} className="btn btn-ghost px-3" aria-label="Next">
            <ChevronRight size={16} />
          </button>
          {classId && (
            <button onClick={exportExcel} disabled={exporting} className="btn border border-slate-300 bg-transparent text-sm text-slate-700 hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800">
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export Excel
            </button>
          )}
        </div>
      </div>

      <div className="mt-5">
        <ErrorBox>{error}</ErrorBox>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1.5 md:gap-2">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-xs font-bold uppercase tracking-wider text-muted">
            {w}
          </div>
        ))}
        {cells.map((day, i) =>
          day ? (
            <div
              key={day.date}
              className={`flex flex-col gap-1 ${view === "week" ? "min-h-40" : "min-h-20 md:min-h-24"}`}
            >
              <span
                className={`self-start rounded-md px-1.5 text-xs font-bold tabular-nums ${
                  day.date === data.today ? "bg-gold text-gold-ink" : "text-muted"
                }`}
              >
                {fromISO(day.date).getDate()}
              </span>
              {role === "student" ? <StudentCell day={day} big={view === "week"} /> : <InstructorCell day={day} />}
            </div>
          ) : (
            <div key={`b${i}`} />
          ),
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-4 text-xs text-muted">
        {role === "student" ? (
          <>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-present" /> Present</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-late" /> Late</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-excused" /> Excused</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-absent" /> Absent</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-present" /> Present</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-late" /> Late</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-excused" /> Excused</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-absent" /> Absent</span>
          </>
        )}
        {role === "student" && (
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-none" /> No class / weekend</span>
        )}
      </div>
    </div>
  );
}
