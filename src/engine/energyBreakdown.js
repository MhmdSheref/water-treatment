/**
 * Energy Breakdown (Equations 7-9 from Mathematical Model)
 * 
 * SEC = P_total / V
 * P_total = P_aeration + P_pumps + P_membranes + P_auxiliary
 * P_pump = (ρ·g·Q·H) / η
 */

/**
 * Compute Specific Energy Consumption.
 * SEC (kWh/m3) = P_total (kW) / V (m3/h)
 * @param {number} Ptotal - Total power in kW
 * @param {number} V - Volumetric flow rate in m3/h
 * @returns {number} SEC in kWh/m3
 */
function computeSEC(Ptotal, V) {
    if (!V || V <= 0) return null;
    return Math.round((Ptotal / V) * 1000) / 1000;
}

/**
 * Compute pump power.
 * P_pump = (ρ·g·Q·H) / η
 * @param {number} rho - Fluid density (kg/m3), default 1000
 * @param {number} g - Gravity (m/s2), default 9.81
 * @param {number} Q - Flow rate (m3/s)  NOTE: convert from m3/h externally
 * @param {number} H - Dynamic head (m)
 * @param {number} eta - Pump efficiency (fraction, e.g. 0.70)
 * @returns {number} Power in Watts
 */
function computePumpPower(rho, g, Q, H, eta) {
    if (!eta || eta <= 0) return null;
    return (rho * g * Q * H) / eta;
}

/**
 * Compute total power from component breakdown.
 * P_total = P_aeration + P_pumps + P_membranes + P_auxiliary
 * @param {Object} components - { aeration, pumps, membranes, auxiliary } in kW
 * @returns {number} Total power in kW
 */
function computeTotalPower(components) {
    const { aeration = 0, pumps = 0, membranes = 0, auxiliary = 0 } = components;
    return aeration + pumps + membranes + auxiliary;
}

module.exports = { computeSEC, computePumpPower, computeTotalPower };
