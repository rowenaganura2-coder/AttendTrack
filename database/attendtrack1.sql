-- AttendTrack database for BSIT 3G, NEMSU Cantilan Campus
-- Import this file in phpMyAdmin (Import tab) or run:
--   mysql -u root -p < attendtrack1.sql

CREATE DATABASE IF NOT EXISTS `attendtrack1` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `attendtrack1`;

-- 1. Users (cookie session auth; no JWT)
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `role` ENUM('student', 'instructor') NOT NULL,
  `full_name` VARCHAR(150) NOT NULL,
  `username` VARCHAR(150) NOT NULL UNIQUE,
  `student_id_number` VARCHAR(30) NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Classes
CREATE TABLE IF NOT EXISTS `classes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `instructor_id` INT NOT NULL,
  `subject` VARCHAR(200) NOT NULL,
  `section` VARCHAR(50) NOT NULL DEFAULT 'INF3G',
  `class_code` CHAR(6) NOT NULL UNIQUE,
  `schedule` VARCHAR(150) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`instructor_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 3. Master classlist (official roster uploaded by the instructor)
CREATE TABLE IF NOT EXISTS `classlist` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `class_id` INT NOT NULL,
  `student_id_number` VARCHAR(30) NOT NULL,
  `full_name` VARCHAR(150) NOT NULL,
  UNIQUE KEY `uq_class_student` (`class_id`, `student_id_number`),
  FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 4. Enrollments (validated against the classlist)
CREATE TABLE IF NOT EXISTS `enrollments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `class_id` INT NOT NULL,
  `student_user_id` INT NOT NULL,
  `enrolled_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_enrollment` (`class_id`, `student_user_id`),
  FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`student_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 5. Sessions (multiple meetings per class per day are allowed)
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `class_id` INT NOT NULL,
  `session_date` DATE NOT NULL,
  `qr_secret` CHAR(32) NOT NULL UNIQUE,
  `qr_issued_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `started_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `ended_at` TIMESTAMP NULL,
  KEY `idx_session_class_date` (`class_id`, `session_date`),
  FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 6. Attendance logs
CREATE TABLE IF NOT EXISTS `attendance_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `session_id` INT NOT NULL,
  `student_user_id` INT NOT NULL,
  `status` ENUM('Present', 'Late', 'Excused', 'Absent') NOT NULL DEFAULT 'Absent',
  `marked_at` TIMESTAMP NULL,
  `marked_by` ENUM('qr', 'instructor') DEFAULT 'instructor',
  UNIQUE KEY `uq_att_log` (`session_id`, `student_user_id`),
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`student_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7. Excuse slip / medical certificate review workflow
CREATE TABLE IF NOT EXISTS `excuse_requests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `class_id` INT NOT NULL,
  `session_id` INT NOT NULL,
  `student_user_id` INT NOT NULL,
  `reason` TEXT NOT NULL,
  `file_path` VARCHAR(255) NOT NULL,
  `status` ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
  `reviewed_by` INT NULL,
  `reviewed_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_excuse_session_student` (`session_id`, `student_user_id`),
  FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`student_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB;
