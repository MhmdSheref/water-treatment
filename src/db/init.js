const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

let db;

function getDb() {
    if (db) return db;

    const dbPath = process.env.DB_PATH || './data/water_dst.db';
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Run schema
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    db.exec(schema);

    // Seed default users if none exist
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount === 0) {
        const insertUser = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
        insertUser.run('admin', bcrypt.hashSync('admin123', 10), 'admin');
        insertUser.run('tech', bcrypt.hashSync('tech123', 10), 'technician');
        console.log('[DB] Seeded default users: admin, tech');
    }

    // Seed default config if none exist
    const configCount = db.prepare('SELECT COUNT(*) as count FROM system_config').get().count;
    if (configCount === 0) {
        const insertConfig = db.prepare('INSERT INTO system_config (key, value, description) VALUES (?, ?, ?)');

        // Egyptian Code standards (ECP 501-2015) for agricultural reuse
        const defaults = [
            ['standards_BOD', '40', 'BOD limit (mg/L) - Egyptian Code for Agricultural Reuse'],
            ['standards_COD', '80', 'COD limit (mg/L) - Egyptian Code for Agricultural Reuse'],
            ['standards_TSS', '40', 'TSS limit (mg/L) - Egyptian Code for Agricultural Reuse'],
            ['standards_TN', '30', 'Total Nitrogen limit (mg/L)'],
            ['standards_TP', '8', 'Total Phosphorus limit (mg/L)'],
            ['standards_pH_min', '6.5', 'Minimum pH'],
            ['standards_pH_max', '8.5', 'Maximum pH'],
            ['standards_EC', '3.0', 'Electrical Conductivity limit (dS/m)'],
            ['standards_Na', '230', 'Sodium limit (mg/L)'],
            ['standards_heavy_metals', '0.1', 'Heavy metals limit (mg/L)'],

            // LoD values (Limit of Detection)
            ['lod_BOD', '2', 'BOD Limit of Detection (mg/L)'],
            ['lod_COD', '5', 'COD Limit of Detection (mg/L)'],
            ['lod_TSS', '2', 'TSS Limit of Detection (mg/L)'],
            ['lod_TN', '1', 'TN Limit of Detection (mg/L)'],
            ['lod_TP', '0.5', 'TP Limit of Detection (mg/L)'],
            ['lod_EC', '0.01', 'EC Limit of Detection (dS/m)'],
            ['lod_Na', '1', 'Na Limit of Detection (mg/L)'],
            ['lod_heavy_metals', '0.005', 'Heavy metals Limit of Detection (mg/L)'],

            // AHP Weights for WQI (must sum to 1)
            ['weight_BOD', '0.20', 'AHP weight for BOD in WQI'],
            ['weight_COD', '0.15', 'AHP weight for COD in WQI'],
            ['weight_TSS', '0.10', 'AHP weight for TSS in WQI'],
            ['weight_TN', '0.12', 'AHP weight for TN in WQI'],
            ['weight_TP', '0.08', 'AHP weight for TP in WQI'],
            ['weight_pH', '0.05', 'AHP weight for pH in WQI'],
            ['weight_EC', '0.12', 'AHP weight for EC in WQI'],
            ['weight_Na', '0.10', 'AHP weight for Na in WQI'],
            ['weight_heavy_metals', '0.08', 'AHP weight for heavy metals in WQI'],

            // Engineering parameters (Appendix A defaults)
            ['k_BOD', '0.5', 'First-order decay constant for BOD (h^-1), range 0.3-0.8'],
            ['membrane_flux_UF', '0.03', 'UF membrane flux (m3/m2·h), range 0.02-0.04'],
            ['membrane_flux_RO', '0.02', 'RO membrane flux (m3/m2·h)'],
            ['pump_efficiency', '0.70', 'Pump efficiency (fraction), range 0.6-0.75'],
            ['operating_hours', '20', 'Operating hours per day for membranes'],
            ['fluid_density', '1000', 'Fluid density (kg/m3)'],
            ['gravity', '9.81', 'Gravitational acceleration (m/s2)'],

            // Optimization weights (alpha + beta + gamma = 1)
            ['opt_alpha', '0.4', 'Cost weight in MILP optimization'],
            ['opt_beta', '0.35', 'Energy weight in MILP optimization'],
            ['opt_gamma', '0.25', 'Nutrient recovery weight in MILP optimization'],
        ];

        const transaction = db.transaction(() => {
            for (const [key, value, desc] of defaults) {
                insertConfig.run(key, value, desc);
            }
        });
        transaction();
        console.log('[DB] Seeded default configuration parameters');
    }

    console.log('[DB] Database initialized at', dbPath);
    return db;
}

function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = { getDb, closeDb };
