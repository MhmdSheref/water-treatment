/**
 * Removal Efficiency & Reactor Sizing (Equations 4-6 from Mathematical Model)
 * 
 * E = (C_in - C_out) / C_in × 100  (guarded by C_in > LoD)
 * HRT = (1/k) × ln(C_in / C_out), V_reactor = Q × HRT
 * A = Q / (J × Oh)
 */

/**
 * Compute removal efficiency for a parameter.
 * @param {number} Cin - Influent concentration 
 * @param {number} Cout - Effluent concentration
 * @param {number} LoD - Limit of Detection
 * @returns {{ efficiency: number|null, valid: boolean }}
 */
function computeEfficiency(Cin, Cout, LoD = 0) {
    if (Cin <= LoD) {
        return { efficiency: null, valid: false, reason: 'Influent concentration at or below LoD' };
    }
    const E = ((Cin - Cout) / Cin) * 100;
    return { efficiency: Math.round(E * 100) / 100, valid: true };
}

/**
 * Compute Hydraulic Retention Time (HRT) for biological upgrade.
 * Assumes first-order decay: HRT = (1/k) × ln(C_in / C_out)
 * @param {number} Cin - Influent concentration (mg/L)
 * @param {number} Cout - Target effluent concentration (mg/L)
 * @param {number} k - First-order decay constant (h^-1)
 * @returns {number} HRT in hours
 */
function computeHRT(Cin, Cout, k) {
    if (Cout <= 0 || Cin <= 0 || k <= 0) return null;
    return (1 / k) * Math.log(Cin / Cout);
}

/**
 * Compute required reactor volume.
 * V_reactor = Q × HRT
 * @param {number} Q - Flow rate (m3/h)
 * @param {number} HRT - Hydraulic Retention Time (h)
 * @returns {number} Volume in m3
 */
function computeReactorVolume(Q, HRT) {
    if (!Q || !HRT) return null;
    return Q * HRT;
}

/**
 * Compute required membrane area.
 * A = Q / (J × Oh)
 * @param {number} Q - Flow rate (m3/h)
 * @param {number} J - Membrane flux (m3/m2·h)
 * @param {number} Oh - Operating hours per day
 * @returns {number} Area in m2
 */
function computeMembraneArea(Q, J, Oh) {
    if (!J || !Oh || J <= 0 || Oh <= 0) return null;
    return Q / (J * Oh);
}

module.exports = { computeEfficiency, computeHRT, computeReactorVolume, computeMembraneArea };
