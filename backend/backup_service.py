import os
import subprocess
import zipfile
import threading
from datetime import datetime
import pymysql

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CLIENT_SECRETS_FILE = os.path.join(CURRENT_DIR, "credentials.json")
TOKEN_FILE = os.path.join(CURRENT_DIR, "token.json")
BACKUP_DIR = os.path.join(CURRENT_DIR, "backups")
MYSQLDUMP_PATH = r"C:\xampp\mysql\bin\mysqldump.exe"  # Adjust if XAMPP is on another drive

SCOPES = ["https://www.googleapis.com/auth/drive.file"]
DRIVE_BACKUP_FOLDER_ID = "1oruu5Maem4VT7rMVU9WSqWPXjX05dPS4"

DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "",
    "database": "attendtrack1"
}

os.makedirs(BACKUP_DIR, exist_ok=True)


def get_drive_service():
    """Authenticates via OAuth 2.0 and caches token.json."""
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(TOKEN_FILE, "w") as token:
            token.write(creds.to_json())

    return build("drive", "v3", credentials=creds)


def create_sql_dump(dest_path):
    """Exports raw SQL dump using mysqldump."""
    cmd = [
        MYSQLDUMP_PATH,
        f"-u{DB_CONFIG['user']}",
        f"-h{DB_CONFIG['host']}",
        DB_CONFIG["database"]
    ]
    if DB_CONFIG["password"]:
        cmd.insert(2, f"-p{DB_CONFIG['password']}")

    with open(dest_path, "w", encoding="utf-8") as f:
        proc = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, text=True)
        if proc.returncode != 0:
            raise Exception(f"mysqldump error: {proc.stderr}")


def upload_to_drive(file_path, filename):
    """Uploads the zip file into the AttendTrack Backups Google Drive folder."""
    service = get_drive_service()
    file_metadata = {
        "name": filename,
        "parents": [DRIVE_BACKUP_FOLDER_ID]
    }
    media = MediaFileUpload(file_path, mimetype="application/zip", resumable=True)
    uploaded = service.files().create(body=file_metadata, media_body=media, fields="id").execute()
    return uploaded.get("id")


def run_full_backup_task():
    """Dumps DB, compresses to ZIP, uploads to Drive, and logs to system_backups."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_name = f"attendtrack_backup_{timestamp}"
    sql_file = os.path.join(BACKUP_DIR, f"{base_name}.sql")
    zip_file = os.path.join(BACKUP_DIR, f"{base_name}.zip")

    conn = pymysql.connect(**DB_CONFIG)
    backup_id = None

    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO system_backups (filename, file_size_kb, status) VALUES (%s, 0, 'Pending')",
                (f"{base_name}.zip",)
            )
            backup_id = cur.lastrowid
        conn.commit()

        # 1. SQL Dump
        create_sql_dump(sql_file)

        # 2. Compress to ZIP
        with zipfile.ZipFile(zip_file, "w", zipfile.ZIP_DEFLATED) as zipf:
            zipf.write(sql_file, arcname=f"{base_name}.sql")

        if os.path.exists(sql_file):
            os.remove(sql_file)

        size_kb = int(os.path.getsize(zip_file) / 1024)

        # 3. Upload to Drive
        drive_file_id = upload_to_drive(zip_file, f"{base_name}.zip")

        # 4. Save Success
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE system_backups 
                SET status = 'Success', file_size_kb = %s, drive_file_id = %s 
                WHERE id = %s
            """, (size_kb, drive_file_id, backup_id))
        conn.commit()

    except Exception as e:
        if backup_id:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE system_backups SET status = 'Failed', error_message = %s WHERE id = %s",
                    (str(e), backup_id)
                )
            conn.commit()
    finally:
        conn.close()


def trigger_async_backup():
    """Runs backup in a background thread so UI never freezes."""
    thread = threading.Thread(target=run_full_backup_task, daemon=True)
    thread.start()