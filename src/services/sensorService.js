/**
 * Placeholder Sensor Data Service
 * 
 * Generates realistic synthetic sensor readings for a municipal
 * wastewater treatment plant. This is the SINGLE INTEGRATION POINT
 * for future real sensor data.
 * 
 * Future upgrade: Set SENSOR_MODE=live and implement an adapter
 * (Modbus, MQTT, REST) that exports a readSensor() function with
 * the same return shape.
 */

const { getDb } = require('../db/init');
const { v4: uuidv4 } = require('uuid');

// Typical municipal wastewater ranges (partially treated effluent)
const BASELINE = {
    pH: { mean: 7.2, stddev: 0.3, min: 6.0, max: 9.0 },
    BOD: { mean: 45, stddev: 12, min: 5, max: 120 },
    COD: { mean: 90, stddev: 20, min: 15, max: 250 },
    TSS: { mean: 38, stddev: 10, min: 5, max: 100 },
    TN: { mean: 28, stddev: 6, min: 5, max: 60 },
    TP: { mean: 7, stddev: 2, min: 1, max: 20 },
    flow_rate: { mean: 500, stddev: 80, min: 100, max: 1200 },
    temperature: { mean: 25, stddev: 3, min: 15, max: 40 },
    EC: { mean: 2.5, stddev: 0.5, min: 0.5, max: 6.0 },
    Na: { mean: 180, stddev: 40, min: 50, max: 400 },
    heavy_metals: { mean: 0.08, stddev: 0.03, min: 0.01, max: 0.5 },
    pathogens: { mean: 5000, stddev: 2000, min: 100, max: 20000 }
};

/**
 * Generate a random value using Box-Muller transform (normal distribution).
 */
function gaussian(mean, stddev) {
    let u1 = Math.random();
    let u2 = Math.random();
    let z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z * stddev;
}

/**
 * Generate a single sensor reading with realistic variation.
 * @returns {Object} Sensor reading object
 */
function generateReading() {
    const reading = {};
    for (const [param, config] of Object.entries(BASELINE)) {
        let value = gaussian(config.mean, config.stddev);
        value = Math.max(config.min, Math.min(config.max, value));
        reading[param] = Math.round(value * 100) / 100;
    }
    return reading;
}

/**
 * Store a sensor reading in the database.
 * @param {Object} reading - Sensor reading to store
 * @returns {number} ID of the inserted reading
 */
function storeReading(reading) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO sensor_readings (pH, BOD, COD, TSS, TN, TP, flow_rate, temperature, EC, Na, heavy_metals, pathogens, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
        reading.pH, reading.BOD, reading.COD, reading.TSS,
        reading.TN, reading.TP, reading.flow_rate, reading.temperature,
        reading.EC, reading.Na, reading.heavy_metals, reading.pathogens,
        process.env.SENSOR_MODE || 'placeholder'
    );
    return result.lastInsertRowid;
}

/**
 * Get the latest sensor reading from the database.
 */
function getLatestReading() {
    const db = getDb();
    return db.prepare('SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 1').get() || null;
}

/**
 * Get recent sensor readings.
 * @param {number} hours - Number of hours to look back (default 24)
 * @param {number} limit - Maximum number of readings (default 100)
 */
function getRecentReadings(hours = 24, limit = 100) {
    const db = getDb();
    return db.prepare(`
        SELECT * FROM sensor_readings 
        WHERE timestamp >= datetime('now', ?)
        ORDER BY timestamp DESC LIMIT ?
    `).all(`-${hours} hours`, limit);
}

let collectionInterval = null;

/**
 * Start automatic sensor data collection.
 * @param {number} intervalMs - Collection interval in milliseconds
 */
function startAutoCollection(intervalMs = 60000) {
    if (collectionInterval) clearInterval(collectionInterval);

    // Generate an initial reading immediately
    const reading = generateReading();
    storeReading(reading);
    console.log('[Sensor] Initial reading collected');

    collectionInterval = setInterval(() => {
        try {
            const reading = generateReading();
            storeReading(reading);
            console.log('[Sensor] Reading collected at', new Date().toISOString());
        } catch (err) {
            console.error('[Sensor] Error collecting reading:', err.message);
        }
    }, intervalMs);

    console.log(`[Sensor] Auto-collection started (every ${intervalMs / 1000}s)`);
}

function stopAutoCollection() {
    if (collectionInterval) {
        clearInterval(collectionInterval);
        collectionInterval = null;
        console.log('[Sensor] Auto-collection stopped');
    }
}

module.exports = {
    generateReading,
    storeReading,
    getLatestReading,
    getRecentReadings,
    startAutoCollection,
    stopAutoCollection,
    BASELINE
};
