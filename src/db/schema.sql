-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'technician')),
    created_at TEXT DEFAULT (datetime('now'))
);

-- Sensor readings time-series
CREATE TABLE IF NOT EXISTS sensor_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    pH REAL,
    BOD REAL,
    COD REAL,
    TSS REAL,
    TN REAL,
    TP REAL,
    flow_rate REAL,
    temperature REAL,
    EC REAL,
    Na REAL,
    heavy_metals REAL,
    pathogens REAL,
    source TEXT DEFAULT 'placeholder'
);

-- Compliance check logs
CREATE TABLE IF NOT EXISTS compliance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reading_id INTEGER REFERENCES sensor_readings(id),
    timestamp TEXT DEFAULT (datetime('now')),
    parameter TEXT NOT NULL,
    measured REAL NOT NULL,
    standard_limit REAL NOT NULL,
    tolerance REAL NOT NULL,
    deviation REAL NOT NULL,
    compliant INTEGER NOT NULL
);

-- Admin simulation runs
CREATE TABLE IF NOT EXISTS simulation_runs (
    id TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    timestamp TEXT DEFAULT (datetime('now')),
    input_json TEXT NOT NULL,
    result_json TEXT NOT NULL
);

-- General audit event log
CREATE TABLE IF NOT EXISTS event_log (
    id TEXT PRIMARY KEY,
    timestamp TEXT DEFAULT (datetime('now')),
    user_id INTEGER,
    event_type TEXT NOT NULL,
    details_json TEXT
);

-- System configuration key-value store
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);
