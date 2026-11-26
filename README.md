# AttendTrack — BSIT 3G · NEMSU Cantilan Campus

QR attendance system: Flask + MySQL/MariaDB (`attendtrack1`) + React website (Vite + Tailwind),
in the NEMSU navy-and-gold theme (dark by default, light mode toggle included). Flask serves the
built website and API together on port 5000.

```
attendtrack/
├── database/attendtrack1.sql   ← import this first
├── backend/app.py              ← Flask website + API (port 5000)
├── backend/requirements.txt
└── frontend/                   ← React website (built once into dist/)
```

## What you need
- **XAMPP** (or any MySQL / MariaDB) — https://www.apachefriends.org
- **Python 3.10+** — https://www.python.org (tick "Add Python to PATH" when installing)
- **Node.js 18+** (LTS) — https://nodejs.org (only needed once to build the website)

## 1. Database
1. Open XAMPP Control Panel → Start **MySQL**.
2. Go to http://localhost/phpmyadmin → **Import** → choose `database/attendtrack1.sql` → **Go**.

The default connection is `root` with no password on `localhost:3306`.
If yours is different, set environment variables before starting the server:
`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.

## 2. Build the website once
Install Node.js 18+ LTS, then open a terminal in the `frontend` folder and run:

```bash
npm install
npm run build
```

This creates `frontend/dist`. Node.js is not needed to run the system after the build; rebuild
whenever frontend source files change.

## 3. Run the whole system with Python
Start MySQL in XAMPP, then open a terminal in the `backend` folder:

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000. The API health check is http://localhost:5000/api/health.
On later launches, open a terminal in `backend`, activate the environment, and run `python app.py`:

```powershell
.\venv\Scripts\Activate.ps1
python app.py
```

On Windows, `start-backend.bat` starts Flask after installing its Python requirements.

## How to use it
1. **Sign Up → Instructor**, create a class (you get a 6-character code).
2. Open the class → drop a `.CSV` or `.XLSX` official classlist into the import area. The sheet
   should have Student ID / ID Number and Full Name / Name, or First Name and Last Name columns.
   Review the detected rows and duplicates before importing.
3. Click **Copy invite link** and send it to students (`/join?code=XXXXXX`).
4. Students **Sign Up → Student** with their Student ID number, open the link and enroll.
   Anyone not on the classlist sees: *"Not in the classlist. You are not officially listed in this class roster."*
5. Click **Start today's session**. The QR refreshes every minute. Students who scan within the
   first 15 minutes are marked **Present**; later scans are marked **Late** while the session stays
   open. Check-ins appear in the live ticker. Use the roster dropdown to choose Present, Late,
   Excused, or Absent.
6. **Attendance calendar** shows Month / Week views (green Present, red Absent, grey no class),
   and **Export Word** downloads a `.doc` attendance log.
7. Class attendance analytics flag students below 75%, near the threshold, or with consecutive
   absences. Students see their academic standing and may submit an excuse document for a completed
   absence; instructors review requests from the session page.

Excuse uploads accept PDF, JPG, or PNG files up to 10 MB. Files are stored under
`backend/uploads/excuses` and are only downloadable by the requesting student or their instructor.
The first API request also applies the excuse-request schema and attendance-status / QR timestamp
updates to an existing database; importing the updated SQL file creates them for new installations.

### Scanning with phones
Phones can't open `localhost`. Open the instructor's session page using the computer's LAN IP
address on port 5000 (for example, `http://192.168.1.20:5000`) while on the same Wi-Fi, so the QR
contains a link phones can reach. Allow Python through the Windows Firewall if asked.
Students must be logged in on their phone (they'll be asked to log in, then sent back automatically).
The in-app camera scanner requires a browser with QR `BarcodeDetector` support and a secure origin:
use HTTPS for phones on the network (or `localhost` on the same device). Otherwise, scan with the
phone's camera app and open the QR link.

## API summary
| Method | Route | Who |
|---|---|---|
| POST | `/api/signup`, `/api/login`, `/api/logout` · GET `/api/session` | everyone |
| GET/POST | `/api/classes` | instructor creates, both list |
| GET | `/api/classes/<id>` · `/api/classes/lookup?code=` | both |
| POST | `/api/classes/<id>/classlist` | instructor |
| POST | `/api/enroll` | student (checked against classlist) |
| POST | `/api/classes/<id>/sessions` · `/api/sessions/<id>/rotate` · `/api/sessions/<id>/end` | instructor |
| GET | `/api/sessions/<id>` | instructor (QR + roster) |
| POST | `/api/attendance/update` | instructor manual override |
| POST | `/api/scan` | student QR check-in |
| POST | `/api/sessions/<id>/excuses` | student excuse submission |
| POST | `/api/excuses/<id>/review` · GET `/api/excuses/<id>/document` | instructor review / authorized download |
| GET | `/api/calendar?class_id=&view=month\|week&date=YYYY-MM-DD` | both |
| GET | `/api/analytics/<id>` · `/api/dashboard` · `/api/export/<id>` | per role |

Attendance statuses are **Present**, **Late**, **Excused**, and **Absent**. QR check-ins switch from
Present to Late after the first 15 minutes of an active session.

## Before putting it online
- Set a strong `SECRET_KEY` environment variable.
- Set `SESSION_COOKIE_SECURE=True` in `app.py` once you're on HTTPS.
- Run `npm run build` and serve `frontend/dist` behind the same domain as the API.
