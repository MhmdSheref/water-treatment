/**
 * Multi-Objective Optimization (Equation 11 from Math-7 Model)
 * 
 * min Z = α·Cost(x) + β·SEC(x) − γ·NutrientRecovery(x)
 * Subject to: P_new(x) ≤ S + ε
 * 
 * Uses javascript-lp-solver for Mixed-Integer Linear Programming.
 */
const solver = require('javascript-lp-solver');

/**
 * Define candidate upgrade options with their properties.
 * Each candidate has: cost, energy (SEC contribution), nutrient recovery fraction,
 * and removal efficiencies for each parameter.
 */
const DEFAULT_CANDIDATES = [
    {
        id: 'activated_sludge',
        name: 'Activated Sludge Upgrade',
        type: 'biological',
        cost: 150000,        // CAPEX + OPEX estimate (USD)
        sec: 0.6,            // kWh/m3
        nutrientRecovery: 0.3,
        removal: { BOD: 0.85, COD: 0.80, TSS: 0.70, TN: 0.40, TP: 0.25 }
    },
    {
        id: 'mbr',
        name: 'Membrane Bioreactor (MBR)',
        type: 'biological+membrane',
        cost: 350000,
        sec: 1.2,
        nutrientRecovery: 0.2,
        removal: { BOD: 0.95, COD: 0.92, TSS: 0.99, TN: 0.60, TP: 0.50 }
    },
    {
        id: 'chemical_precip',
        name: 'Chemical Precipitation',
        type: 'chemical',
        cost: 80000,
        sec: 0.15,
        nutrientRecovery: 0.1,
        removal: { BOD: 0.20, COD: 0.30, TSS: 0.60, TN: 0.10, TP: 0.80, heavy_metals: 0.90 }
    },
    {
        id: 'uf_membrane',
        name: 'Ultrafiltration (UF)',
        type: 'membrane',
        cost: 200000,
        sec: 0.5,
        nutrientRecovery: 0.15,
        removal: { BOD: 0.60, COD: 0.55, TSS: 0.95, TN: 0.20, TP: 0.40 }
    },
    {
        id: 'ro_membrane',
        name: 'Reverse Osmosis (RO)',
        type: 'membrane',
        cost: 500000,
        sec: 2.5,
        nutrientRecovery: 0.05,
        removal: { BOD: 0.98, COD: 0.97, TSS: 0.99, TN: 0.90, TP: 0.95, EC: 0.95, Na: 0.95, heavy_metals: 0.95 }
    },
    {
        id: 'constructed_wetland',
        name: 'Constructed Wetland',
        type: 'biological',
        cost: 100000,
        sec: 0.05,
        nutrientRecovery: 0.6,
        removal: { BOD: 0.70, COD: 0.60, TSS: 0.80, TN: 0.50, TP: 0.40 }
    },
    {
        id: 'uv_disinfection',
        name: 'UV Disinfection System',
        type: 'quaternary',
        cost: 120000,
        sec: 0.3,
        nutrientRecovery: 0.0,
        removal: { BOD: 0.05, COD: 0.05, TSS: 0.02, TN: 0.02, TP: 0.01, pathogens: 0.9999 }
    }
];

/**
 * Run MILP optimization to find the best upgrade combination.
 * 
 * @param {Object} plantState - Current effluent { BOD, COD, TSS, TN, TP, ... }
 * @param {Object} standards - Standard limits S
 * @param {Object} tolerances - Tolerance vector ε  
 * @param {Object} optWeights - { alpha, beta, gamma } optimization weights
 * @param {Array} candidates - Candidate retrofits (default: DEFAULT_CANDIDATES)
 * @returns {Object} Optimization result
 */
function optimizeUpgrade(plantState, standards, tolerances, optWeights, candidates) {
    candidates = candidates || DEFAULT_CANDIDATES;
    const { alpha = 0.4, beta = 0.35, gamma = 0.25 } = optWeights || {};

    // Normalize cost and SEC for comparable scaling
    const maxCost = Math.max(...candidates.map(c => c.cost));
    const maxSec = Math.max(...candidates.map(c => c.sec));

    // Build LP model
    const model = {
        optimize: 'objective',
        opType: 'min',
        constraints: {},
        variables: {},
        ints: {}
    };

    // Add compliance constraints for each non-compliant parameter
    for (const param of Object.keys(standards)) {
        const current = plantState[param];
        const limit = standards[param];
        const tol = tolerances[param] || 0;
        if (current && current > limit + tol) {
            // Required removal to bring to compliance: current * (1 - Σ removal_j * x_j) ≤ limit + tol
            // Rearranged: Σ removal_j * x_j ≥ 1 - (limit + tol) / current
            const requiredRemoval = 1 - (limit + tol) / current;
            if (requiredRemoval > 0) {
                model.constraints[`comply_${param}`] = { min: requiredRemoval };
            }
        }
    }

    // At least one upgrade must be selected
    model.constraints['min_upgrades'] = { min: 1 };
    // At most 3 upgrades (practical limit)
    model.constraints['max_upgrades'] = { max: 3 };

    // Define variables (one per candidate)
    for (const cand of candidates) {
        const normCost = cand.cost / maxCost;
        const normSec = cand.sec / maxSec;

        const variable = {
            objective: alpha * normCost + beta * normSec - gamma * cand.nutrientRecovery,
            min_upgrades: 1,
            max_upgrades: 1
        };

        // Add removal contributions to compliance constraints
        for (const param of Object.keys(standards)) {
            if (model.constraints[`comply_${param}`]) {
                variable[`comply_${param}`] = cand.removal[param] || 0;
            }
        }

        model.variables[cand.id] = variable;
        model.ints[cand.id] = 1; // Binary integer variable
    }

    // Solve
    const result = solver.Solve(model);

    // Extract selected upgrades
    const selectedUpgrades = [];
    let totalCost = 0;
    let totalSec = 0;
    let totalNutrientRecovery = 0;

    for (const cand of candidates) {
        if (result[cand.id] && result[cand.id] > 0.5) {
            selectedUpgrades.push(cand);
            totalCost += cand.cost;
            totalSec += cand.sec;
            totalNutrientRecovery += cand.nutrientRecovery;
        }
    }

    // Compute expected new effluent after upgrades
    const projectedEffluent = {};
    for (const param of Object.keys(plantState)) {
        let remaining = plantState[param] || 0;
        for (const upgrade of selectedUpgrades) {
            const removal = upgrade.removal[param] || 0;
            remaining = remaining * (1 - removal);
        }
        projectedEffluent[param] = Math.round(remaining * 100) / 100;
    }

    return {
        feasible: result.feasible !== false,
        selectedUpgrades: selectedUpgrades.map(u => ({
            id: u.id,
            name: u.name,
            type: u.type,
            cost: u.cost,
            sec: u.sec,
            nutrientRecovery: u.nutrientRecovery
        })),
        totalCost,
        totalSec: Math.round(totalSec * 1000) / 1000,
        totalNutrientRecovery: Math.round(totalNutrientRecovery * 100) / 100,
        projectedEffluent,
        objectiveValue: result.result
    };
}

module.exports = { optimizeUpgrade, DEFAULT_CANDIDATES };
