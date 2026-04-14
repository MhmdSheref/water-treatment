/**
 * Admin Routes
 * All routes require admin role.
 * 
 * Updated to Math-7 Model equations:
 *   Eq 1: Deviation Vector
 *   Eq 2-3: WQI
 *   Eq 4: Removal Efficiency
 *   Eq 5: Reactor Sizing (HRT)
 *   Eq 6: UV Disinfection (Chick-Watson) — NEW
 *   Eq 7: Membrane Sizing (Darcy's Law) — UPDATED
 *   Eq 8-10: Energy Breakdown
 *   Eq 11: MILP Optimization
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/init');
const { authenticate, authorize } = require('../middleware/auth');
const { computeDeviation } = require('../engine/deviationVector');
const { computeWQI } = require('../engine/waterQualityIndex');
const { computeEfficiency, computeHRT, computeReactorVolume, computeMembraneArea, computeMembraneFlux, computeMembraneAreaDarcy } = require('../engine/removalEfficiency');
const { computeSEC, computePumpPower, computeTotalPower } = require('../engine/energyBreakdown');
const { computeUVDose, computeUVPower } = require('../engine/uvDisinfection');
const { optimizeUpgrade } = require('../engine/optimizer');
const { getRecommendations } = require('../engine/recommendations');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, authorize('admin'));

/**
 * Helper: load config from DB into structured objects
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
 * Run the full analysis pipeline on given plant data.
 * Implements Algorithm 1 from Math-7 Model.
 */
