import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Loader2,
  Percent,
  Play,
  Radio,
  ScanLine,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { api, prettyDate, prettyTime } from "../lib/api";
import { useToast } from "../components/Toast";
import AttendanceCalendar from "../components/AttendanceCalendar";
import { Empty, ErrorBox, PageHeader, Spinner, StatCard } from "../components/ui";
import { HonorRoll } from "./Dashboard";

function BackLink() {
  return (
    <Link to="/dashboard" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-gold-text">
      <ArrowLeft size={16} /> Dashboard
    </Link>
  );
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (character === '"' && quoted && text[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[i + 1] === "\n") i += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function mapRosterRows(rows) {
  const normalizeHeader = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const headers = rows.find((row) => {
    const normalized = row.map(normalizeHeader);
    const hasId = normalized.some((header) =>
      header.includes("studentid") || header.includes("idnumber") || header === "id",
    );
    const hasName = normalized.some((header) =>
      ["fullname", "name", "firstname", "givenname", "lastname", "surname"].includes(header),
    );
    return hasId && hasName;
  });
  if (!headers) throw new Error("Could not find a header row with Student ID and Name columns.");
  const normalized = headers.map(normalizeHeader);
  const idIndex = normalized.findIndex((header) =>
    header.includes("studentid") || header.includes("idnumber") || header === "id",
  );
  const fullNameIndex = normalized.findIndex((header) => header === "fullname" || header === "name");
  const firstNameIndex = normalized.findIndex((header) => header === "firstname" || header === "givenname");
  const lastNameIndex = normalized.findIndex((header) => header === "lastname" || header === "surname");
  if (idIndex < 0 || (fullNameIndex < 0 && firstNameIndex < 0 && lastNameIndex < 0)) {
    throw new Error("The spreadsheet needs a Student ID and Full Name, Name, or First/Last Name column.");
  }
  const headerIndex = rows.indexOf(headers);
  return rows.slice(headerIndex + 1).map((row) => {
    const student_id_number = String(row[idIndex] ?? "").replace(/[^a-z0-9]/gi, "");
    const full_name = String(
      fullNameIndex >= 0
        ? row[fullNameIndex] ?? ""
        : `${row[firstNameIndex] ?? ""} ${row[lastNameIndex] ?? ""}`,
    ).replace(/\s+/g, " ").trim();
    return { student_id_number, full_name };
  }).filter((student) => student.student_id_number && /\d/.test(student.student_id_number) && student.full_name);
}

function InstructorClass({ id }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showRiskOnly, setShowRiskOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, a] = await Promise.all([api(`/classes/${id}`), api(`/analytics/${id}`)]);
      setData(d);
      setAnalytics(a);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Spinner />;
  const cls = data.class;
  const invite = `${window.location.origin}/join?code=${cls.class_code}`;
  const active = data.sessions.find((s) => s.is_active);
  const classAverageRate = analytics?.completed_sessions && analytics.students.length
    ? Math.round(
      (analytics.students.reduce((total, student) => total + student.present, 0)
        / (analytics.students.length * analytics.completed_sessions)) * 1000,
    ) / 10
    : null;

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      toast("Invite link copied");
    } catch {
      window.prompt("Copy this invite link:", invite);
    }
  };

  const parseRosterFile = async (file) => {
    setFileError("");
    setPreview(null);
    try {
      let rawRows;
      if (file.name.toLowerCase().endsWith(".csv")) {
        rawRows = parseCsv(await file.text());
      } else if (file.name.toLowerCase().endsWith(".xlsx")) {
        const { default: ExcelJS } = await import("exceljs");
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error("The workbook does not contain a worksheet.");
        rawRows = [];
        sheet.eachRow({ includeEmpty: false }, (row) => {
          rawRows.push(row.values.slice(1).map((value) => {
            if (value && typeof value === "object" && "text" in value) return value.text;
            return value ?? "";
          }));
        });
      } else {
        throw new Error("Choose a .CSV or .XLSX spreadsheet.");
      }
      const students = mapRosterRows(rawRows);
      if (!students.length) throw new Error("No valid student rows were found.");
      const cleanId = (value) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
      const existingIds = new Set(data.classlist.map((row) => cleanId(row.student_id_number)));
      const seen = new Set();
      const previewRows = students.map((student) => {
        const key = cleanId(student.student_id_number);
        const duplicate = existingIds.has(key) || seen.has(key);
        seen.add(key);
        return { ...student, duplicate };
      });
      setPreview({ rows: previewRows, invalid: Math.max(rawRows.length - 1 - students.length, 0) });
    } catch (e) {
      setFileError(e.message);
    }
  };

  const saveList = async () => {
    const students = preview?.rows.filter((row) => !row.duplicate).map(
      ({ student_id_number, full_name }) => ({ student_id_number, full_name }),
    ) ?? [];
    if (!students.length) return;
    setSaving(true);
    try {
      const r = await api(`/classes/${id}/classlist`, { method: "POST", body: { students } });
      toast(`Imported — ${r.added} student${r.added === 1 ? "" : "s"} added${r.duplicates ? `, ${r.duplicates} duplicate(s) skipped` : ""}`);
      setPreview(null);
      load();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (row) => {
    if (!window.confirm(`Remove ${row.full_name} from the official classlist?`)) return;
    try {
      await api(`/classes/${id}/classlist/${row.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const start = async () => {
    setStarting(true);
    try {
      const r = await api(`/classes/${id}/sessions`, { method: "POST" });
      navigate(`/sessions/${r.session_id}`);
    } catch (e) {
      toast(e.message, "error");
      setStarting(false);
    }
  };

  return (
    <>
      <BackLink />
      <PageHeader
        eyebrow={`${cls.section} · Code ${cls.class_code}`}
        title={<span className="capitalize">{cls.subject}</span>}
        subtitle={cls.schedule || "No schedule set"}
      >
        <button onClick={copyInvite} className="btn btn-ghost">
          <Copy size={16} /> Copy invite link
        </button>
        {active ? (
          <Link to={`/sessions/${active.id}`} className="btn btn-gold">
            <Radio size={16} /> Open live session
          </Link>
        ) : (
          <button onClick={start} disabled={starting} className="btn btn-gold">
            {starting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} Start today's session
          </button>
        )}
      </PageHeader>

      <div className="flex flex-col gap-8">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={ListChecks} label="On official classlist" value={data.classlist.length} />
          <StatCard icon={Users} label="Enrolled" value={cls.enrolled_count} />
          <StatCard icon={CheckCircle2} label="Completed sessions" value={analytics?.completed_sessions} tone="gold" />
          <StatCard
            icon={Percent}
            label="Class Avg Attendance"
            value={classAverageRate == null ? "—" : `${classAverageRate}%`}
            tone="present"
          />
        </div>

        <div className="grid items-stretch gap-8 lg:grid-cols-2">
          <div className="card flex h-full flex-col gap-4 p-6 md:p-8">
            <div>
              <h2 className="font-display text-2xl font-bold">Master Classlist</h2>
              <p className="text-sm text-muted">
                Import official student IDs and names from a CSV or Excel spreadsheet. Only listed students can enroll.
              </p>
            </div>
            <label
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files[0];
                if (file) parseRosterFile(file);
              }}
              className={`flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed p-7 text-center transition ${
                dragging ? "border-gold bg-gold-soft" : "border-line hover:border-gold"
              }`}
            >
              <FileSpreadsheet size={28} className="text-gold-text" />
              <span className="mt-3 font-semibold">Drop a roster spreadsheet here</span>
              <span className="mt-1 text-xs text-muted">or browse for a .CSV or .XLSX file</span>
              <input
                type="file"
                accept=".csv,.xlsx"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) parseRosterFile(file);
                  event.target.value = "";
                }}
              />
            </label>
            {fileError && <p role="alert" className="text-sm text-absent">{fileError}</p>}
            {preview && (
              <div className="rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {preview.rows.length} valid row(s) · {preview.rows.filter((row) => row.duplicate).length} duplicate(s)
                    {preview.invalid ? ` · ${preview.invalid} invalid row(s)` : ""}
                  </p>
                  <button
                    onClick={saveList}
                    disabled={saving || preview.rows.every((row) => row.duplicate)}
                    className="btn btn-gold"
                  >
                    {saving && <Loader2 size={16} className="animate-spin" />}
                    Import Roster to Database
                  </button>
                </div>
                <div className="mt-3 max-h-52 overflow-auto rounded-xl border border-line">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-surface-strong text-muted">
                      <tr><th className="px-3 py-2">Student ID</th><th className="px-3 py-2">Full name</th><th className="px-3 py-2">Import status</th></tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, index) => (
                        <tr key={`${row.student_id_number}-${index}`} className="border-t border-line">
                          <td className="px-3 py-2 font-mono">{row.student_id_number}</td>
                          <td className="px-3 py-2 capitalize">{row.full_name}</td>
                          <td className={`px-3 py-2 ${row.duplicate ? "text-gold-text" : "text-present"}`}>
                            {row.duplicate ? "Duplicate — skip" : "Ready"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-2 max-h-96 overflow-auto rounded-xl border border-line">
              {data.classlist.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">No students on the classlist yet.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-surface-strong text-xs uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-4 py-3">Student ID</th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Account</th>
                      <th className="px-2 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.classlist.map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="px-4 py-2.5 font-mono text-xs">{r.student_id_number}</td>
                        <td className="px-4 py-2.5 capitalize">{r.full_name}</td>
                        <td className="px-4 py-2.5">
                          {r.enrolled ? (
                            <span className="chip bg-present-soft text-present">Enrolled</span>
                          ) : (
                            <span className="chip bg-none-soft text-muted">Not yet</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <button onClick={() => removeRow(r)} className="rounded-lg p-1.5 text-muted hover:text-absent" aria-label={`Remove ${r.full_name}`}>
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="flex h-full flex-col justify-between gap-8">
            <div className="card p-6 md:p-8">
              <h2 className="font-display text-2xl font-bold">Sessions</h2>
              {data.sessions.length === 0 ? (
                <div className="mt-5">
                  <Empty icon={ScanLine} title="No sessions yet">
                    Start today's session to show the QR code to the class.
                  </Empty>
                </div>
              ) : (
                <ul className="mt-5 flex max-h-80 flex-col gap-2 overflow-auto pr-1">
                  {data.sessions.map((s) => (
                    <li key={s.id}>
                      <Link
                        to={`/sessions/${s.id}`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-strong px-4 py-3 transition hover:border-gold hover:bg-accent-soft hover:shadow-card"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold tabular-nums">
                            {prettyDate(s.session_date)} · {prettyTime(s.started_at)}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <span className="chip bg-present-soft px-2 text-present">P {s.present}</span>
                            <span className="chip bg-late-soft px-2 text-late">L {s.late}</span>
                            <span className="chip bg-excused-soft px-2 text-excused">E {s.excused}</span>
                            <span className="chip bg-absent-soft px-2 text-absent">A {s.absent}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {s.is_active ? (
                            <span className="chip bg-present-soft text-present">
                              <Radio size={12} /> Live
                            </span>
                          ) : (
                            <span className="chip bg-none-soft text-muted">Ended</span>
                          )}
                          <ArrowRight size={16} className="text-muted" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {analytics && (
              <HonorRoll
                students={analytics.perfect_attendance}
                showSubject={false}
                completed={analytics.completed_sessions}
              />
            )}
          </div>
        </div>

        {analytics && analytics.students.length > 0 && (
          <div className="card overflow-hidden">
            <div className="p-6 pb-0 md:p-8 md:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl font-bold">Attendance rates</h2>
                  <p className="text-sm text-muted">Based on {analytics.completed_sessions} completed session(s).</p>
                </div>
                <button className="btn btn-ghost" onClick={() => setShowRiskOnly((value) => !value)}>
                  {showRiskOnly ? "Show All" : "At-Risk Only"}
                </button>
              </div>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-strong text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-6 py-3">Student</th>
                    <th className="px-6 py-3 text-present">Present</th>
                    <th className="px-6 py-3 text-late">Late</th>
                    <th className="px-6 py-3 text-excused">Excused</th>
                    <th className="px-6 py-3 text-absent">Absent</th>
                    <th className="px-6 py-3">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.students.filter((student) => !showRiskOnly || student.risk !== "safe").map((s) => (
                    <tr key={s.student_user_id} className="border-t border-line">
                      <td className="px-6 py-3">
                        <p className="font-semibold capitalize">{s.full_name}</p>
                        <p className="font-mono text-xs text-muted">{s.student_id_number}</p>
                        {s.risk !== "safe" && (
                          <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${
                            s.risk === "at_risk" ? "bg-absent-soft text-absent" : "bg-gold-soft text-gold-text"
                          }`}>
                            ⚠️ {s.risk === "at_risk" && s.rate != null && s.rate < 75
                              ? "At Risk (< 75%)"
                              : s.consecutive_absences >= 2
                                ? `${s.consecutive_absences} Consecutive Absences`
                                : s.risk_reason || "Attendance warning"}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 font-semibold tabular-nums text-present">{s.present}</td>
                      <td className="px-6 py-3 font-semibold tabular-nums text-late">{s.late}</td>
                      <td className="px-6 py-3 font-semibold tabular-nums text-excused">{s.excused}</td>
                      <td className="px-6 py-3 font-semibold tabular-nums text-absent">{s.absent}</td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-28 overflow-hidden rounded-full bg-none-soft">
                            <div className="h-full rounded-full bg-gold" style={{ width: `${s.rate ?? 0}%` }} />
                          </div>
                          <span className="text-xs font-semibold tabular-nums">{s.rate == null ? "—" : `${s.rate}%`}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <AttendanceCalendar classId={id} role="instructor" title="Class calendar" />
      </div>
    </>
  );
}

function StudentClass({ id }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [excuseDrafts, setExcuseDrafts] = useState({});
  const [uploading, setUploading] = useState({});

  useEffect(() => {
    api(`/classes/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!data || window.location.hash !== "#excuse-requests") return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("excuse-requests")?.scrollIntoView({ behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Spinner />;
  const { class: cls, stats } = data;
  const total = Number(stats.total_sessions);
  const standing = data.standing;
  const eligibleExcuses = data.attendance.filter(
    (entry) => entry.status === "Absent" && !entry.is_active && !entry.excuse_id,
  ).length;
  const absencesUntilThreshold = total
    ? Math.max(0, Math.floor(Number(stats.present) / 0.75 - total) + 1)
    : null;

  const submitExcuse = async (sessionId) => {
    const form = excuseDrafts[sessionId];
    if (!form?.reason?.trim() || !form?.file) {
      toast("Add a reason and attach an excuse document.", "error");
      return;
    }
    setUploading((current) => ({ ...current, [sessionId]: true }));
    try {
      const payload = new FormData();
      payload.append("reason", form.reason);
      payload.append("document", form.file);
      await api(`/sessions/${sessionId}/excuses`, { method: "POST", body: payload });
      toast("Excuse request submitted");
      setExcuseDrafts((current) => ({ ...current, [sessionId]: { reason: "", file: null } }));
      const refreshed = await api(`/classes/${id}`);
      setData(refreshed);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setUploading((current) => ({ ...current, [sessionId]: false }));
    }
  };

  return (
    <>
      <BackLink />
      <PageHeader
        eyebrow={<>{cls.section} · <span className="capitalize">{cls.instructor_name}</span></>}
        title={<span className="capitalize">{cls.subject}</span>}
        subtitle={cls.schedule || undefined}
      >
        {eligibleExcuses > 0 && (
          <Link to={`/classes/${id}#excuse-requests`} className="btn btn-gold">
            <FileText size={16} /> Request absence excuse ({eligibleExcuses})
          </Link>
        )}
        {cls.active_session_id && (
          <Link to="/scan" className="btn btn-gold">
            <Radio size={16} /> Session live — scan the QR
          </Link>
        )}
      </PageHeader>
      <div className="flex flex-col gap-8">
        <div className={`card p-6 md:p-8 ${standing.risk === "at_risk" ? "border-absent" : standing.risk === "warning" ? "border-gold" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Academic standing</p>
              <h2 className="mt-2 font-display text-2xl font-bold">
                {standing.risk === "at_risk" ? "At risk" : standing.risk === "warning" ? "Warning" : "On track"}
              </h2>
              <p className="mt-2 text-sm text-muted">
                {standing.risk_reason
                  ? standing.risk === "at_risk"
                    ? `${standing.risk_reason} in ${cls.subject}.`
                    : `Warning: ${standing.risk_reason} in ${cls.subject}. You are ${absencesUntilThreshold} absence${absencesUntilThreshold === 1 ? "" : "s"} away from falling below 75%.`
                  : standing.rate == null
                    ? "Attendance standing will appear after a class session is completed."
                    : `You are ${absencesUntilThreshold} absence${absencesUntilThreshold === 1 ? "" : "s"} away from falling below the 75% threshold in ${cls.subject}.`}
              </p>
            </div>
            <span className={`chip tabular-nums ${standing.risk === "at_risk" ? "bg-absent-soft text-absent" : standing.risk === "warning" ? "bg-gold-soft text-gold-text" : "bg-present-soft text-present"}`}>
              {standing.rate == null ? "No completed sessions" : `${standing.rate}% attendance`}
              {standing.consecutive_absences ? ` · ${standing.consecutive_absences} consecutive absence(s)` : ""}
            </span>
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard icon={CheckCircle2} label="Present" value={stats.present} tone="present" />
          <StatCard icon={CheckCircle2} label="Late" value={stats.late} tone="late" />
          <StatCard icon={CheckCircle2} label="Excused" value={stats.excused} tone="excused" />
          <StatCard icon={XCircle} label="Absent" value={stats.absent} tone="absent" />
          <StatCard
            icon={Percent}
            label="Attendance rate"
            value={standing.rate == null ? "—" : `${standing.rate}%`}
            tone="gold"
          />
        </div>
        <div id="excuse-requests" className="card scroll-mt-24 p-6 md:p-8">
          <h2 className="font-display text-2xl font-bold">Excuse requests</h2>
          <p className="mt-1 text-sm text-muted">
            You can request an excuse for a completed session marked Absent. Include a reason and a PDF, JPG, or PNG document.
          </p>
          {data.attendance.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
              There are no completed session records to request an excuse for.
            </p>
          ) : (
            <ul className="mt-5 flex flex-col gap-4">
              {data.attendance.map((entry) => (
                <li key={entry.session_id} className="rounded-2xl border border-line bg-surface-strong p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold tabular-nums">
                        {prettyDate(entry.session_date)} · {prettyTime(entry.started_at)}
                      </p>
                      <p className={`text-xs ${
                        entry.status === "Present" ? "text-present"
                          : entry.status === "Late" ? "text-late"
                            : entry.status === "Excused" ? "text-excused"
                              : "text-absent"
                      }`}>{entry.status || "Pending"}</p>
                    </div>
                    {entry.excuse_status && (
                      <span className={`chip ${
                        entry.excuse_status === "Approved" ? "bg-excused-soft text-excused"
                          : entry.excuse_status === "Rejected" ? "bg-absent-soft text-absent"
                            : "bg-gold-soft text-gold-text"
                      }`}>{entry.excuse_status} excuse</span>
                    )}
                  </div>
                  {entry.status === "Absent" && !entry.is_active && !entry.excuse_id && (
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                      <textarea
                        className="field min-h-20 text-sm"
                        placeholder="Reason for absence"
                        value={excuseDrafts[entry.session_id]?.reason ?? ""}
                        onChange={(event) => setExcuseDrafts((current) => ({
                          ...current,
                          [entry.session_id]: { ...current[entry.session_id], reason: event.target.value },
                        }))}
                      />
                      <input
                        className="field text-sm"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(event) => setExcuseDrafts((current) => ({
                          ...current,
                          [entry.session_id]: { ...current[entry.session_id], file: event.target.files?.[0] },
                        }))}
                      />
                      <button
                        type="button"
                        className="btn btn-gold self-start"
                        onClick={() => submitExcuse(entry.session_id)}
                        disabled={uploading[entry.session_id]}
                      >
                        {uploading[entry.session_id] && <Loader2 size={16} className="animate-spin" />}
                        Submit excuse
                      </button>
                    </div>
                  )}
                  {entry.excuse_id && (
                    <a className="mt-2 inline-flex text-xs font-semibold text-gold-text hover:underline"
                      href={`/api/excuses/${entry.excuse_id}/document`} target="_blank" rel="noreferrer">
                      View submitted document
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <AttendanceCalendar classId={id} role="student" title="My attendance" />
      </div>
    </>
  );
}

export default function ClassPage() {
  const { id } = useParams();
  const { user } = useAuth();
  return user.role === "instructor" ? <InstructorClass id={id} /> : <StudentClass id={id} />;
}
