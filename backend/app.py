"""AttendTrack — BSIT 3G, North Eastern Mindanao State University (Cantilan Campus).

Run from this folder:  python app.py   (serves the website and API on port 5000)
Build the frontend once with npm before running the app.
Database settings can be changed with the environment variables
DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME and SECRET_KEY.
"""
import os
import random
import secrets
import string
import threading
from datetime import date, datetime, timedelta
from decimal import Decimal
from functools import wraps
from pathlib import Path

import pymysql
from flask import Flask, jsonify, request, send_file, send_from_directory, session
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
def _json_default(o):
    if isinstance(o, datetime):
        return o.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(o, date):
        return o.isoformat()
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


class JSONProvider(DefaultJSONProvider):
    default = staticmethod(_json_default)


app = Flask(__name__)
app.json = JSONProvider(app)
app.secret_key = os.environ.get("SECRET_KEY", "change-this-attendtrack-3g-secret")
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
IS_PROD = os.environ.get("RENDER") is not None or os.environ.get("DB_HOST", "localhost") != "localhost"

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=IS_PROD,
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    MAX_CONTENT_LENGTH=10 * 1024 * 1024,
)
CORS(app, supports_credentials=True)

DB = dict(
    host=os.environ.get("DB_HOST", "localhost"),
    port=int(os.environ.get("DB_PORT", "3306")),
    user=os.environ.get("DB_USER", "root"),
    password=os.environ.get("DB_PASSWORD", ""),
    database=os.environ.get("DB_NAME", "attendtrack1"),
    charset="utf8mb4",
    cursorclass=pymysql.cursors.DictCursor,
    autocommit=True,
)
if os.environ.get("DB_SSL", "true").lower() == "true" and DB["host"] != "localhost":
    DB["ssl"] = {"ssl_mode": "PREFERRED"}

NOT_IN_CLASSLIST = "Not in the classlist. You are not officially listed in this class roster."


def serve_frontend(path=""):
    if path == "api" or path.startswith("api/"):
        return err("Not found.", 404)

    if not (FRONTEND_DIST / "index.html").is_file():
        return (
            "Frontend build not found. Build it once from the frontend folder with "
            "`npm install` and `npm run build`, then run this app again.",
            503,
        )

    if path and (FRONTEND_DIST / path).is_file():
        return send_from_directory(FRONTEND_DIST, path)
    return send_from_directory(FRONTEND_DIST, "index.html")


@app.get("/")
def frontend_home():
    return serve_frontend()


@app.get("/<path:path>")
def frontend_path(path):
    return serve_frontend(path)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def db():
    return pymysql.connect(**DB)


def query(sql, args=(), one=False):
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            rows = cur.fetchall()
            if one:
                return rows[0] if rows else None
            return list(rows)
    finally:
        conn.close()


def execute(sql, args=()):
    conn = db()
    try:
        with conn.cursor() as cur:
            affected = cur.execute(sql, args)
            return affected, cur.lastrowid
    finally:
        conn.close()


def err(message, status=400):
    return jsonify(error=message), status


def body():
    return request.get_json(silent=True) or {}


def uid():
    return session.get("user_id")


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not uid():
            return err("Please log in first.", 401)
        return fn(*args, **kwargs)

    return wrapper


def role_required(role):
    def decorator(fn):
        @wraps(fn)
        @login_required
        def wrapper(*args, **kwargs):
            if session.get("role") != role:
                return err(f"Only {role}s can do this.", 403)
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def owned_class(cid):
    return query(
        "SELECT * FROM classes WHERE id=%s AND instructor_id=%s", (cid, uid()), one=True
    )


def is_enrolled(cid, student_id):
    return bool(
        query(
            "SELECT 1 FROM enrollments WHERE class_id=%s AND student_user_id=%s",
            (cid, student_id),
            one=True,
        )
    )


def new_class_code():
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choice(alphabet) for _ in range(6))
        if not query("SELECT 1 FROM classes WHERE class_code=%s", (code,), one=True):
            return code


def new_qr_secret():
    return secrets.token_hex(16)  # 32 hex characters


def normalized_student_id(value):
    return "".join(character for character in str(value or "") if character.isalnum()).casefold()


_schema_extension_lock = threading.Lock()
_schema_extensions_ready = False