function runFullAnalysis(plantData, configOverrides) {
    const { config, standards, lod, weights } = loadConfig();

    // Apply any overrides
    const activeStandards = { ...standards, ...configOverrides?.standards };
    const activeLod = { ...lod, ...configOverrides?.lod };
    const activeWeights = { ...weights, ...configOverrides?.weights };

    // 1. Deviation Vector (Equation 1)
    const deviation = computeDeviation(plantData, activeStandards, activeLod);

    // 2. Water Quality Index (Equations 2-3)
    const wqi = computeWQI(plantData, activeStandards, activeWeights);

    // 3. Removal Efficiency (Equation 4)
    const efficiencies = {};
    if (plantData._influent) {
        for (const param of Object.keys(activeStandards)) {
            const cin = plantData._influent[param];
            const cout = plantData[param];
            if (cin !== undefined && cout !== undefined) {
                efficiencies[param] = computeEfficiency(cin, cout, activeLod[param] || 0);
            }
        }
    }

    // 4. Reactor Sizing — Equation 5 (biological) + Equation 6 (UV) + Equation 7 (membranes)
    const sizing = {};
    const flowRate = plantData.flow_rate || 500;
    const k = config.k_BOD || 0.5;

    // Darcy's Law membrane parameters (Equation 7)
    const darcy = {
        UF: {
            deltaP: parseFloat(config.darcy_deltaP_UF) || 200000,
            deltaPi: parseFloat(config.darcy_deltaPi_UF) || 0,
            mu: parseFloat(config.darcy_viscosity) || 0.001,
            Rt: parseFloat(config.darcy_Rt_UF) || 1.85e12
        },
        RO: {
            deltaP: parseFloat(config.darcy_deltaP_RO) || 1500000,
            deltaPi: parseFloat(config.darcy_deltaPi_RO) || 700000,
            mu: parseFloat(config.darcy_viscosity) || 0.001,
            Rt: parseFloat(config.darcy_Rt_RO) || 1.04e13
        }
    };

    // UV parameters (Equation 6 — Chick-Watson)
    const kUV = parseFloat(config.k_UV) || 0.2;
    const uvLampEta = parseFloat(config.uv_lamp_efficiency) || 0.3;

    if (deviation.nonCompliantParams.length > 0) {
        // Biological sizing for BOD/COD (Equation 5)
        if ((deviation.flags.BOD && plantData.BOD) || (deviation.flags.COD && plantData.COD)) {
            const organicParam = deviation.flags.BOD ? 'BOD' : 'COD';
            const cinOrg = plantData[organicParam];
            const targetOrg = activeStandards[organicParam];
            const hrt = computeHRT(cinOrg, targetOrg, k);
            const volume = computeReactorVolume(flowRate, hrt);
            sizing.biological = {
                parameter: organicParam,
                hrt_hours: hrt ? Math.round(hrt * 100) / 100 : null,
                reactor_volume_m3: volume ? Math.round(volume) : null
            };
        }

        // UV Disinfection sizing (Equation 6 — Chick-Watson)
        if (deviation.flags.pathogens && plantData.pathogens) {
            const N0 = plantData.pathogens;
            const Nt = activeStandards.pathogens || 200;
            const uvResult = computeUVDose(N0, Nt, kUV);
            sizing.uv = {
                initial_count: N0,
                target_count: Nt,
                dose_mJ_cm2: uvResult.dose_mJ_cm2,
                log_reduction: uvResult.logReduction,
                valid: uvResult.valid
            };
        }

        // Membrane sizing using Darcy's Law (Equation 7: Jw = (ΔP - Δπ) / (μ·Rt), A = Q/Jw)
        if (deviation.flags.TSS || deviation.flags.EC || deviation.flags.Na) {
            const ufResult = computeMembraneAreaDarcy(
                flowRate, darcy.UF.deltaP, darcy.UF.deltaPi, darcy.UF.mu, darcy.UF.Rt
            );
            const roResult = computeMembraneAreaDarcy(
                flowRate, darcy.RO.deltaP, darcy.RO.deltaPi, darcy.RO.mu, darcy.RO.Rt
            );

            sizing.membrane_uf = {
                area_m2: ufResult.area_m2 ? Math.round(ufResult.area_m2) : null,
                flux_m3_m2_h: ufResult.flux_m3_m2_h,
                method: 'Darcy\'s Law (Eq. 7)'
            };
            sizing.membrane_ro = {
                area_m2: roResult.area_m2 ? Math.round(roResult.area_m2) : null,
                flux_m3_m2_h: roResult.flux_m3_m2_h,
                method: 'Darcy\'s Law (Eq. 7)'
            };
        }
    }

    // 5. Energy Breakdown (Equations 8-10)
    const pumpEta = config.pump_efficiency || 0.70;
    const rho = config.fluid_density || 1000;
    const g = config.gravity || 9.81;
    const dynamicHead = plantData._dynamic_head || 15;

    const flowRateM3s = flowRate / 3600;
    const pumpPower = computePumpPower(rho, g, flowRateM3s, dynamicHead, pumpEta) / 1000; // W to kW

    // UV power component (from Equation 6 sizing)
    let uvPowerKW = 0;
    if (sizing.uv && sizing.uv.dose_mJ_cm2) {
        uvPowerKW = computeUVPower(sizing.uv.dose_mJ_cm2, flowRate, uvLampEta);
    }

    const energyComponents = {
        aeration: plantData._power_aeration || (flowRate * 0.02),
        pumps: pumpPower,
        membranes: sizing.membrane_uf?.area_m2 ? (sizing.membrane_uf.area_m2 * 0.005) : 0,
        uv: uvPowerKW,
        auxiliary: plantData._power_auxiliary || (flowRate * 0.005)
    };
    const totalPower = computeTotalPower(energyComponents);
    const sec = computeSEC(totalPower, flowRate);

    const energy = {
        components_kW: {
            aeration: Math.round(energyComponents.aeration * 100) / 100,
            pumps: Math.round(pumpPower * 100) / 100,
            membranes: Math.round(energyComponents.membranes * 100) / 100,
            uv: Math.round(uvPowerKW * 100) / 100,
            auxiliary: Math.round(energyComponents.auxiliary * 100) / 100
        },
        total_power_kW: Math.round(totalPower * 100) / 100,
        sec_kWh_per_m3: sec
    };

    // 6. Optimization (Equation 11)
    const optWeights = {
        alpha: config.opt_alpha || 0.4,
        beta: config.opt_beta || 0.35,
        gamma: config.opt_gamma || 0.25
    };
    const optimization = optimizeUpgrade(plantData, activeStandards, deviation.tolerances, optWeights);

    // 7. Recommendations
    const recommendations = getRecommendations(deviation.flags);

    return {
        timestamp: new Date().toISOString(),
        modelVersion: 'Math-7',
        deviation,
        wqi,
        efficiencies,
        sizing,
        energy,
        optimization,
        recommendations
    };
}

