import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import AttendanceCalendar from "../components/AttendanceCalendar";
import { Empty, ErrorBox, PageHeader, Spinner } from "../components/ui";

export default function CalendarPage() {
  const { user } = useAuth();
  const [classes, setClasses] = useState(null);
  const [classId, setClassId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/classes")
      .then((d) => {
        setClasses(d.classes);
        if (d.classes.length) setClassId(String(d.classes[0].id));
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Attendance matrix"
        title="Calendar"
        subtitle={
          user.role === "student"
            ? "Green is Present, amber is Late, cyan is Excused, rose is Absent, and grey means no class."
            : "Daily Present / Absent tallies for each class."
        }
      >
        {classes?.length > 0 && (
          <select className="field-sm py-2.5 text-sm" value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Choose class">
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subject}
              </option>
            ))}
          </select>
        )}
      </PageHeader>
      <ErrorBox>{error}</ErrorBox>
      {!classes ? (
        !error && <Spinner />
      ) : classes.length === 0 ? (
        <Empty icon={CalendarDays} title="No classes yet">
          {user.role === "student" ? "Join a class first to see your attendance." : "Create a class from the dashboard."}
        </Empty>
      ) : (
        <AttendanceCalendar key={classId} classId={classId} role={user.role} title={classes.find((c) => String(c.id) === classId)?.subject} />
      )}
    </>
  );
}
