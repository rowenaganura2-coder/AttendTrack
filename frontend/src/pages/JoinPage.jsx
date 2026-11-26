import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BookOpen, CheckCircle2, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { ErrorBox, PageHeader } from "../components/ui";

export default function JoinPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const code = (params.get("code") || "").toUpperCase();
  const [input, setInput] = useState(code);
  const [cls, setCls] = useState(null);
  const [lookupError, setLookupError] = useState("");
  const [enrollError, setEnrollError] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setCls(null);
    setLookupError("");
    setEnrollError("");
    if (!code || code.length !== 6) {
      setLookupBusy(false);
      return () => {
        active = false;
      };
    }
    setLookupBusy(true);
    api(`/classes/lookup?code=${encodeURIComponent(code)}`)
      .then((result) => active && setCls(result))
      .catch((e) => active && setLookupError(e.message))
      .finally(() => active && setLookupBusy(false));
    return () => {
      active = false;
    };
  }, [code]);

  const enroll = async () => {
    setBusy(true);
    setEnrollError("");
    try {
      const r = await api("/enroll", { method: "POST", body: { code: cls.class_code } });
      toast(`You're enrolled in ${r.subject}`);
      navigate(`/classes/${r.class_id}`);
    } catch (e) {
      setEnrollError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (user.role !== "student") {
    return (
      <>
        <PageHeader eyebrow="Join a class" title="Students only" subtitle="Instructors share this link with students — it's how they enroll." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Join a class"
        title="Enter your class code"
        subtitle="Your instructor shares a 6-character code or an invite link. You must be on the official classlist."
      />
      <form
        className="card flex max-w-xl flex-col gap-4 p-6 sm:flex-row md:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          const value = input.trim().toUpperCase();
          if (value.length === 6) {
            setParams({ code: value });
          } else {
            setLookupError("Enter the full 6-character class code.");
          }
        }}
      >
        <input
          className="field font-mono uppercase tracking-[0.3em]"
          placeholder="IT3G01"
          maxLength={6}
          value={input}
          onChange={(e) => {
            const value = e.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();
            setInput(value);
            setCls(null);
            setLookupError("");
            setEnrollError("");
            if (value.length === 6) setParams({ code: value });
            else if (code) setParams({});
          }}
        />
        <button className="btn btn-gold shrink-0">
          <KeyRound size={16} /> Look up
        </button>
      </form>
      <div className="mt-4 max-w-xl">
        <ErrorBox>{lookupError}</ErrorBox>
      </div>

      {lookupBusy && (
        <div className="card mt-5 flex max-w-xl items-center gap-3 p-5 text-sm text-muted" role="status">
          <Loader2 size={18} className="animate-spin" /> Looking up class…
        </div>
      )}

      {cls && (
        <section className="card mt-5 max-w-xl animate-rise p-6 md:p-8" aria-labelledby="join-title">
          <div className="icon-tile bg-gold-soft text-gold-text">
            <BookOpen size={20} />
          </div>
          <p className="eyebrow mt-5">Class preview</p>
          <h2 id="join-title" className="mt-2 font-display text-3xl font-bold capitalize">{cls.subject}</h2>
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Instructor</dt>
            <dd className="font-semibold capitalize">{cls.instructor_name}</dd>
            <dt className="text-muted">Section</dt>
            <dd className="font-semibold">{cls.section}</dd>
            <dt className="text-muted">Schedule</dt>
            <dd className="font-semibold">{cls.schedule || "—"}</dd>
            <dt className="text-muted">Your ID</dt>
            <dd className="font-mono font-semibold">{user.student_id_number}</dd>
          </dl>

          {enrollError && (
            <div className="mt-6 flex gap-3 rounded-xl border border-absent bg-absent-soft p-4 text-sm font-medium text-absent">
              <ShieldAlert size={18} className="shrink-0" />
              <span>{enrollError}</span>
            </div>
          )}

          {cls.already_enrolled ? (
            <button onClick={() => navigate(`/classes/${cls.id}`)} className="btn btn-gold mt-8 w-full py-3.5">
              <CheckCircle2 size={18} /> Already enrolled — open class
            </button>
          ) : (
            <button onClick={enroll} disabled={busy} className="btn btn-gold mt-8 w-full py-3.5">
              {busy && <Loader2 size={16} className="animate-spin" />} Confirm enrollment
            </button>
          )}
        </section>
      )}
    </>
  );
}
