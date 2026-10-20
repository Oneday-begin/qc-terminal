-- QC Terminal schema (MySQL 8 / TiDB / MariaDB 10.5+)
-- The API also creates/migrates this table automatically on boot,
-- so running this file by hand is optional.

CREATE DATABASE IF NOT EXISTS qc_terminal;
USE qc_terminal;

CREATE TABLE IF NOT EXISTS qc_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  serial_number CHAR(7) NOT NULL,
  batch_number CHAR(4) NOT NULL,
  uid_number CHAR(3) NOT NULL,
  timestamp DATETIME(3) NOT NULL,
  test_station VARCHAR(120) NOT NULL,
  is_retest TINYINT(1) NOT NULL DEFAULT 0,
  overall_status ENUM('PASS','FAIL') NOT NULL,
  qm_status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  qm_remark TEXT NULL,
  qm_reviewed_by VARCHAR(64) NULL,
  qm_reviewed_at DATETIME(3) NULL,
  notes TEXT NULL,
  plug_socket ENUM('Pass','NotConfirmed') NOT NULL,
  plug_socket_remark TEXT NULL,
  seal ENUM('Pass','NotConfirmed') NOT NULL,
  seal_remark TEXT NULL,
  visual ENUM('Pass','NotConfirmed') NOT NULL,
  visual_remark TEXT NULL,
  insert_glue ENUM('Pass','NotConfirmed') NOT NULL,
  insert_glue_remark TEXT NULL,
  rotation ENUM('Pass','NotConfirmed') NOT NULL,
  rotation_remark TEXT NULL,
  labelling ENUM('Pass','NotConfirmed') NOT NULL,
  labelling_remark TEXT NULL,
  serial_number_check ENUM('Pass','NotConfirmed') NOT NULL,
  serial_number_check_remark TEXT NULL,
  resistance DECIMAL(5,2) NOT NULL,
  resistance_verified ENUM('Pass','Fail') NOT NULL,
  moulding ENUM('Cream','Brown Transparent') NOT NULL,
  golden_coating ENUM('Bright','Dull') NOT NULL,
  created_by VARCHAR(64) NULL,
  updated_by VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_qc_logs_serial_number (serial_number),
  KEY idx_qc_logs_timestamp (timestamp, id),
  KEY idx_qc_logs_station_timestamp (test_station, timestamp, id)
);

-- Upgrading an existing database created from the old schema?
-- (The API does this for you on startup; shown here for reference.)
-- ALTER TABLE qc_logs ADD COLUMN qm_status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING';
-- ALTER TABLE qc_logs ADD COLUMN qm_remark TEXT NULL;
-- ALTER TABLE qc_logs ADD COLUMN qm_reviewed_by VARCHAR(64) NULL;
-- ALTER TABLE qc_logs ADD COLUMN qm_reviewed_at DATETIME(3) NULL;
-- ALTER TABLE qc_logs ADD COLUMN created_by VARCHAR(64) NULL;
-- ALTER TABLE qc_logs ADD COLUMN updated_by VARCHAR(64) NULL;
