CREATE DATABASE IF NOT EXISTS solar_tracker;
USE solar_tracker;

-- Drop tables in reverse order of foreign keys for safety if rerun
DROP TABLE IF EXISTS alert_log;
DROP TABLE IF EXISTS tracker_readings;
DROP TABLE IF EXISTS users;

-- 1. Users table
CREATE TABLE users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(150) UNIQUE NOT NULL,
    password      VARCHAR(255) NOT NULL,
    role          ENUM('user', 'admin') DEFAULT 'user',
    device_id     VARCHAR(50) DEFAULT '2207062',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tracker readings table
CREATE TABLE tracker_readings (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id     VARCHAR(50) NOT NULL,
    user_id       INT,
    voltage       FLOAT,
    current_a     FLOAT,
    power         FLOAT,
    pan_angle     TINYINT UNSIGNED,
    tilt_angle    TINYINT UNSIGNED,
    ldr_tl        SMALLINT UNSIGNED,
    ldr_tr        SMALLINT UNSIGNED,
    ldr_bl        SMALLINT UNSIGNED,
    ldr_br        SMALLINT UNSIGNED,
    efficiency    FLOAT,
    recorded_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_device_time (device_id, recorded_at),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 3. Alert log table
CREATE TABLE alert_log (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    device_id     VARCHAR(50),
    user_id       INT,
    level         ENUM('info', 'warning', 'error') DEFAULT 'info',
    message       TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Seed default test users
-- The passwords here are pre-hashed bcrypt values for 'admin123' and 'user123':
-- admin123 -> $2a$10$U4KvxR0b/Kky6WqB6Xy6O.G83L6GzIeW4Pq6rT53PjP42dD8b/m0W
-- user123  -> $2a$10$tJ08/3Z1R2C/yC2.L2bSruB1yNq7.yK9oW6OaG0uPjP42dD8b/m0W
INSERT INTO users (name, email, password, role, device_id) VALUES 
('Admin User', 'admin@tracker.com', '$2a$10$k3ewfsMlmcBCNlDo14egNeefd0Bww5bC3nqmx4YK/Uh4VXuH1n9f.', 'admin', '2207062'),
('Regular User', 'user@tracker.com', '$2a$10$u8bq4KhptEDlVhkIYtseX.9EXdL2GbJ43bjcRVv5GdRfPSQEF.RSm', 'user', '2207062');
