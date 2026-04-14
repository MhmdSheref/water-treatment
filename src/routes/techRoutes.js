/**
 * Technician Routes
 * Accessible by both technicians and admins.
 */
const express = require('express');
const { getDb } = require('../db/init');
const { authenticate, authorize } = require('../middleware/auth');
const { computeDeviation } = require('../engine/deviationVector');
const { computeWQI } = require('../engine/waterQualityIndex');
const { computeEfficiency } = require('../engine/removalEfficiency');
const { getQuickSuggestions } = require('../engine/recommendations');
const { getLatestReading, getRecentReadings } = require('../services/sensorService');

const router = express.Router();

// Technician routes accessible by both technician and admin roles
router.use(authenticate, authorize('technician', 'admin'));

/**
 * Helper: load config objects from DB
 */
function loadConfig() {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM system_config').all();
    const config = {};
    for (const row of rows) {
        config[row.key] = parseFloat(row.value) || row.value;
    }

    const standards = {};
    const lod = {};
    const weights = {};
    const params = ['BOD', 'COD', 'TSS', 'TN', 'TP', 'EC', 'Na', 'heavy_metals', 'pathogens'];

    for (const p of params) {
        if (config[`standards_${p}`] !== undefined) standards[p] = config[`standards_${p}`];
        if (config[`lod_${p}`] !== undefined) lod[p] = config[`lod_${p}`];
        if (config[`weight_${p}`] !== undefined) weights[p] = config[`weight_${p}`];
    }

    return { config, standards, lod, weights, params };
}

/**
 * GET /api/tech/dashboard
 * Current plant status with latest readings, compliance, and WQI.
 */
router.get('/dashboard', (req, res) => {
    try {
        const latest = getLatestReading();
        if (!latest) {
            return res.json({ message: 'No sensor data available yet', data: null });
        }

        const { standards, lod, weights } = loadConfig();

        // Build concentration object from reading
        const concentrations = {
            BOD: latest.BOD,
            COD: latest.COD,
            TSS: latest.TSS,
            TN: latest.TN,
            TP: latest.TP,
            EC: latest.EC,
            Na: latest.Na,
            heavy_metals: latest.heavy_metals,
            pathogens: latest.pathogens
        };

        // Run deviation analysis
        const deviation = computeDeviation(concentrations, standards, lod);

        // Compute WQI
        const wqi = computeWQI(concentrations, standards, weights);

        // Store compliance log entries
        const db = getDb();
        const insertCompliance = db.prepare(`
            INSERT INTO compliance_logs (reading_id, parameter, measured, standard_limit, tolerance, deviation, compliant)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const transaction = db.transaction(() => {
            for (const param of Object.keys(standards)) {
                insertCompliance.run(
                    latest.id,
                    param,
                    concentrations[param] || 0,
                    standards[param],
                    deviation.tolerances[param],
                    deviation.deviations[param],
                    deviation.flags[param] ? 0 : 1
                );
            }
        });
        transaction();

        res.json({
            timestamp: latest.timestamp,
            reading: {
                pH: latest.pH,
                temperature: latest.temperature,
                flow_rate: latest.flow_rate,
                ...concentrations
            },
            compliance: {
                overall: deviation.nonCompliantParams.length === 0,
                nonCompliantCount: deviation.nonCompliantParams.length,
                nonCompliantParams: deviation.nonCompliantParams,
                flags: deviation.flags,
                deviations: deviation.deviations
            },
            wqi: {
                score: wqi.wqi,
                interpretation: wqi.interpretation,
                ratings: wqi.ratings
            }
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ error: 'Failed to load dashboard' });
    }
});

/**
 * GET /api/tech/readings
 * Recent sensor reading history.
 */
router.get('/readings', (req, res) => {
    try {
        const hours = parseInt(req.query.hours) || 24;
        const limit = parseInt(req.query.limit) || 100;
        const readings = getRecentReadings(hours, limit);
        res.json({ readings, count: readings.length });
    } catch (err) {
        console.error('Readings error:', err);
        res.status(500).json({ error: 'Failed to fetch readings' });
    }
});

/**
 * GET /api/tech/suggestions
 * Quick actionable suggestions based on latest deviation analysis.
 */
router.get('/suggestions', (req, res) => {
    try {
        const latest = getLatestReading();
        if (!latest) {
            return res.json({ suggestions: [], message: 'No data available for analysis' });
        }

        const { standards, lod } = loadConfig();
        const concentrations = {
            BOD: latest.BOD,
            COD: latest.COD,
            TSS: latest.TSS,
            TN: latest.TN,
            TP: latest.TP,
            EC: latest.EC,
            Na: latest.Na,
            heavy_metals: latest.heavy_metals,
            pathogens: latest.pathogens
        };

        const deviation = computeDeviation(concentrations, standards, lod);
        const suggestions = getQuickSuggestions(deviation.flags);

        res.json({ suggestions, analysisTimestamp: new Date().toISOString() });
    } catch (err) {
        console.error('Suggestions error:', err);
        res.status(500).json({ error: 'Failed to generate suggestions' });
    }
});

/**
 * GET /api/tech/readings/history
 * Sensor readings in ascending chronological order — ideal for Chart.js.
 * Query params: hours (default 1), limit (default 120)
 */
router.get('/readings/history', (req, res) => {
    try {
        const hours = parseInt(req.query.hours) || 1;
        const limit = parseInt(req.query.limit) || 120;
        const db = getDb();
        const rows = db.prepare(`
            SELECT id, timestamp, pH, BOD, COD, TSS, TN, TP, flow_rate, temperature, EC, Na, heavy_metals
            FROM sensor_readings
            WHERE timestamp >= datetime('now', ?)
            ORDER BY timestamp ASC
            LIMIT ?
        `).all(`-${hours} hours`, limit);
        res.json({ readings: rows, hours, count: rows.length });
    } catch (err) {
        console.error('Readings history error:', err);
        res.status(500).json({ error: 'Failed to fetch readings history' });
    }
});

/**
 * GET /api/tech/alerts
 * Active compliance alerts.
 */
router.get('/alerts', (req, res) => {
    try {
        const latest = getLatestReading();
        if (!latest) {
            return res.json({ alerts: [], message: 'No data available' });
        }

        const { standards, lod } = loadConfig();
        const concentrations = {
            BOD: latest.BOD,
            COD: latest.COD,
            TSS: latest.TSS,
            TN: latest.TN,
            TP: latest.TP,
            EC: latest.EC,
            Na: latest.Na,
            heavy_metals: latest.heavy_metals,
            pathogens: latest.pathogens
        };

        const deviation = computeDeviation(concentrations, standards, lod);

        const alerts = deviation.nonCompliantParams.map(param => ({
            parameter: param,
            measured: concentrations[param],
            limit: standards[param],
            tolerance: deviation.tolerances[param],
            deviation: deviation.deviations[param],
            severity: deviation.deviations[param] > (standards[param] * 0.5) ? 'critical' :
                      deviation.deviations[param] > (standards[param] * 0.2) ? 'warning' : 'info',
            timestamp: latest.timestamp
        }));

        res.json({ alerts, readingId: latest.id });
    } catch (err) {
        console.error('Alerts error:', err);
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
});

module.exports = router;
