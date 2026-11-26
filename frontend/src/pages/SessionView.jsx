import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, CheckCircle2, Loader2, Maximize2, Minimize2, Radio, Search, Square, Users, XCircle } from "lucide-react";
import { api, pad, prettyDate, prettyTime } from "../lib/api";
import { useToast } from "../components/Toast";
import { ErrorBox, PageHeader, Spinner, StatCard } from "../components/ui";

const ROTATE_SECONDS = 60;
const GRACE_SECONDS = 15 * 60;

const statusColor = {
  Present: "border-present bg-present-soft text-present",
  Late: "border-late bg-late-soft text-late",
  Excused: "border-excused bg-excused-soft text-excused",
  Absent: "border-absent bg-absent-soft text-absent",
};

export default function SessionView() {
  const { id } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(ROTATE_SECONDS);
  const [graceSecondsLeft, setGraceSecondsLeft] = useState(GRACE_SECONDS);
  const [ending, setEnding] = useState(false);
  const [big, setBig] = useState(false);
  const [saving, setSaving] = useState({});
  const [showRiskOnly, setShowRiskOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [activity, setActivity] = useState([]);
  const [reviewing, setReviewing] = useState({});
  const rotating = useRef(false);
  const seenCheckins = useRef({ sessionId: null, keys: new Set() });

  const load = useCallback(async () => {
    try {
      const d = await api(`/sessions/${id}`);
      setData(d);
      setSecondsLeft(Math.max(0, Number(d.session.qr_seconds_left ?? ROTATE_SECONDS)));
      setGraceSecondsLeft(Math.max(0, Number(d.session.grace_seconds_left ?? GRACE_SECONDS)));
      if (seenCheckins.current.sessionId !== id) {
        seenCheckins.current = { sessionId: id, keys: new Set() };
        setActivity([]);
      }
      const newCheckins = d.recent_checkins.filter((item) => {
        const key = `${item.student_user_id}-${item.marked_at}`;
        if (seenCheckins.current.keys.has(key)) return false;
        seenCheckins.current.keys.add(key);
        return true;
      });
      if (newCheckins.length) {
        setActivity((current) => [...newCheckins, ...current].slice(0, 8));
      }
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  // first load + live roster refresh every 4 seconds
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const active = data?.session.is_active;

  const rotate = useCallback(async () => {
    if (rotating.current) return;
    rotating.current = true;
    try {
      const r = await api(`/sessions/${id}/rotate`, { method: "POST" });
      setData((d) => (d ? { ...d, session: { ...d.session, qr_secret: r.qr_secret, qr_path: r.qr_path } } : d));
      setSecondsLeft(ROTATE_SECONDS);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      rotating.current = false;
    }
  }, [id, toast]);

  // Keep the QR and grace-period clocks independent; scan classification is enforced by the API.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          rotate();
          return 0;
        }
        return s - 1;
      });
      setGraceSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [active, rotate]);

  const updateAttendance = async (studentUserId, status) => {
    setSaving((s) => ({ ...s, [studentUserId]: true }));
    setData((d) => ({
      ...d,
      roster: d.roster.map((r) => (r.student_user_id === studentUserId ? { ...r, status, marked_by: "instructor" } : r)),
    }));
    try {
      await api("/attendance/update", {
        method: "POST",
        body: { session_id: Number(id), student_user_id: studentUserId, status },
      });
    } catch (e) {
      toast(e.message, "error");
      load();
    } finally {
      setSaving((s) => ({ ...s, [studentUserId]: false }));
    }
  };

  const endSession = async () => {
    if (!window.confirm("End this session? Students will no longer be able to scan in.")) return;
    setEnding(true);
    try {
      await api(`/sessions/${id}/end`, { method: "POST" });
      toast("Session ended");
      load();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setEnding(false);
    }
  };

  const reviewExcuse = async (requestId, status) => {
    setReviewing((current) => ({ ...current, [requestId]: true }));
    try {
      await api(`/excuses/${requestId}/review`, { method: "POST", body: { status } });
      toast(`Excuse request ${status.toLowerCase()}`);
      await load();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setReviewing((current) => ({ ...current, [requestId]: false }));
    }
  };

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Spinner />;

  const { session, roster, excuses } = data;
  const present = roster.filter((r) => r.status === "Present").length;
  const late = roster.filter((r) => r.status === "Late").length;
  const excused = roster.filter((r) => r.status === "Excused").length;
  const absent = roster.filter((r) => r.status === "Absent").length;
  const filteredRoster = roster.filter((student) => {
    const matchesSearch = `${student.full_name} ${student.student_id_number}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesSearch && (!showRiskOnly || student.risk !== "safe");
  });
  const qrUrl = `${window.location.origin}${session.qr_path}`;
  const progress = (secondsLeft / ROTATE_SECONDS) * 100;
  const graceEnded = graceSecondsLeft === 0;
  const formatCountdown = (seconds) => `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;

  return (
    <>
      <Link to={`/classes/${session.class_id}`} className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-gold-text">
        <ArrowLeft size={16} /> {session.subject}
      </Link>
      <PageHeader
        eyebrow={active ? "Live session" : "Session ended"}
        title={prettyDate(session.session_date, { weekday: "long", month: "long", day: "numeric" })}
        subtitle={`${session.subject} · ${session.section} · Code ${session.class_code}`}
      >
        {active && (
          <button onClick={endSession} disabled={ending} className="btn btn-danger">
            {ending ? <Loader2 size={16} className="animate-spin" /> : <Square size={14} fill="currentColor" />} End session
          </button>
        )}
      </PageHeader>

      <div className="mt-6 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={Users} label="Enrolled" value={roster.length} compact />
        <StatCard icon={CheckCircle2} label="Present" value={present} tone="present" compact />
        <StatCard icon={CheckCircle2} label="Late" value={late} tone="late" compact />
        <StatCard icon={CheckCircle2} label="Excused" value={excused} tone="excused" compact />
        <StatCard icon={XCircle} label="Absent" value={absent} tone="absent" compact />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:sticky lg:top-6 lg:col-span-4">
          {active ? (
            <div className="card flex flex-col items-center p-6 md:p-8">
              <div className="flex w-full items-center justify-between">
                <span className="chip bg-present-soft text-present">
                  <Radio size={12} /> Scanning open
                </span>
                <button onClick={() => setBig(true)} className="rounded-lg p-2 text-muted hover:text-gold-text" aria-label="Show QR full screen">
                  <Maximize2 size={16} />
                </button>
              </div>
              <div className="mt-5 w-full max-w-[260px] rounded-2xl bg-white p-3 shadow-card sm:p-4">
                <QRCodeSVG className="block h-auto max-w-full" value={qrUrl} size={260} fgColor="#0b1e45" bgColor="#ffffff" level="M" />
              </div>
              <div className="mt-5 grid w-full grid-cols-2 gap-3">
                <div className="rounded-xl bg-surface-strong p-3 text-center">
                  <p className="text-xs font-semibold text-muted">QR refresh in</p>
                  <p className="mt-1 font-display text-3xl font-bold tabular-nums">{formatCountdown(secondsLeft)}</p>
                </div>
                <div className={`rounded-xl p-3 text-center ${graceEnded ? "bg-late-soft text-late" : "bg-accent-soft text-accent"}`}>
                  <p className="text-xs font-semibold">On-time window</p>
                  <p className="mt-1 font-display text-3xl font-bold tabular-nums">{formatCountdown(graceSecondsLeft)}</p>
                </div>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-none-soft">
                <div className="h-full rounded-full bg-gold transition-[width] duration-1000 ease-linear" style={{ width: `${progress}%` }} />
              </div>
              {graceEnded && (
                <p role="status" className="mt-3 w-full rounded-xl border border-late/30 bg-late-soft px-4 py-3 text-center text-sm font-semibold text-late">
                  Grace period ended — late-comer mode is active. New scans are marked Late.
                </p>
              )}
              <p className="mt-4 text-center text-xs text-muted">
                Students point their phone camera at this code. It refreshes every minute so photos can't be shared.
              </p>
              <div className="mt-6 w-full border-t border-line pt-4">
                <h3 className="font-display text-lg font-bold">Recent check-ins</h3>
                {activity.length ? (
                  <ul className="mt-3 flex max-h-60 flex-col gap-2 overflow-auto">
                    {activity.map((item, index) => (
                      <li key={`${item.student_user_id}-${item.marked_at}`} className={`rounded-xl border p-3 animate-rise ${statusColor[item.status] || "border-line bg-surface-strong"} ${index === 0 ? "ring-1 ring-current/20" : ""}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold">{item.full_name}</p>
                            <p className="font-mono text-xs text-muted">{item.student_id_number}</p>
                          </div>
                          <span className="shrink-0 text-xs font-semibold">{item.status} · {prettyTime(item.marked_at)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted">Check-ins will appear here as students scan.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center">
              <p className="font-display text-2xl font-bold">Session ended</p>
              <p className="mt-2 text-sm text-muted">Scanning is closed. You can still correct statuses in the roster.</p>
            </div>
          )}
        </div>

        <div className="space-y-6 lg:col-span-8">
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-4 p-5 md:px-6">
              <div>
                <h2 className="font-display text-2xl font-bold">Roster</h2>
                <p className="text-sm text-muted">Updates live. Change a status to override instantly.</p>
              </div>
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                <label className="relative min-w-48 flex-1 sm:w-56 sm:flex-none">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search roster"
                    aria-label="Search roster"
                    className="field-sm w-full py-2 pl-9"
                  />
                </label>
                <button onClick={() => setShowRiskOnly((value) => !value)} className="btn btn-ghost shrink-0 px-3 py-2 text-sm">
                  {showRiskOnly ? "Show All" : "At-Risk Only"}
                </button>
              </div>
            </div>
            {filteredRoster.length === 0 ? (
              <p className="border-t border-line px-6 py-8 text-center text-sm text-muted">
                {roster.length === 0
                  ? "No students enrolled yet. Share the invite link from the class page."
                  : "No students match these filters."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-strong text-xs uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-6 py-3">#</th>
                      <th className="px-6 py-3">Student</th>
                      <th className="px-6 py-3">Marked</th>
                      <th className="px-6 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRoster.map((r, i) => (
                      <tr key={r.student_user_id} className="border-t border-line">
                        <td className="px-6 py-3 text-muted tabular-nums">{i + 1}</td>
                        <td className="px-6 py-3">
                          <p className="font-semibold capitalize">{r.full_name}</p>
                          <p className="font-mono text-xs text-muted">{r.student_id_number}</p>
                          {r.risk !== "safe" && (
                            <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${
                              r.risk === "at_risk" ? "bg-absent-soft text-absent" : "bg-gold-soft text-gold-text"
                            }`}>
                              ⚠️ {r.risk === "at_risk" && r.rate != null && r.rate < 75
                                ? "At Risk (< 75%)"
                                : r.consecutive_absences >= 2
                                  ? `${r.consecutive_absences} Consecutive Absences`
                                  : r.risk_reason || "Attendance warning"}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-xs text-muted">
                          {r.marked_at
                            ? `${prettyTime(r.marked_at)} · ${r.marked_by === "qr" ? "QR" : "Manual"}`
                            : "—"}
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            <select
                              value={r.status}
                              onChange={(e) => updateAttendance(r.student_user_id, e.target.value)}
                              className={`field-sm rounded-full ${statusColor[r.status] || ""}`}
                              aria-label={`Status for ${r.full_name}`}
                            >
                              <option value="Present">Present</option>
                              <option value="Late">Late</option>
                              <option value="Excused">Excused</option>
                              <option value="Absent">Absent</option>
                            </select>
                            {saving[r.student_user_id] && <Loader2 size={14} className="animate-spin text-muted" />}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <section className="card overflow-hidden">
            <div className="p-5 md:px-6">
              <h2 className="font-display text-xl font-bold">Absence excuse requests</h2>
              <p className="text-sm text-muted">Open the document to review it. Approving marks the student Excused.</p>
            </div>
            {excuses?.length > 0 ? (
              <ul className="divide-y divide-line border-t border-line">
                {excuses.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-start justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <p className="font-semibold">{item.full_name} <span className="font-mono text-xs text-muted">{item.student_id_number}</span></p>
                      <p className="mt-1 text-sm text-muted">{item.reason}</p>
                      <a className="mt-2 inline-flex text-xs font-semibold text-gold-text hover:underline"
                        href={`/api/excuses/${item.id}/document`} target="_blank" rel="noreferrer">
                        View excuse document
                      </a>
                    </div>
                    {item.status === "Pending" ? (
                      <div className="flex gap-2">
                        <button className="btn btn-gold" disabled={reviewing[item.id]} onClick={() => reviewExcuse(item.id, "Approved")}>Approve &amp; excuse</button>
                        <button className="btn btn-danger" disabled={reviewing[item.id]} onClick={() => reviewExcuse(item.id, "Rejected")}>Reject</button>
                      </div>
                    ) : (
                      <span className={`chip ${item.status === "Approved" ? "bg-excused-soft text-excused" : "bg-absent-soft text-absent"}`}>
                        {item.status === "Approved" ? "Approved · Excused" : item.status}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-line px-5 py-4 text-sm text-muted">
                No requests yet. Students can submit an excuse after the session ends if their attendance is Absent.
              </p>
            )}
          </section>
        </div>
      </div>

      {big && active && (
        <div className="fixed inset-0 z-50 flex animate-fade flex-col items-center justify-center gap-6 bg-bg p-6">
          <button onClick={() => setBig(false)} className="btn btn-ghost absolute right-6 top-6">
            <Minimize2 size={16} /> Close
          </button>
          <p className="eyebrow">{session.subject}</p>
          <div className="rounded-3xl bg-white p-6 shadow-card">
            <QRCodeSVG value={qrUrl} size={Math.min(560, window.innerHeight - 260)} fgColor="#0b1e45" bgColor="#ffffff" level="M" />
          </div>
          <p className="font-display text-3xl font-bold tabular-nums">
            {formatCountdown(secondsLeft)} · QR refresh · {formatCountdown(graceSecondsLeft)} grace · {present}/{roster.length} present
          </p>
          {graceEnded && <p className="rounded-xl bg-late-soft px-4 py-3 text-center font-semibold text-late">Late-comer mode active · scans marked Late</p>}
        </div>
      )}
    </>
  );
}
