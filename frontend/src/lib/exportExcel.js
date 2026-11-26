import { fromISO, prettyTime } from "./api.js";

const NAVY = "FF0B3B82";
const WHITE = "FFFFFFFF";
const ATTENDANCE_STATUSES = {
  Present: { short: "P", color: "FF059669", fill: "FFD1FAE5" },
  Late: { short: "L", color: "FFD97706", fill: "FFFEF3C7" },
  Excused: { short: "E", color: "FF0284C7", fill: "FFE0F2FE" },
  Absent: { short: "A", color: "FFE11D48", fill: "FFFFE4E6" },
};

function countStatuses(rows, getStatus) {
  return Object.keys(ATTENDANCE_STATUSES).reduce((counts, status) => {
    counts[status] = rows.filter((row) => getStatus(row) === status).length;
    return counts;
  }, {});
}

async function createWorkbook() {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AttendTrack";
  workbook.created = new Date();
  return workbook;
}

function addTitle(worksheet, title, columnCount) {
  worksheet.mergeCells(1, 1, 1, columnCount);
  worksheet.getCell(1, 1).value = title;
  worksheet.getCell(1, 1).font = { name: "Georgia", size: 16, bold: true, color: { argb: NAVY } };
  worksheet.getCell(1, 1).alignment = { vertical: "middle" };
  worksheet.getRow(1).height = 28;

  worksheet.mergeCells(2, 1, 2, columnCount);
  worksheet.getCell(2, 1).value = "North Eastern Mindanao State University · Cantilan Campus · AttendTrack";
  worksheet.getCell(2, 1).font = { size: 10, color: { argb: "FF64748B" } };
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: WHITE } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 24;
}

function styleTableRows(worksheet, startRow) {
  for (let rowNumber = startRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.alignment = { vertical: "middle", wrapText: true };
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFC7D2E6" } },
      };
    });
    if (rowNumber % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7FB" } };
    }
  }
}

function addMetadata(worksheet, items, columnCount = 5) {
  items.forEach(([label, value], index) => {
    const row = worksheet.getRow(index + 4);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, color: { argb: NAVY } };
    row.getCell(2).value = value || "—";
    worksheet.mergeCells(row.number, 2, row.number, columnCount);
  });
}

export async function studentWorkbook(data) {
  const workbook = await createWorkbook();
  const worksheet = workbook.addWorksheet("Attendance");
  worksheet.columns = [
    { width: 8 },
    { width: 18 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ];
  addTitle(worksheet, "Student Attendance Log", 6);

  const counts = countStatuses(data.rows, (row) => row.status);
  addMetadata(worksheet, [
    ["Student", data.student.full_name],
    ["Student ID", data.student.student_id_number],
    ["Subject", data.class.subject],
    ["Section / Code", `${data.class.section} · ${data.class.class_code}`],
    ["Instructor", data.class.instructor_name],
    ["Schedule", data.class.schedule],
    ["Summary", `${counts.Present} Present · ${counts.Late} Late · ${counts.Excused} Excused · ${counts.Absent} Absent of ${data.rows.length} sessions`],
  ], 6);

  const header = worksheet.getRow(12);
  header.values = ["#", "Date", "Session time", "Status", "Time in", "Marked by"];
  styleHeader(header);

  if (data.rows.length) {
    data.rows.forEach((record, index) => {
      const row = worksheet.addRow([
        index + 1,
        fromISO(record.session_date),
        prettyTime(record.started_at),
        record.status,
        ["Present", "Late"].includes(record.status) && record.marked_at ? prettyTime(record.marked_at) : "—",
        record.marked_by === "qr" ? "QR scan" : "Instructor",
      ]);
      row.getCell(2).numFmt = "mmm d, yyyy";
      const tone = ATTENDANCE_STATUSES[record.status];
      if (tone) {
        row.getCell(4).font = { bold: true, color: { argb: tone.color } };
        row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fill } };
      }
    });
  } else {
    worksheet.addRow(["No sessions yet."]);
  }
  styleTableRows(worksheet, 13);
  worksheet.views = [{ state: "frozen", ySplit: 12 }];
  return workbook;
}

export async function instructorWorkbook(data) {
  const workbook = await createWorkbook();
  const worksheet = workbook.addWorksheet("Class Attendance");
  const columnCount = data.sessions.length + 8;
  addTitle(worksheet, "Class Attendance", columnCount);

  const metadata = [
    ["Subject", data.class.subject],
    ["Section / Code", `${data.class.section} · ${data.class.class_code}`],
    ["Schedule", data.class.schedule],
    ["Legend", "P = Present · L = Late · E = Excused · A = Absent"],
  ];
  metadata.forEach(([label, value], index) => {
    const row = worksheet.getRow(index + 4);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, color: { argb: NAVY } };
    row.getCell(2).value = value || "—";
    if (columnCount > 2) {
      worksheet.mergeCells(row.number, 2, row.number, columnCount);
    }
  });

  worksheet.columns = [
    { width: 7 },
    { width: 18 },
    { width: 28 },
    ...data.sessions.map(() => ({ width: 14 })),
    { width: 11 },
    { width: 11 },
    { width: 11 },
    { width: 11 },
    { width: 12 },
  ];

  const headers = [
    "#",
    "Student ID",
    "Name",
    ...data.sessions.map((session) => {
      const date = fromISO(session.session_date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return `${date}\n${prettyTime(session.started_at)}`;
    }),
    "Present",
    "Late",
    "Excused",
    "Absent",
    "Rate",
  ];
  const header = worksheet.getRow(10);
  header.values = headers;
  styleHeader(header);
  if (data.sessions.length) header.height = 36;

  if (data.students.length) {
    data.students.forEach((student, index) => {
      const statuses = data.sessions.map((session) => student.statuses[String(session.id)] || "Absent");
      const counts = countStatuses(statuses, (status) => status);
      const rate = data.sessions.length ? counts.Present / data.sessions.length : null;
      const row = worksheet.addRow([
        index + 1,
        student.student_id_number,
        student.full_name,
        ...statuses.map((status) => ATTENDANCE_STATUSES[status]?.short || status),
        counts.Present,
        counts.Late,
        counts.Excused,
        counts.Absent,
        rate,
      ]);
      row.getCell(data.sessions.length + 8).numFmt = "0.0%";
      data.sessions.forEach((session, sessionIndex) => {
        const status = statuses[sessionIndex];
        const tone = ATTENDANCE_STATUSES[status];
        if (tone) {
          row.getCell(sessionIndex + 4).font = { bold: true, color: { argb: tone.color } };
          row.getCell(sessionIndex + 4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fill } };
        }
      });
    });
  } else {
    worksheet.addRow(["No enrolled students yet."]);
  }

  styleTableRows(worksheet, 11);
  worksheet.views = [{ state: "frozen", ySplit: 10, xSplit: 3 }];
  return workbook;
}

export async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function safeFileName(value) {
  return String(value || "class").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "class";
}