def ensure_schema_extensions():
    global _schema_extensions_ready
    if _schema_extensions_ready:
        return
    with _schema_extension_lock:
        if _schema_extensions_ready:
            return
        conn = db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                       WHERE TABLE_SCHEMA=%s AND TABLE_NAME='classes'""",
                    (DB["database"],),
                )
                columns = {row["COLUMN_NAME"] for row in cur.fetchall()}
                for name in ("geofence_enabled", "geofence_lat", "geofence_lon", "geofence_radius_m"):
                    if name in columns:
                        cur.execute(f"ALTER TABLE classes DROP COLUMN `{name}`")
                cur.execute(
                    """SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                       WHERE TABLE_SCHEMA=%s AND TABLE_NAME='sessions'""",
                    (DB["database"],),
                )
                session_columns = {row["COLUMN_NAME"] for row in cur.fetchall()}
                if "qr_issued_at" not in session_columns:
                    cur.execute(
                        """ALTER TABLE sessions
                           ADD COLUMN qr_issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"""
                    )
                cur.execute(
                    """SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
                       WHERE TABLE_SCHEMA=%s AND TABLE_NAME='sessions'
                         AND INDEX_NAME='idx_session_class_date' LIMIT 1""",
                    (DB["database"],),
                )
                if not cur.fetchone():
                    cur.execute(
                        "ALTER TABLE sessions ADD INDEX idx_session_class_date (class_id, session_date)"
                    )
                cur.execute(
                    """SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
                       WHERE TABLE_SCHEMA=%s AND TABLE_NAME='sessions'
                         AND INDEX_NAME='uq_session_day' LIMIT 1""",
                    (DB["database"],),
                )
                if cur.fetchone():
                    cur.execute("ALTER TABLE sessions DROP INDEX uq_session_day")
                cur.execute(
                    """ALTER TABLE attendance_logs
                       MODIFY COLUMN status ENUM('Present','Late','Excused','Absent')
                       NOT NULL DEFAULT 'Absent'"""
                )
                cur.execute(
                    """CREATE TABLE IF NOT EXISTS excuse_requests (
                      id INT AUTO_INCREMENT PRIMARY KEY,
                      class_id INT NOT NULL,
                      session_id INT NOT NULL,
                      student_user_id INT NOT NULL,
                      reason TEXT NOT NULL,
                      file_path VARCHAR(255) NOT NULL,
                      status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
                      reviewed_by INT NULL,
                      reviewed_at TIMESTAMP NULL,
                      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                      UNIQUE KEY uq_excuse_session_student (session_id, student_user_id),
                      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                      FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
                      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
                    ) ENGINE=InnoDB"""
                )
            _schema_extensions_ready = True
        finally:
            conn.close()


@app.before_request
def initialize_schema_extensions():
    if request.path.startswith("/api/") and request.endpoint != "health":
        ensure_schema_extensions()


def public_user(row):
    return {
        "id": row["id"],
        "role": row["role"],
        "full_name": row["full_name"],
        "username": row["username"],
        "student_id_number": row["student_id_number"],
    }


def start_session_cookie(user):
    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    session["role"] = user["role"]
    session["full_name"] = user["full_name"]
    session["student_id_number"] = user["student_id_number"]


def class_analytics(cid):
    completed = query(
        "SELECT COUNT(*) AS n FROM sessions WHERE class_id=%s AND (is_active=0 OR session_date<CURDATE())",
        (cid,),
        one=True,
    )["n"]
    students = query(
        """
        SELECT u.id AS student_user_id, u.full_name, u.student_id_number,
               COALESCE(p.present, 0) AS present,
               COALESCE(p.late, 0) AS late,
               COALESCE(p.excused, 0) AS excused
        FROM enrollments e
        JOIN users u ON u.id = e.student_user_id
        LEFT JOIN (
            SELECT a.student_user_id,
                   SUM(a.status='Present') AS present,
                   SUM(a.status='Late') AS late,
                   SUM(a.status='Excused') AS excused
            FROM attendance_logs a
            JOIN sessions s ON s.id = a.session_id
            WHERE s.class_id=%s AND (s.is_active=0 OR s.session_date<CURDATE())
            GROUP BY a.student_user_id
        ) p ON p.student_user_id = u.id
        WHERE e.class_id=%s
        ORDER BY u.full_name
        """,
        (cid, cid),
    )
    for s in students:
        s["present"] = int(s["present"] or 0)
        s["late"] = int(s["late"] or 0)
        s["excused"] = int(s["excused"] or 0)
        s["absent"] = max(completed - s["present"] - s["late"] - s["excused"], 0)
        s["completed_sessions"] = completed
        s["rate"] = round(s["present"] * 100 / completed, 1) if completed else None
        s["consecutive_absences"] = 0
    attendance = query(
        """SELECT a.student_user_id, a.status
           FROM sessions s
           JOIN attendance_logs a ON a.session_id=s.id
           JOIN enrollments e ON e.class_id=s.class_id AND e.student_user_id=a.student_user_id
           WHERE s.class_id=%s AND (s.is_active=0 OR s.session_date<CURDATE())
           ORDER BY s.session_date DESC, s.started_at DESC, s.id DESC""",
        (cid,),
    )
    streaks = {}
    seen = set()
    for row in attendance:
        student_id = row["student_user_id"]
        if student_id in seen:
            continue
        if row["status"] == "Absent":
            streaks[student_id] = streaks.get(student_id, 0) + 1
        else:
            seen.add(student_id)
    for s in students:
        s["consecutive_absences"] = streaks.get(s["student_user_id"], 0)
        rate = s["rate"]
        streak = s["consecutive_absences"]
        s["risk"] = (
            "at_risk" if (rate is not None and rate < 75) or streak >= 3
            else "warning" if (rate is not None and rate < 80) or streak >= 2
            else "safe"
        )
        s["risk_reason"] = (
            f"{streak} consecutive absences" if streak >= 3
            else "Attendance below 75%" if rate is not None and rate < 75
            else f"{streak} consecutive absences" if streak >= 2
            else "Attendance below 80%" if rate is not None and rate < 80
            else None
        )
    perfect = [s for s in students if completed > 0 and s["present"] == completed]
    return {"completed_sessions": completed, "students": students, "perfect_attendance": perfect}


# ---------------------------------------------------------------------------
# 1. Authentication
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    try:
        query("SELECT 1")
        return jsonify(ok=True, database="connected")
    except Exception as exc:  # pragma: no cover
        return jsonify(ok=False, database=str(exc)), 500


@app.post("/api/signup")
def signup():
    d = body()
    role = (d.get("role") or "").strip()
    full_name = (d.get("full_name") or "").strip()
    username = (d.get("username") or "").strip()
    password = d.get("password") or ""
    sid = (d.get("student_id_number") or "").strip() or None

    if role not in ("student", "instructor"):
        return err("Choose Student or Instructor.")
    if not full_name or not username:
        return err("Full name and username are required.")
    if len(password) < 6:
        return err("Password must be at least 6 characters.")
    if role == "student" and not sid:
        return err("Students must enter their Student ID number.")
    if role == "instructor":
        sid = None

    if query("SELECT 1 FROM users WHERE username=%s", (username,), one=True):
        return err("That username is already taken.", 409)
    if sid and query("SELECT 1 FROM users WHERE student_id_number=%s", (sid,), one=True):
        return err("That Student ID number is already registered.", 409)

    _, new_id = execute(
        "INSERT INTO users (role, full_name, username, student_id_number, password_hash) VALUES (%s,%s,%s,%s,%s)",
        (role, full_name, username, sid, generate_password_hash(password)),
    )
    user = query("SELECT * FROM users WHERE id=%s", (new_id,), one=True)
    start_session_cookie(user)
    return jsonify(ok=True, role=role, user=public_user(user))


@app.post("/api/login")
def login():
    d = body()
    username = (d.get("username") or "").strip()
    password = d.get("password") or ""
    user = query(
        "SELECT * FROM users WHERE username=%s OR student_id_number=%s LIMIT 1",
        (username, username),
        one=True,
    )
    if not user or not check_password_hash(user["password_hash"], password):
        return err("Wrong username / Student ID or password.", 401)
    start_session_cookie(user)
    return jsonify(ok=True, role=user["role"], user=public_user(user))


@app.get("/api/session")
def get_session():
    if not uid():
        return jsonify(authenticated=False)
    user = query("SELECT * FROM users WHERE id=%s", (uid(),), one=True)
    if not user:
        session.clear()
        return jsonify(authenticated=False)
    return jsonify(authenticated=True, user=public_user(user))


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# 2. Classes & roster
# ---------------------------------------------------------------------------
@app.get("/api/classes")
@login_required
def list_classes():
    if session["role"] == "instructor":
        rows = query(
            """
            SELECT c.*,
              (SELECT COUNT(*) FROM enrollments e WHERE e.class_id=c.id) AS enrolled_count,
              (SELECT COUNT(*) FROM classlist l WHERE l.class_id=c.id) AS roster_count,
              (SELECT COUNT(*) FROM sessions s WHERE s.class_id=c.id) AS session_count,
              (SELECT s.id FROM sessions s WHERE s.class_id=c.id AND s.is_active=1
                 ORDER BY s.id DESC LIMIT 1) AS active_session_id
            FROM classes c WHERE c.instructor_id=%s ORDER BY c.created_at DESC
            """,
            (uid(),),
        )
    else:
        rows = query(
            """
            SELECT c.id, c.subject, c.section, c.class_code, c.schedule,
                   u.full_name AS instructor_name, e.enrolled_at,
              (SELECT s.id FROM sessions s WHERE s.class_id=c.id AND s.is_active=1
                 ORDER BY s.id DESC LIMIT 1) AS active_session_id
            FROM enrollments e
            JOIN classes c ON c.id=e.class_id
            JOIN users u ON u.id=c.instructor_id
            WHERE e.student_user_id=%s ORDER BY c.subject
            """,
            (uid(),),
        )
        for row in rows:
            metrics = class_analytics(row["id"])
            student_metrics = next(
                (student for student in metrics["students"] if student["student_user_id"] == uid()),
                None,
            )
            row["attendance_rate"] = student_metrics["rate"] if student_metrics else None
            row["present"] = student_metrics["present"] if student_metrics else 0
            row["late"] = student_metrics["late"] if student_metrics else 0
            row["excused"] = student_metrics["excused"] if student_metrics else 0
            row["absent"] = student_metrics["absent"] if student_metrics else 0
            row["completed_sessions"] = student_metrics["completed_sessions"] if student_metrics else 0
            row["consecutive_absences"] = student_metrics["consecutive_absences"] if student_metrics else 0
            row["risk"] = student_metrics["risk"] if student_metrics else "safe"
            row["risk_reason"] = student_metrics["risk_reason"] if student_metrics else None
    return jsonify(classes=rows)


@app.post("/api/classes")
@role_required("instructor")
def create_class():
    d = body()
    subject = (d.get("subject") or "").strip()
    section = (d.get("section") or "INF3G").strip() or "INF3G"
    schedule = (d.get("schedule") or "").strip() or None
    if not subject:
        return err("Subject is required.")
    code = new_class_code()
    _, cid = execute(
        "INSERT INTO classes (instructor_id, subject, section, class_code, schedule) VALUES (%s,%s,%s,%s,%s)",
        (uid(), subject, section, code, schedule),
    )
    return jsonify(ok=True, id=cid, class_code=code)


@app.get("/api/classes/lookup")
@login_required
def lookup_class():
    code = (request.args.get("code") or "").strip().upper()
    row = query(
        """SELECT c.id, c.subject, c.section, c.class_code, c.schedule, u.full_name AS instructor_name
           FROM classes c JOIN users u ON u.id=c.instructor_id WHERE c.class_code=%s""",
        (code,),
        one=True,
    )
    if not row:
        return err("Class code not found.", 404)
    row["already_enrolled"] = session["role"] == "student" and is_enrolled(row["id"], uid())
    return jsonify(row)


@app.get("/api/classes/<int:cid>")
@login_required
def get_class(cid):
    if session["role"] == "instructor":
        cls = owned_class(cid)
        if not cls:
            return err("Class not found.", 404)
        classlist = query(
            """SELECT id, student_id_number, full_name FROM classlist
               WHERE class_id=%s ORDER BY full_name""",
            (cid,),
        )
        enrolled_ids = {
            normalized_student_id(row["student_id_number"])
            for row in query(
                """SELECT u.student_id_number FROM enrollments e
                   JOIN users u ON u.id=e.student_user_id WHERE e.class_id=%s""",
                (cid,),
            )
        }
        for r in classlist:
            r["enrolled"] = normalized_student_id(r["student_id_number"]) in enrolled_ids
        sessions_ = query(
            """
            SELECT s.id, s.session_date, s.is_active, s.started_at, s.ended_at,
                   COALESCE(SUM(a.status='Present'),0) AS present,
                   COALESCE(SUM(a.status='Late'),0) AS late,
                   COALESCE(SUM(a.status='Excused'),0) AS excused,
                   COALESCE(SUM(a.status='Absent'),0) AS absent
            FROM sessions s LEFT JOIN attendance_logs a ON a.session_id=s.id
            WHERE s.class_id=%s GROUP BY s.id
            ORDER BY s.session_date DESC, s.started_at DESC, s.id DESC
            """,
            (cid,),
        )
        cls["enrolled_count"] = query(
            "SELECT COUNT(*) AS n FROM enrollments WHERE class_id=%s", (cid,), one=True
        )["n"]
        return jsonify({"class": cls, "classlist": classlist, "sessions": sessions_})

    if not is_enrolled(cid, uid()):
        return err("You are not enrolled in this class.", 403)
    cls = query(
        """SELECT c.id, c.subject, c.section, c.class_code, c.schedule, u.full_name AS instructor_name
           FROM classes c JOIN users u ON u.id=c.instructor_id WHERE c.id=%s""",
        (cid,),
        one=True,
    )
    stats = query(
        """SELECT COUNT(*) AS total_sessions,
                  COALESCE(SUM(COALESCE(a.status,'Absent')='Present'),0) AS present,
                  COALESCE(SUM(COALESCE(a.status,'Absent')='Late'),0) AS late,
                  COALESCE(SUM(COALESCE(a.status,'Absent')='Excused'),0) AS excused,
                  COALESCE(SUM(COALESCE(a.status,'Absent')='Absent'),0) AS absent
           FROM sessions s
           LEFT JOIN attendance_logs a ON a.session_id=s.id AND a.student_user_id=%s
           WHERE s.class_id=%s AND (s.is_active=0 OR s.session_date<CURDATE())""",
        (uid(), cid),
        one=True,
    )
    attendance = query(
        """SELECT s.id AS session_id, s.session_date, s.started_at, s.is_active,
                  CASE
                    WHEN a.status IS NULL AND s.is_active=1 AND s.session_date>=CURDATE() THEN NULL
                    ELSE COALESCE(a.status,'Absent')
                  END AS status,
                  a.marked_at,
                  x.id AS excuse_id, x.status AS excuse_status
           FROM sessions s
           LEFT JOIN attendance_logs a ON a.session_id=s.id AND a.student_user_id=%s
           LEFT JOIN excuse_requests x ON x.session_id=s.id AND x.student_user_id=%s
           WHERE s.class_id=%s
           ORDER BY s.session_date DESC, s.started_at DESC, s.id DESC""",
        (uid(), uid(), cid),
    )
    metrics = class_analytics(cid)
    student_metrics = next(
        (student for student in metrics["students"] if student["student_user_id"] == uid()),
        None,
    )
    active = query(
        "SELECT id FROM sessions WHERE class_id=%s AND is_active=1 ORDER BY id DESC LIMIT 1",
        (cid,),
        one=True,
    )
    cls["active_session_id"] = active["id"] if active else None
    return jsonify({
        "class": cls,
        "stats": stats,
        "attendance": attendance,
        "standing": student_metrics or {
            "rate": None, "consecutive_absences": 0, "risk": "safe", "risk_reason": None,
        },
    })


@app.get("/api/classes/<int:cid>/classlist")
@role_required("instructor")
def get_classlist(cid):
    if not owned_class(cid):
        return err("Class not found.", 404)
    rows = query(
        "SELECT id, student_id_number, full_name FROM classlist WHERE class_id=%s ORDER BY full_name",
        (cid,),
    )
    return jsonify(classlist=rows)


@app.post("/api/classes/<int:cid>/classlist")
@role_required("instructor")
def save_classlist(cid):
    if not owned_class(cid):
        return err("Class not found.", 404)
    data = body()
    students = data.get("students")
    if students is not None and not isinstance(students, list):
        return err("Students must be a list.")
    if students is None:
        students = []
        text_rows = data.get("rows") or ""
        if not isinstance(text_rows, str):
            return err("Roster rows must be provided as text.")
        for raw in text_rows.splitlines():
            line = raw.strip()
            sep = "," if "," in line else ("\t" if "\t" in line else None)
            if not line or not sep:
                continue
            sid, name = [part.strip() for part in line.split(sep, 1)]
            students.append({"student_id_number": sid, "full_name": name})
    if len(students) > 2000:
        return err("Import at most 2000 students at a time.", 413)
    added = 0
    skipped = 0
    duplicates = 0
    existing_ids = {
        normalized_student_id(row["student_id_number"])
        for row in query("SELECT student_id_number FROM classlist WHERE class_id=%s", (cid,))
    }
    seen = set(existing_ids)
    for student in students:
        if not isinstance(student, dict):
            skipped += 1
            continue
        sid = "".join(ch for ch in str(student.get("student_id_number") or "") if ch.isalnum())
        name = " ".join(str(student.get("full_name") or "").split())
        if (
            not sid or not name or len(sid) > 30 or len(name) > 150
            or not any(ch.isdigit() for ch in sid)
        ):
            skipped += 1
            continue
        normalized_id = normalized_student_id(sid)
        if normalized_id in seen:
            duplicates += 1
            continue
        seen.add(normalized_id)
        n, _ = execute(
            "INSERT IGNORE INTO classlist (class_id, student_id_number, full_name) VALUES (%s,%s,%s)",
            (cid, sid, name),
        )
        added += n
        if not n:
            duplicates += 1
    return jsonify(added=added, skipped=skipped, duplicates=duplicates)


@app.delete("/api/classes/<int:cid>/classlist/<int:row_id>")
@role_required("instructor")
def delete_classlist_row(cid, row_id):
    if not owned_class(cid):
        return err("Class not found.", 404)
    execute("DELETE FROM classlist WHERE id=%s AND class_id=%s", (row_id, cid))
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# 3. Enrollment with masterlist validation
# ---------------------------------------------------------------------------
@app.post("/api/enroll")
@role_required("student")
def enroll():
    code = (body().get("code") or "").strip().upper()
    cls = query("SELECT * FROM classes WHERE class_code=%s", (code,), one=True)
    if not cls:
        return err("Class code not found.", 404)
    listed_ids = query(
        "SELECT student_id_number FROM classlist WHERE class_id=%s",
        (cls["id"],),
    )
    student_id = normalized_student_id(session.get("student_id_number"))
    if not any(normalized_student_id(row["student_id_number"]) == student_id for row in listed_ids):
        return err(NOT_IN_CLASSLIST, 403)
    execute(
        "INSERT IGNORE INTO enrollments (class_id, student_user_id) VALUES (%s,%s)",
        (cls["id"], uid()),
    )
    # Join any session that is already running today
    execute(
        """INSERT IGNORE INTO attendance_logs (session_id, student_user_id, status, marked_by)
           SELECT id, %s, 'Absent', 'instructor' FROM sessions WHERE class_id=%s AND is_active=1""",
        (uid(), cls["id"]),
    )
    return jsonify(ok=True, subject=cls["subject"], class_id=cls["id"])


# ---------------------------------------------------------------------------
# 4. Sessions & attendance
# ---------------------------------------------------------------------------
@app.get("/api/classes/<int:cid>/sessions")
@role_required("instructor")
def list_sessions(cid):
    if not owned_class(cid):
        return err("Class not found.", 404)
    rows = query(
        """SELECT * FROM sessions WHERE class_id=%s
           ORDER BY session_date DESC, started_at DESC, id DESC""",
        (cid,),
    )
    return jsonify(sessions=rows)


@app.post("/api/classes/<int:cid>/sessions")
@role_required("instructor")
def start_session(cid):
    today = date.today()
    conn = db()
    try:
        conn.begin()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM classes WHERE id=%s AND instructor_id=%s FOR UPDATE",
                (cid, uid()),
            )
            if not cur.fetchone():
                conn.rollback()
                return err("Class not found.", 404)
            cur.execute(
                "SELECT id FROM sessions WHERE class_id=%s AND is_active=1 LIMIT 1",
                (cid,),
            )
            if cur.fetchone():
                conn.rollback()
                return err("End the active session before starting another.", 409)
            cur.execute(
                """INSERT INTO sessions
                   (class_id, session_date, qr_secret, qr_issued_at, is_active, started_at)
                   VALUES (%s,%s,%s,NOW(),1,NOW())""",
                (cid, today, new_qr_secret()),
            )
            session_id = cur.lastrowid
            cur.execute(
                """INSERT IGNORE INTO attendance_logs (session_id, student_user_id, status, marked_by)
                   SELECT %s, student_user_id, 'Absent', 'instructor'
                   FROM enrollments WHERE class_id=%s""",
                (session_id, cid),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return jsonify(ok=True, session_id=session_id)


def owned_session(sid):
    return query(
        """SELECT s.*, c.subject, c.section, c.class_code, c.schedule,
                  GREATEST(0, 60 - TIMESTAMPDIFF(SECOND, s.qr_issued_at, NOW())) AS qr_seconds_left,
                  GREATEST(0, 900 - TIMESTAMPDIFF(SECOND, s.started_at, NOW())) AS grace_seconds_left
           FROM sessions s JOIN classes c ON c.id=s.class_id
           WHERE s.id=%s AND c.instructor_id=%s""",
        (sid, uid()),
        one=True,
    )


@app.get("/api/sessions/<int:sid>")
@role_required("instructor")
def get_session_detail(sid):
    s = owned_session(sid)
    if not s:
        return err("Session not found.", 404)
    roster = query(
        """
        SELECT u.id AS student_user_id, u.full_name, u.student_id_number,
               COALESCE(a.status,'Absent') AS status, a.marked_at, a.marked_by
        FROM enrollments e
        JOIN users u ON u.id=e.student_user_id
        LEFT JOIN attendance_logs a ON a.session_id=%s AND a.student_user_id=u.id
        WHERE e.class_id=%s ORDER BY u.full_name
        """,
        (sid, s["class_id"]),
    )
    metrics = class_analytics(s["class_id"])
    by_student = {item["student_user_id"]: item for item in metrics["students"]}
    for student in roster:
        standing = by_student.get(student["student_user_id"], {})
        student["rate"] = standing.get("rate")
        student["consecutive_absences"] = standing.get("consecutive_absences", 0)
        student["risk"] = standing.get("risk", "safe")
        student["risk_reason"] = standing.get("risk_reason")
    recent_checkins = query(
        """SELECT a.student_user_id, u.student_id_number, u.full_name, a.status, a.marked_at
           FROM attendance_logs a JOIN users u ON u.id=a.student_user_id
           WHERE a.session_id=%s AND a.status IN ('Present','Late') AND a.marked_by='qr'
           ORDER BY a.marked_at DESC LIMIT 10""",
        (sid,),
    )
    excuses = query(
        """SELECT x.id, x.student_user_id, u.full_name, u.student_id_number,
                  x.reason, x.status, x.created_at, x.reviewed_at
           FROM excuse_requests x JOIN users u ON u.id=x.student_user_id
           WHERE x.session_id=%s ORDER BY x.created_at DESC""",
        (sid,),
    )
    s["is_active"] = bool(s["is_active"])
    s["completed_sessions"] = metrics["completed_sessions"]
    s["qr_path"] = f"/scan?s={s['qr_secret']}"
    return jsonify(session=s, roster=roster, recent_checkins=recent_checkins, excuses=excuses)


@app.post("/api/sessions/<int:sid>/rotate")
@role_required("instructor")
def rotate_qr(sid):
    s = owned_session(sid)
    if not s:
        return err("Session not found.", 404)
    if not s["is_active"]:
        return err("This session has ended.", 409)
    secret = new_qr_secret()
    execute("UPDATE sessions SET qr_secret=%s, qr_issued_at=NOW() WHERE id=%s", (secret, sid))
    return jsonify(ok=True, qr_secret=secret, qr_path=f"/scan?s={secret}")


@app.post("/api/sessions/<int:sid>/end")
@role_required("instructor")
def end_session(sid):
    if not owned_session(sid):
        return err("Session not found.", 404)
    execute("UPDATE sessions SET is_active=0, ended_at=NOW() WHERE id=%s", (sid,))
    return jsonify(ok=True)


@app.post("/api/attendance/update")
@role_required("instructor")
def update_attendance():
    d = body()
    sid = d.get("session_id")
    student = d.get("student_user_id")
    status = d.get("status")
    if status not in ("Present", "Late", "Excused", "Absent"):
        return err("Status must be Present, Late, Excused, or Absent.")
    s = owned_session(sid)
    if not s:
        return err("Session not found.", 404)
    if not is_enrolled(s["class_id"], student):
        return err("That student is not enrolled in this class.", 404)
    execute(
        """INSERT INTO attendance_logs (session_id, student_user_id, status, marked_at, marked_by)
           VALUES (%s,%s,%s,NOW(),'instructor')
           ON DUPLICATE KEY UPDATE status=VALUES(status), marked_by='instructor', marked_at=NOW()""",
        (sid, student, status),
    )
    return jsonify(ok=True, status=status)


@app.post("/api/scan")
@role_required("student")
def scan():
    data = body()
    secret = (data.get("secret") or "").strip().lower()
    s = query(
        """SELECT s.*, c.subject,
                  (TIMESTAMPDIFF(SECOND, s.started_at, NOW()) >= 900) AS grace_ended
           FROM sessions s JOIN classes c ON c.id=s.class_id
           WHERE s.qr_secret=%s AND s.is_active=1
             AND TIMESTAMPDIFF(SECOND, s.qr_issued_at, NOW()) < 60""",
        (secret,),
        one=True,
    )
    if not s:
        return err("This QR code has expired or the session has ended. Scan the code on the screen again.", 404)
    if not is_enrolled(s["class_id"], uid()):
        return err("You are not enrolled in this class.", 403)
    existing = query(
        "SELECT status, marked_at FROM attendance_logs WHERE session_id=%s AND student_user_id=%s",
        (s["id"], uid()),
        one=True,
    )
    if existing and existing["status"] in ("Present", "Late", "Excused"):
        return jsonify(
            ok=True, already=True, subject=s["subject"], status=existing["status"],
            marked_at=existing["marked_at"],
        )
    attendance_status = "Late" if s["grace_ended"] else "Present"
    execute(
        """INSERT INTO attendance_logs (session_id, student_user_id, status, marked_at, marked_by)
           VALUES (%s,%s,%s,NOW(),'qr')
           ON DUPLICATE KEY UPDATE status=VALUES(status), marked_by='qr', marked_at=NOW()""",
        (s["id"], uid(), attendance_status),
    )
    marked = query(
        "SELECT marked_at FROM attendance_logs WHERE session_id=%s AND student_user_id=%s",
        (s["id"], uid()),
        one=True,
    )
    return jsonify(
        ok=True, already=False, subject=s["subject"], status=attendance_status,
        marked_at=marked["marked_at"],
    )


@app.post("/api/sessions/<int:sid>/excuses")
@role_required("student")
def submit_excuse(sid):
    s = query(
        """SELECT s.id, s.class_id, s.is_active, s.session_date FROM sessions s
           WHERE s.id=%s""",
        (sid,),
        one=True,
    )
    if not s:
        return err("Session not found.", 404)
    if not is_enrolled(s["class_id"], uid()):
        return err("You are not enrolled in this class.", 403)
    if s["is_active"] and s["session_date"] >= date.today():
        return err("An excuse can be submitted after the class session is completed.", 409)
    attendance = query(
        "SELECT status FROM attendance_logs WHERE session_id=%s AND student_user_id=%s",
        (sid, uid()),
        one=True,
    )
    if attendance and attendance["status"] != "Absent":
        return err("An excuse request is only available for an absent session.", 409)
    reason = (request.form.get("reason") or "").strip()
    upload = request.files.get("document")
    if not reason:
        return err("Please provide a reason for the absence.")
    if len(reason) > 4000:
        return err("The reason must be 4000 characters or fewer.")
    if not upload or not upload.filename:
        return err("Attach an excuse slip or medical certificate.")
    extension = Path(secure_filename(upload.filename)).suffix.lower()
    if extension not in {".pdf", ".jpg", ".jpeg", ".png"}:
        return err("Upload a PDF, JPG, or PNG document.")
    signature = upload.stream.read(8)
    upload.stream.seek(0)
    valid_signature = (
        (extension == ".pdf" and signature.startswith(b"%PDF-"))
        or (extension in {".jpg", ".jpeg"} and signature.startswith(b"\xff\xd8\xff"))
        or (extension == ".png" and signature.startswith(b"\x89PNG\r\n\x1a\n"))
    )
    if not valid_signature:
        return err("The uploaded file does not match its file type.")
    existing = query(
        "SELECT id FROM excuse_requests WHERE session_id=%s AND student_user_id=%s",
        (sid, uid()),
        one=True,
    )
    if existing:
        return err("An excuse request has already been submitted for this session.", 409)
    filename = f"{secrets.token_hex(24)}{extension}"
    EXCUSE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    upload.save(EXCUSE_UPLOAD_DIR / filename)
    try:
        if not attendance:
            execute(
                """INSERT IGNORE INTO attendance_logs
                   (session_id, student_user_id, status, marked_by)
                   VALUES (%s,%s,'Absent','instructor')""",
                (sid, uid()),
            )
        execute(
            """INSERT INTO excuse_requests
               (class_id, session_id, student_user_id, reason, file_path)
               VALUES (%s,%s,%s,%s,%s)""",
            (s["class_id"], sid, uid(), reason, filename),
        )
    except Exception:
        (EXCUSE_UPLOAD_DIR / filename).unlink(missing_ok=True)
        raise
    return jsonify(ok=True, status="Pending"), 201


@app.post("/api/excuses/<int:request_id>/review")
@role_required("instructor")
def review_excuse(request_id):
    data = body()
    status = data.get("status")
    if status not in ("Approved", "Rejected"):
        return err("Review status must be Approved or Rejected.")
    request_row = query(
        """SELECT x.*, s.is_active, s.session_date
           FROM excuse_requests x JOIN sessions s ON s.id=x.session_id
           JOIN classes c ON c.id=x.class_id
           WHERE x.id=%s AND c.instructor_id=%s""",
        (request_id, uid()),
        one=True,
    )
    if not request_row:
        return err("Excuse request not found.", 404)
    if request_row["status"] != "Pending":
        return err("This excuse request has already been reviewed.", 409)

    conn = db()
    try:
        conn.begin()
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE excuse_requests SET status=%s, reviewed_by=%s, reviewed_at=NOW()
                   WHERE id=%s AND status='Pending'""",
                (status, uid(), request_id),
            )
            if cur.rowcount != 1:
                conn.rollback()
                return err("This excuse request has already been reviewed.", 409)
            if status == "Approved":
                cur.execute(
                    """UPDATE attendance_logs SET status='Excused', marked_by='instructor', marked_at=NOW()
                       WHERE session_id=%s AND student_user_id=%s AND status='Absent'""",
                    (request_row["session_id"], request_row["student_user_id"]),
                )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return jsonify(ok=True, status=status)