/**
 * POST /api/admin/simulate
 * Run a full simulation with provided plant data.
 */
router.post('/simulate', (req, res) => {
    try {
        const plantData = req.body;
        if (!plantData || Object.keys(plantData).length === 0) {
            return res.status(400).json({ error: 'Plant data is required' });
        }

        const result = runFullAnalysis(plantData);

        // Store simulation run
        const db = getDb();
        const simId = uuidv4();
        db.prepare('INSERT INTO simulation_runs (id, user_id, timestamp, input_json, result_json) VALUES (?, ?, ?, ?, ?)')
            .run(simId, req.user.id, result.timestamp, JSON.stringify(plantData), JSON.stringify(result));

        // Log event
        db.prepare('INSERT INTO event_log (id, user_id, event_type, details_json) VALUES (?, ?, ?, ?)')
            .run(uuidv4(), req.user.id, 'SIMULATION', JSON.stringify({ simulation_id: simId }));

        res.json({ simulationId: simId, ...result });
    } catch (err) {
        console.error('Simulation error:', err);
        res.status(500).json({ error: 'Simulation failed', details: err.message });
    }
});

/**
 * GET /api/admin/simulations
 * List past simulation runs.
 */
router.get('/simulations', (req, res) => {
    try {
        const db = getDb();
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const simulations = db.prepare(`
            SELECT s.id, s.timestamp, s.user_id, u.username,
                   s.input_json, s.result_json
            FROM simulation_runs s
            LEFT JOIN users u ON s.user_id = u.id
            ORDER BY s.timestamp DESC
            LIMIT ? OFFSET ?
        `).all(limit, offset);

        const total = db.prepare('SELECT COUNT(*) as count FROM simulation_runs').get().count;

        res.json({ simulations, total, limit, offset });
    } catch (err) {
        console.error('List simulations error:', err);
        res.status(500).json({ error: 'Failed to list simulations' });
    }
});

/**
 * GET /api/admin/simulations/:id
 * Get detailed simulation result.
 */
router.get('/simulations/:id', (req, res) => {
    try {
        const db = getDb();
        const sim = db.prepare(`
            SELECT s.*, u.username 
            FROM simulation_runs s 
            LEFT JOIN users u ON s.user_id = u.id 
            WHERE s.id = ?
        `).get(req.params.id);

        if (!sim) {
            return res.status(404).json({ error: 'Simulation not found' });
        }

        res.json({
            id: sim.id,
            timestamp: sim.timestamp,
            user: sim.username,
            input: JSON.parse(sim.input_json),
            result: JSON.parse(sim.result_json)
        });
    } catch (err) {
        console.error('Get simulation error:', err);
        res.status(500).json({ error: 'Failed to get simulation' });
    }
});

/**
 * POST /api/admin/recalculate
 * Re-run analysis with modified parameters (what-if scenario).
 */
router.post('/recalculate', (req, res) => {
    try {
        const { plantData, configOverrides } = req.body;
        if (!plantData) {
            return res.status(400).json({ error: 'plantData is required' });
        }

        const result = runFullAnalysis(plantData, configOverrides);

        // Log as recalculation event (not stored as simulation)
        const db = getDb();
        db.prepare('INSERT INTO event_log (id, user_id, event_type, details_json) VALUES (?, ?, ?, ?)')
            .run(uuidv4(), req.user.id, 'RECALCULATION', JSON.stringify({
                overrides: configOverrides || {},
                wqi: result.wqi.wqi,
                nonCompliant: result.deviation.nonCompliantParams
            }));

        res.json(result);
    } catch (err) {
        console.error('Recalculation error:', err);
        res.status(500).json({ error: 'Recalculation failed', details: err.message });
    }
});

/**
 * GET /api/admin/readings
 * Full sensor readings query for admin monitoring view.
 * Query params: from (ISO datetime), to (ISO datetime), limit (default 1000), hours (fallback if no from/to)
 */
