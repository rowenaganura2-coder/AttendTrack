import os
import ssl
import zipfile
import threading
from datetime import datetime, date
from decimal import Decimal
import pymysql

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(CURRENT_DIR, "backups")
SCOPES = ["https://www.googleapis.com/auth/drive.file"]

DRIVE_BACKUP_FOLDER_ID = os.environ.get(
    "GOOGLE_DRIVE_FOLDER_ID", "1oruu5Maem4VT7rMVU9WSqWPXJx05dPS4"
)

os.makedirs(BACKUP_DIR, exist_ok=True)


def _resolve_secret_path(filename):
    """Checks Render's /etc/secrets first, then local backend/ directory."""
    render_secret = os.path.join("/etc/secrets", filename)
    if os.path.exists(render_secret):
        return render_secret
    return os.path.join(CURRENT_DIR, filename)


def get_db_connection():
    """Connects to TiDB Cloud (with SSL) on Render or local XAMPP MySQL."""
    host = os.environ.get("DB_HOST", "localhost")
    port = int(os.environ.get("DB_PORT", 3306))
    user = os.environ.get("DB_USER", "root")
    password = os.environ.get("DB_PASSWORD", "")
    database = os.environ.get("DB_NAME", "attendtrack1")

    kwargs = {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "database": database,
        "charset": "utf8mb4",
    }

    if host not in ("localhost", "127.0.0.1"):
        ctx = ssl.create_default_context()
        kwargs["ssl"] = ctx

    return pymysql.connect(**kwargs)


def get_drive_service():
    """Authenticates via OAuth 2.0 using Render Secret Files or local files."""
    client_secrets_file = _resolve_secret_path("credentials.json")
    token_file = _resolve_secret_path("token.json")
    writable_token_path = os.path.join(BACKUP_DIR, "token_cache.json")

    creds = None
    if os.path.exists(writable_token_path):
        creds = Credentials.from_authorized_user_file(writable_token_path, SCOPES)
    elif os.path.exists(token_file):
        creds = Credentials.from_authorized_user_file(token_file, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(client_secrets_file, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(writable_token_path, "w") as token:
            token.write(creds.to_json())

    return build("drive", "v3", credentials=creds)


def _escape_sql_value(conn, val):
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "1" if val else "0"
    if isinstance(val, (int, float, Decimal)):
        return str(val)
    if isinstance(val, (datetime, date)):
        return f"'{val.isoformat()}'"
    if isinstance(val, bytes):
        return f"X'{val.hex()}'"
    return conn.escape(str(val))


def create_sql_dump(conn, dest_path):
    """Generates a complete .sql dump in pure Python (works on Render & Windows)."""
    with conn.cursor() as cur, open(dest_path, "w", encoding="utf-8") as f:
        f.write(f"-- AttendTrack SQL Backup ({datetime.now().isoformat()})\n")
        f.write("SET FOREIGN_KEY_CHECKS=0;\n\n")

        cur.execute("SHOW TABLES")
        tables = [row[0] for row in cur.fetchall()]

        for table in tables:
            cur.execute(f"SHOW CREATE TABLE `{table}`")
            create_stmt = cur.fetchone()[1]
            f.write(f"DROP TABLE IF EXISTS `{table}`;\n")
            f.write(f"{create_stmt};\n\n")

            cur.execute(f"SELECT * FROM `{table}`")
            rows = cur.fetchall()
            if rows:
                col_names = ", ".join(f"`{desc[0]}`" for desc in cur.description)
                for row in rows:
                    vals = ", ".join(_escape_sql_value(conn, v) for v in row)
                    f.write(f"INSERT INTO `{table}` ({col_names}) VALUES ({vals});\n")
                f.write("\n")

        f.write("SET FOREIGN_KEY_CHECKS=1;\n")


def upload_to_drive(file_path, filename):
    """Uploads the zip file into the AttendTrack Backups Google Drive folder."""
    service = get_drive_service()
    file_metadata = {
        "name": filename,
        "parents": [DRIVE_BACKUP_FOLDER_ID],
    }
    media = MediaFileUpload(file_path, mimetype="application/zip", resumable=True)
    uploaded = service.files().create(
        body=file_metadata, media_body=media, fields="id"
    ).execute()
    return uploaded.get("id")


def run_full_backup_task():
    """Dumps DB, compresses to ZIP, uploads to Drive, and logs to system_backups."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_name = f"attendtrack_backup_{timestamp}"
    sql_file = os.path.join(BACKUP_DIR, f"{base_name}.sql")
    zip_file = os.path.join(BACKUP_DIR, f"{base_name}.zip")

    conn = None
    backup_id = None

    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO system_backups (filename, file_size_kb, status) VALUES (%s, 0, 'Pending')",
                (f"{base_name}.zip",),
            )
            backup_id = cur.lastrowid
        conn.commit()

        # 1. Pure-Python SQL Dump
        create_sql_dump(conn, sql_file)

        # 2. Compress to ZIP
        with zipfile.ZipFile(zip_file, "w", zipfile.ZIP_DEFLATED) as zipf:
            zipf.write(sql_file, arcname=f"{base_name}.sql")

        if os.path.exists(sql_file):
            os.remove(sql_file)

        size_kb = max(1, int(os.path.getsize(zip_file) / 1024))

        # 3. Upload to Drive
        drive_file_id = upload_to_drive(zip_file, f"{base_name}.zip")

        # 4. Save Success
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE system_backups
                SET status = 'Success', file_size_kb = %s, drive_file_id = %s
                WHERE id = %s
                """,
                (size_kb, drive_file_id, backup_id),
            )
        conn.commit()
        print(f"[BACKUP] Success: {base_name}.zip ({size_kb} KB) -> Drive ID {drive_file_id}", flush=True)

    except Exception as e:
        print(f"[BACKUP] Failed: {e}", flush=True)
        if conn and backup_id:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE system_backups SET status = 'Failed', error_message = %s WHERE id = %s",
                        (str(e), backup_id),
                    )
                conn.commit()
            except Exception:
                pass
    finally:
        if conn:
            conn.close()


def trigger_async_backup():
    """Runs backup in a background thread so UI never freezes."""
    thread = threading.Thread(target=run_full_backup_task, daemon=True)
    thread.start()