@app.get("/api/excuses/<int:request_id>/document")
@login_required
def download_excuse_document(request_id):
    row = query(
        """SELECT x.file_path, x.student_user_id, x.class_id, c.instructor_id
           FROM excuse_requests x JOIN classes c ON c.id=x.class_id WHERE x.id=%s""",
        (request_id,),
        one=True,
    )
    if not row:
        return err("Excuse document not found.", 404)
    if uid() != row["student_user_id"] and uid() != row["instructor_id"]:
        return err("You are not allowed to view this document.", 403)
    path = EXCUSE_UPLOAD_DIR / Path(row["file_path"]).name
    if not path.is_file():
        return err("Excuse document is unavailable.", 404)
    return send_file(path, as_attachment=True, download_name=f"excuse-{request_id}{path.suffix}")


# ---------------------------------------------------------------------------
# 5. Calendar, analytics, dashboard, export
# ---------------------------------------------------------------------------
@app.get("/api/calendar")
@login_required
def calendar():
    view = request.args.get("view", "month")
    cid = request.args.get("class_id", type=int)
    try:
        anchor = datetime.strptime(request.args.get("date", ""), "%Y-%m-%d").date()
    except ValueError:
        anchor = date.today()

    if view == "week":
        start = anchor - timedelta(days=anchor.weekday())
        end = start + timedelta(days=6)
    else:
        view = "month"
        start = anchor.replace(day=1)
        end = (start + timedelta(days=32)).replace(day=1) - timedelta(days=1)

    days = []
    if session["role"] == "student":
        sql = """
            SELECT s.session_date, c.subject, COALESCE(a.status,'Absent') AS status
            FROM sessions s
            JOIN classes c ON c.id=s.class_id
            JOIN enrollments e ON e.class_id=s.class_id AND e.student_user_id=%s
            LEFT JOIN attendance_logs a ON a.session_id=s.id AND a.student_user_id=e.student_user_id
            WHERE s.session_date BETWEEN %s AND %s
        """
        args = [uid(), start, end]
        if cid:
            sql += " AND s.class_id=%s"
            args.append(cid)
        by_day = {}
        for r in query(sql, args):
            by_day.setdefault(r["session_date"], []).append(
                {"subject": r["subject"], "status": r["status"]}
            )
        d = start
        while d <= end:
            entries = by_day.get(d, [])
            counts = {
                status: sum(entry["status"] == status for entry in entries)
                for status in ("Present", "Late", "Excused", "Absent")
            }
            statuses = [status for status, count in counts.items() if count]
            status = statuses[0] if len(statuses) == 1 else "Multiple" if statuses else "No Class"
            days.append({
                "date": d,
                "weekday": d.weekday(),
                "status": status,
                "statuses": statuses,
                "counts": counts,
                "entries": entries,
            })
            d += timedelta(days=1)
    else:
        sql = """
            SELECT s.session_date,
                   COALESCE(SUM(a.status='Present'),0) AS present,
                   COALESCE(SUM(a.status='Late'),0) AS late,
                   COALESCE(SUM(a.status='Excused'),0) AS excused,
                   COALESCE(SUM(a.status='Absent'),0) AS absent
            FROM sessions s
            JOIN classes c ON c.id=s.class_id AND c.instructor_id=%s
            LEFT JOIN attendance_logs a ON a.session_id=s.id
            WHERE s.session_date BETWEEN %s AND %s
        """
        args = [uid(), start, end]
        if cid:
            sql += " AND s.class_id=%s"
            args.append(cid)
        sql += " GROUP BY s.session_date"
        by_day = {r["session_date"]: r for r in query(sql, args)}
        d = start
        while d <= end:
            r = by_day.get(d)
            days.append(
                {
                    "date": d,
                    "weekday": d.weekday(),
                    "has_session": bool(r),
                    "present": int(r["present"]) if r else 0,
                    "late": int(r["late"]) if r else 0,
                    "excused": int(r["excused"]) if r else 0,
                    "absent": int(r["absent"]) if r else 0,
                    "status": "Session" if r else "No Class",
                }
            )
            d += timedelta(days=1)

    return jsonify(view=view, start=start, end=end, today=date.today(), days=days)