router.get('/readings', (req, res) => {
    try {
        const db = getDb();
        const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);
        let rows;

        if (req.query.from || req.query.to) {
            const from = req.query.from || '1970-01-01';
            const to = req.query.to || new Date().toISOString();
            rows = db.prepare(`
                SELECT id, timestamp, pH, BOD, COD, TSS, TN, TP, flow_rate, temperature, EC, Na, heavy_metals, source
                FROM sensor_readings
                WHERE timestamp >= ? AND timestamp <= ?
                ORDER BY timestamp ASC
                LIMIT ?
            `).all(from, to, limit);
        } else {
            const hours = parseInt(req.query.hours) || 24;
            rows = db.prepare(`
                SELECT id, timestamp, pH, BOD, COD, TSS, TN, TP, flow_rate, temperature, EC, Na, heavy_metals, source
                FROM sensor_readings
                WHERE timestamp >= datetime('now', ?)
                ORDER BY timestamp ASC
                LIMIT ?
            `).all(`-${hours} hours`, limit);
        }

        // Summary stats for each param
        const params = ['pH', 'BOD', 'COD', 'TSS', 'TN', 'TP', 'flow_rate', 'temperature', 'EC', 'Na', 'heavy_metals'];
        const stats = {};
        if (rows.length > 0) {
            for (const p of params) {
                const vals = rows.map(r => r[p]).filter(v => v != null);
                if (vals.length) {
                    stats[p] = {
                        min: Math.round(Math.min(...vals) * 100) / 100,
                        max: Math.round(Math.max(...vals) * 100) / 100,
                        avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
                    };
                }
            }
        }

        res.json({ readings: rows, count: rows.length, stats });
    } catch (err) {
        console.error('Admin readings error:', err);
        res.status(500).json({ error: 'Failed to fetch readings' });
    }
});

/**
 * GET /api/admin/logs
 * Full event log + sensor readings history.
 */
router.get('/logs', (req, res) => {
    try {
        const db = getDb();
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const eventType = req.query.type;
        const from = req.query.from;
        const to = req.query.to;

        let query = 'SELECT e.*, u.username FROM event_log e LEFT JOIN users u ON e.user_id = u.id WHERE 1=1';
        const params = [];

        if (eventType) {
            query += ' AND e.event_type = ?';
            params.push(eventType);
        }
        if (from) {
            query += ' AND e.timestamp >= ?';
            params.push(from);
        }
        if (to) {
            query += ' AND e.timestamp <= ?';
            params.push(to);
        }

        query += ' ORDER BY e.timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const events = db.prepare(query).all(...params);
        const total = db.prepare('SELECT COUNT(*) as count FROM event_log').get().count;

        // Also get sensor readings count
        const sensorCount = db.prepare('SELECT COUNT(*) as count FROM sensor_readings').get().count;

        res.json({ events, total, sensorCount, limit, offset });
    } catch (err) {
        console.error('Logs error:', err);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

/**
 * GET /api/admin/config
 * View all system configuration.
 */
router.get('/config', (req, res) => {
    try {
        const db = getDb();
        const config = db.prepare('SELECT * FROM system_config ORDER BY key').all();
        res.json({ config });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch config' });
    }
});

/**
 * PUT /api/admin/config
 * Update system configuration.
 * Body: { key: value, ... }
 */
router.put('/config', (req, res) => {
    try {
        const updates = req.body;
        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        const db = getDb();
        const stmt = db.prepare('UPDATE system_config SET value = ?, updated_at = datetime(\'now\') WHERE key = ?');

        const transaction = db.transaction(() => {
            for (const [key, value] of Object.entries(updates)) {
                stmt.run(String(value), key);
            }
        });
        transaction();

        // Log event
        db.prepare('INSERT INTO event_log (id, user_id, event_type, details_json) VALUES (?, ?, ?, ?)')
            .run(uuidv4(), req.user.id, 'CONFIG_UPDATE', JSON.stringify(updates));

        const config = db.prepare('SELECT * FROM system_config ORDER BY key').all();
        res.json({ message: 'Configuration updated', config });
    } catch (err) {
        console.error('Config update error:', err);
        res.status(500).json({ error: 'Failed to update config' });
    }
});

module.exports = router;
module.exports.runFullAnalysis = runFullAnalysis;
