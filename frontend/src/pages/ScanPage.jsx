import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Camera, CheckCircle2, Loader2, RefreshCw, Smartphone, Square, Volume2, XCircle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { PageHeader } from "../components/ui";

export default function ScanPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const secret = params.get("s");
  const [state, setState] = useState(secret ? "loading" : "idle");
  const [result, setResult] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState("rear");
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const sent = useRef(false);
  const audioContextRef = useRef(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundError, setSoundError] = useState("");

  function playTone(context) {
    const now = context.currentTime;
    [520, 1040].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.13;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.12);
    });
  }

  async function enableSound() {
    setSoundError("");
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setSoundError("This browser does not support audio feedback.");
      return false;
    }
    try {
      if (!audioContextRef.current || audioContextRef.current.state === "closed") {
        audioContextRef.current = new AudioContextClass();
      }
      await audioContextRef.current.resume();
      if (audioContextRef.current.state !== "running") {
        setSoundError("Sound is blocked by your browser. Check the tab's sound permission and try again.");
        return false;
      }
      setSoundEnabled(true);
      return true;
    } catch {
      setSoundError("Could not enable sound. Check your browser and device sound settings.");
      return false;
    }
  }

  function playConfirmationFeedback() {
    const context = audioContextRef.current;
    if (context?.state === "running") playTone(context);
    try {
      navigator.vibrate?.([80, 40, 80]);
    } catch {
      // Vibration is not supported on every device.
    }
  }

  async function submitCheckIn(qrSecret) {
    return api("/scan", { method: "POST", body: { secret: qrSecret } });
  }

  function stopCamera() {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  function checkIn(qrSecret) {
    if (sent.current) return;
    sent.current = true;
    stopCamera();
    setState("loading");
    submitCheckIn(qrSecret)
      .then((r) => {
        setResult(r);
        setState("ok");
        playConfirmationFeedback();
      })
      .catch((e) => {
        setResult({ error: e.message });
        setState("error");
      });
  }

  useEffect(() => {
    if (!secret || sent.current || user.role !== "student") return;
    sent.current = true;
    submitCheckIn(secret)
      .then((r) => {
        setResult(r);
        setState("ok");
        playConfirmationFeedback();
      })
      .catch((e) => {
        setResult({ error: e.message });
        setState("error");
      });
  }, [secret, user.role]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
    },
    [],
  );

  async function startCamera(facing = cameraFacing) {
    setCameraError("");
    if (!window.isSecureContext) {
      setCameraError("Camera access requires a secure connection (HTTPS), or localhost on this device.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser does not support camera access. Try a current version of Chrome or Safari.");
      return;
    }
    if (!("BarcodeDetector" in window)) {
      setCameraError("QR scanning is not supported by this browser. Try a current version of Chrome on Android.");
      return;
    }

    try {
      await enableSound();
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing === "rear" ? "environment" : "user" } },
      });
      streamRef.current = stream;
      setCameraActive(true);
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      let lastDetection = 0;
      const scanFrame = async () => {
        if (!videoRef.current || sent.current) return;
        const now = performance.now();
        if (now - lastDetection < 200) {
          frameRef.current = requestAnimationFrame(scanFrame);
          return;
        }
        lastDetection = now;
        try {
          const codes = await detector.detect(videoRef.current);
          const value = codes[0]?.rawValue;
          if (value) {
            let qrSecret = null;
            try {
              const qrUrl = new URL(value, window.location.origin);
              if (qrUrl.origin === window.location.origin && qrUrl.pathname === "/scan") {
                qrSecret = qrUrl.searchParams.get("s");
              }
            } catch {
              // Ignore unrelated QR contents and keep scanning.
            }
            if (qrSecret) {
              checkIn(qrSecret);
              return;
            }
          }
        } catch {
          stopCamera();
          setCameraError("The camera could not read the QR code. Try again or use your phone's camera app.");
          return;
        }
        frameRef.current = requestAnimationFrame(scanFrame);
      };

      frameRef.current = requestAnimationFrame(scanFrame);
    } catch (error) {
      stopCamera();
      setCameraError(
        error.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in your browser settings and try again."
          : "Unable to start the camera. Check that it is not being used by another app, then try again.",
      );
    }
  }

  if (user.role !== "student") {
    return <PageHeader eyebrow="Scan" title="Students only" subtitle="Open a live session from your class page to show the QR code." />;
  }

  if (state === "loading")
    return (
      <div className="card mx-auto mt-10 flex max-w-md flex-col items-center p-10 text-center">
        <Loader2 size={36} className="animate-spin text-gold-text" />
        <p className="mt-4 font-display text-2xl font-bold">Checking you in…</p>
      </div>
    );

  if (state === "ok")
    return (
      <div className="card mx-auto mt-10 flex max-w-md animate-rise flex-col items-center p-10 text-center">
        <div className={`grid h-20 w-20 place-items-center rounded-full ${
          result.status === "Late"
            ? "bg-late-soft text-late"
            : result.status === "Excused"
              ? "bg-excused-soft text-excused"
              : result.status === "Absent"
                ? "bg-absent-soft text-absent"
                : "bg-present-soft text-present"
        }`}>
          <CheckCircle2 size={40} />
        </div>
        <p className="eyebrow mt-6">{result.already ? "Already recorded" : "You're in"}</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Marked {result.status}</h1>
        <p
          role="status"
          className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${
            result.status === "Late"
              ? "border-late/30 bg-late-soft text-late"
              : result.status === "Present"
                ? "border-present/30 bg-present-soft text-present"
                : result.status === "Excused"
                  ? "border-excused/30 bg-excused-soft text-excused"
                  : "border-absent/30 bg-absent-soft text-absent"
          }`}
        >
          {result.already
            ? `Your attendance is already recorded as ${result.status}.`
            : result.status === "Late"
              ? "The 15-minute grace period has ended. This scan was recorded as Late."
              : "This scan was within the 15-minute grace period and was recorded as Present."}
        </p>
        <p className="mt-2 text-muted">
          {result.subject} {result.marked_at ? `· ${new Date(result.marked_at.replace(" ", "T")).toLocaleString()}` : ""}
        </p>
        {!soundEnabled && (
          <div className="mt-5 text-center">
            <button type="button" className="btn btn-ghost" onClick={async () => {
              if (await enableSound()) playTone(audioContextRef.current);
            }}>
              <Volume2 size={16} /> Enable sound & test chime
            </button>
            <p className="mt-2 text-xs text-muted">
              Browsers may block sound when you open a QR link directly. Tap to enable it for this visit.
            </p>
            {soundError && <p role="alert" className="mt-2 text-xs text-absent">{soundError}</p>}
          </div>
        )}
        <Link to="/dashboard" className="btn btn-gold mt-8">
          Back to dashboard
        </Link>
      </div>
    );

  if (state === "error")
    return (
      <div className="card mx-auto mt-10 flex max-w-md animate-rise flex-col items-center p-10 text-center">
        <div className="grid h-20 w-20 place-items-center rounded-full bg-absent-soft text-absent">
          <XCircle size={40} />
        </div>
        <h1 className="mt-6 font-display text-3xl font-bold">Couldn't check in</h1>
        <p className="mt-3 text-muted">{result.error}</p>
        <Link to="/dashboard" className="btn btn-ghost mt-8">
          Back to dashboard
        </Link>
      </div>
    );

  return (
    <>
      <PageHeader eyebrow="QR check-in" title="Scan the class QR" subtitle="Use your device camera to scan the live code shown by your instructor." />
      <div className="card mx-auto max-w-xl p-5 sm:p-7">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-black">
          {!cameraActive && (
            <div className="absolute inset-0 grid place-items-center bg-accent-soft text-gold-text">
              <div className="text-center">
                <Camera size={42} className="mx-auto" />
                <p className="mt-3 font-semibold">Camera scanner ready</p>
              </div>
            </div>
          )}
          <div className="pointer-events-none absolute inset-5 z-10" aria-hidden="true">
            <span className="absolute left-0 top-0 h-8 w-8 rounded-tl-lg border-l-4 border-t-4 border-gold" />
            <span className="absolute right-0 top-0 h-8 w-8 rounded-tr-lg border-r-4 border-t-4 border-gold" />
            <span className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-lg border-b-4 border-l-4 border-gold" />
            <span className="absolute bottom-0 right-0 h-8 w-8 rounded-br-lg border-b-4 border-r-4 border-gold" />
          </div>
          <video
            ref={videoRef}
            className={cameraActive
              ? `h-full w-full object-cover ${cameraFacing === "front" ? "[transform:scaleX(-1)]" : ""}`
              : "absolute h-px w-px opacity-0"}
            autoPlay
            muted
            playsInline
            aria-label="Camera preview for QR scanning"
          />
        </div>
        <p className="mt-4 text-sm text-muted">
          Allow camera access, then point the rear camera at your instructor's QR code.
        </p>
        {cameraError && (
          <p role="alert" className="mt-3 rounded-xl border border-absent bg-absent-soft px-4 py-3 text-sm text-absent">
            {cameraError}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              const nextFacing = cameraFacing === "rear" ? "front" : "rear";
              setCameraFacing(nextFacing);
              if (cameraActive) {
                stopCamera();
                startCamera(nextFacing);
              }
            }}
            className="btn btn-ghost"
            aria-label={`Switch to ${cameraFacing === "rear" ? "front" : "rear"} camera`}
          >
            <RefreshCw size={16} /> {cameraFacing === "rear" ? "Front camera" : "Rear camera"}
          </button>
          {cameraActive ? (
            <button type="button" onClick={stopCamera} className="btn btn-ghost">
              <Square size={16} /> Stop camera
            </button>
          ) : (
            <button type="button" onClick={startCamera} className="btn btn-gold">
              <Camera size={16} /> Start camera
            </button>
          )}
        </div>
      </div>
      <div className="mt-6 flex items-start gap-3 text-sm text-muted">
        <Smartphone size={18} className="mt-0.5 shrink-0" />
        <p>
          If camera access is unavailable, scan the code with your phone's camera app and open the AttendTrack link.
          For in-app scanning from another device, the site must be opened over HTTPS.
        </p>
      </div>
    </>
  );
}