@app.get("/api/analytics/<int:cid>")
@app.get("/api/classes/<int:cid>/analytics")
@role_required("instructor")
def analytics(cid):
    if not owned_class(cid):
        return err("Class not found.", 404)
    return jsonify(class_analytics(cid))


@app.get("/api/dashboard")
@login_required
def dashboard():
    if session["role"] == "instructor":
        classes = query("SELECT id, subject FROM classes WHERE instructor_id=%s", (uid(),))
        totals = query(
            """
            SELECT
              (SELECT COUNT(DISTINCT e.student_user_id) FROM enrollments e
                 JOIN classes c ON c.id=e.class_id WHERE c.instructor_id=%s) AS total_students,
              (SELECT COUNT(*) FROM sessions s JOIN classes c ON c.id=s.class_id
                 WHERE c.instructor_id=%s) AS all_sessions,
              (SELECT COUNT(*) FROM sessions s JOIN classes c ON c.id=s.class_id
                 WHERE c.instructor_id=%s AND s.session_date=CURDATE()) AS today_sessions
            """,
            (uid(), uid(), uid()),
            one=True,
        )
        perfect = []
        for c in classes:
            a = class_analytics(c["id"])
            for s in a["perfect_attendance"]:
                perfect.append({**s, "subject": c["subject"], "class_id": c["id"],
                                "completed_sessions": a["completed_sessions"]})
        pending_excuses = query(
            """SELECT x.id, x.session_id, x.reason, x.created_at,
                      u.full_name, c.subject, c.section, s.session_date
               FROM excuse_requests x
               JOIN sessions s ON s.id=x.session_id
               JOIN classes c ON c.id=x.class_id
               JOIN users u ON u.id=x.student_user_id
               WHERE c.instructor_id=%s AND x.status='Pending'
               ORDER BY x.created_at DESC""",
            (uid(),),
        )
        return jsonify(
            total_classes=len(classes),
            total_students=totals["total_students"],
            all_sessions=totals["all_sessions"],
            today_sessions=totals["today_sessions"],
            perfect_attendance=perfect,
            pending_excuses=pending_excuses,
        )

    stats = query(
        """SELECT COUNT(*) AS completed_sessions,
                  COALESCE(SUM(COALESCE(a.status,'Absent')='Present'),0) AS present,
                  COALESCE(SUM(COALESCE(a.status,'Absent')='Late'),0) AS late,
                  COALESCE(SUM(COALESCE(a.status,'Absent')='Excused'),0) AS excused,
                  COALESCE(SUM(COALESCE(a.status,'Absent')='Absent'),0) AS absent
           FROM enrollments e
           JOIN sessions s ON s.class_id=e.class_id
             AND (s.is_active=0 OR s.session_date<CURDATE())
           LEFT JOIN attendance_logs a ON a.session_id=s.id AND a.student_user_id=e.student_user_id
           WHERE e.student_user_id=%s""",
        (uid(),),
        one=True,
    )
    enrolled = query(
        "SELECT COUNT(*) AS n FROM enrollments WHERE student_user_id=%s", (uid(),), one=True
    )["n"]
    present = int(stats["present"])
    total = int(stats["completed_sessions"])
    return jsonify(
        enrolled_classes=enrolled,
        present=present,
        late=int(stats["late"]),
        excused=int(stats["excused"]),
        absent=int(stats["absent"]),
        completed_sessions=total,
        rate=round(present * 100 / total, 1) if total else None,
    )


