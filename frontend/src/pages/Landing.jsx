import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarDays, Loader2, QrCode, ScanSearch, ShieldCheck, Star } from "lucide-react";
import Brand from "../components/Brand";
import ThemeToggle from "../components/ThemeToggle";
import { ErrorBox } from "../components/ui";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import hero from "../assets/hero.jpg";

const features = [
  { icon: QrCode, title: "QR check-in", text: "Students scan the live session code. No paper, no proxy signing." },
  { icon: ShieldCheck, title: "Classlist verified", text: "Only students on the official master list can enroll." },
  { icon: CalendarDays, title: "Calendar records", text: "Month and week views of every Present and Absent." },
  { icon: Star, title: "Perfect attendance", text: "An honor roll for students with a 100% record." },
];

function AuthCard() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("student");
  const [form, setForm] = useState({ full_name: "", username: "", student_id_number: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await api("/login", { method: "POST", body: { username: form.username, password: form.password } });
      } else {
        await api("/signup", {
          method: "POST",
          body: {
            role,
            full_name: form.full_name,
            username: form.username,
            student_id_number: role === "student" ? form.student_id_number : null,
            password: form.password,
          },
        });
      }
      await refresh();
      navigate(params.get("next") || "/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card w-full animate-rise p-8 md:p-10" style={{ animationDelay: "120ms" }}>
      <h2 className="font-display text-4xl font-bold">Welcome</h2>
      <p className="mt-1 text-muted">Sign in or create your AttendTrack account.</p>

      <div className="mt-8 grid grid-cols-2 gap-2" role="tablist">
        {[
          ["login", "Login"],
          ["signup", "Sign Up"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => {
              setMode(key);
              setError("");
            }}
            className={`rounded-md py-3 text-lg font-medium transition ${
              mode === key ? "bg-gold text-gold-ink" : "text-ink hover:bg-accent-soft"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-7 flex flex-col gap-4">
        {mode === "signup" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["student", "Student"],
                ["instructor", "Instructor"],
              ].map(([key, label]) => (
                <label
                  key={key}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-surface-strong px-5 py-4 transition ${
                    role === key ? "border-gold" : "border-line hover:border-accent"
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={key}
                    checked={role === key}
                    onChange={() => setRole(key)}
                    className="h-4 w-4 accent-gold"
                  />
                  <span className="font-medium">{label}</span>
                </label>
              ))}
            </div>
            <label className="sr-only" htmlFor="full_name">Full name</label>
            <input id="full_name" className="field" placeholder="Full name" value={form.full_name} onChange={set("full_name")} required />
          </>
        )}

        <label className="sr-only" htmlFor="username">Username</label>
        <input
          id="username"
          className="field"
          placeholder={mode === "login" ? "Username or Student ID" : "Username or email"}
          value={form.username}
          onChange={set("username")}
          autoComplete="username"
          required
        />

        {mode === "signup" && role === "student" && (
          <>
            <label className="sr-only" htmlFor="sid">Student ID number</label>
            <input
              id="sid"
              className="field"
              placeholder="Student ID number (e.g. 2024-00898)"
              value={form.student_id_number}
              onChange={set("student_id_number")}
              required
            />
          </>
        )}

        <label className="sr-only" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          className="field"
          placeholder="Password"
          value={form.password}
          onChange={set("password")}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={mode === "signup" ? 6 : undefined}
        />

        <ErrorBox>{error}</ErrorBox>

        <button type="submit" disabled={busy} className="btn btn-gold mt-3 py-4 text-lg">
          {busy && <Loader2 size={18} className="animate-spin" />}
          {mode === "login" ? "Login" : "Create Account"}
        </button>
      </form>
    </div>
  );
}

export default function Landing() {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  if (!loading && user) return <Navigate to={params.get("next") || "/dashboard"} replace />;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-5 md:px-10 lg:px-[8%]">
        <header className="flex items-center justify-between gap-4 py-6">
          <Brand />
          <ThemeToggle />
        </header>

        <section className="grid items-center gap-12 pb-16 pt-8 lg:grid-cols-[1.35fr_1fr] lg:gap-20">
          <div className="animate-rise">
            <p className="eyebrow">AttendTrack</p>
            <h1 className="mt-6 font-display text-5xl font-extrabold leading-[1.02] tracking-tight md:text-6xl xl:text-7xl">
              Attendance signed by presence, <span className="text-gold-text">not by pen.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted md:text-xl">
              The classroom attendance system for BSIT 3G. Scan in, get verified against the official classlist, and
              see every record on a calendar.
            </p>
            <div className="relative mt-10 overflow-hidden rounded-[1.75rem] border border-line shadow-card">
              <img src={hero} alt="A BSIT student scanning the class QR code on the projector" width={1600} height={1008} className="aspect-[16/10] w-full object-cover" />
              <div className="absolute left-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-surface-strong text-accent">
                <ScanSearch size={20} />
              </div>
            </div>
          </div>

          <AuthCard />
        </section>

        <section className="grid gap-6 pb-20 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, text }, i) => (
            <div key={title} className="card animate-rise p-8" style={{ animationDelay: `${200 + i * 80}ms` }}>
              <div className="icon-tile">
                <Icon size={20} />
              </div>
              <h3 className="mt-8 font-display text-2xl font-bold">{title}</h3>
              <p className="mt-3 text-lg leading-relaxed text-muted">{text}</p>
            </div>
          ))}
        </section>
      </div>

      <footer className="border-t border-line py-8 text-center text-muted">
        North Eastern Mindanao State University · Cantilan Campus · BSIT 3G
      </footer>
    </div>
  );
}