@app.get("/api/export/<int:cid>")
@login_required
def export(cid):
    if session["role"] == "student":
        if not is_enrolled(cid, uid()):
            return err("You are not enrolled in this class.", 403)
        cls = query(
            """SELECT c.subject, c.section, c.class_code, c.schedule, u.full_name AS instructor_name
               FROM classes c JOIN users u ON u.id=c.instructor_id WHERE c.id=%s""",
            (cid,),
            one=True,
        )
        rows = query(
            """SELECT s.session_date, s.started_at, a.status, a.marked_at, a.marked_by
               FROM attendance_logs a JOIN sessions s ON s.id=a.session_id
               WHERE s.class_id=%s AND a.student_user_id=%s
               ORDER BY s.session_date, s.started_at, s.id""",
            (cid, uid()),
        )
        me = query("SELECT full_name, student_id_number FROM users WHERE id=%s", (uid(),), one=True)
        return jsonify({"class": cls, "student": me, "rows": rows})

    cls = owned_class(cid)
    if not cls:
        return err("Class not found.", 404)
    sessions_ = query(
        """SELECT id, session_date, started_at FROM sessions
           WHERE class_id=%s ORDER BY session_date, started_at, id""",
        (cid,),
    )
    students = query(
        """SELECT u.id, u.full_name, u.student_id_number FROM enrollments e
           JOIN users u ON u.id=e.student_user_id WHERE e.class_id=%s ORDER BY u.full_name""",
        (cid,),
    )
    logs = query(
        """SELECT a.session_id, a.student_user_id, a.status FROM attendance_logs a
           JOIN sessions s ON s.id=a.session_id WHERE s.class_id=%s""",
        (cid,),
    )
    status_map = {(l["session_id"], l["student_user_id"]): l["status"] for l in logs}
    for st in students:
        st["statuses"] = {str(s["id"]): status_map.get((s["id"], st["id"]), "Absent") for s in sessions_}
    return jsonify({"class": cls, "sessions": sessions_, "students": students})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
