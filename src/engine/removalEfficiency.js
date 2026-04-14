/**
 * Removal Efficiency & Reactor/Membrane Sizing (Equations 4-5, 7 from Math-7 Model)
 * 
 * Eq 4: E = (C_in - C_out) / C_in × 100  (guarded by C_in > LoD)
 * Eq 5: HRT = (1/k) × ln(C_in / C_out), V_reactor = Q × HRT
 * Eq 7: Jw = (ΔP - Δπ) / (μ · Rt),  A = Q / Jw   (Darcy's Law membrane sizing)
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
 * Compute membrane water flux using Darcy's Law (Equation 7 from Math-7).
 * Jw = (ΔP - Δπ) / (μ · Rt)
 * 
 * @param {number} deltaP - Transmembrane pressure (Pa or bar, consistent units)
 * @param {number} deltaPi - Osmotic pressure difference (same units as deltaP)
 * @param {number} mu - Dynamic viscosity of water (Pa·s), default 0.001 (water at 20°C)
 * @param {number} Rt - Total membrane resistance (m^-1)
 * @returns {number|null} Water flux Jw in m³/m²·h (converted from m³/m²·s)
 */
function computeMembraneFlux(deltaP, deltaPi, mu, Rt) {
    if (!Rt || Rt <= 0 || !mu || mu <= 0) return null;
    const netPressure = (deltaP || 0) - (deltaPi || 0);
    if (netPressure <= 0) return null;
    // Jw in m/s = (Pa) / (Pa·s × m^-1) = m/s
    const Jw_m_per_s = netPressure / (mu * Rt);
    // Convert m/s to m³/m²·h (multiply by 3600)
    return Jw_m_per_s * 3600;
}

/**
 * Compute required membrane area using Darcy's Law flux (Equation 7 from Math-7).
 * A = Q / Jw
 * 
 * When Darcy's Law parameters are available, flux is computed from first principles.
 * Falls back to direct flux value if Darcy parameters are not provided.
 * 
 * @param {number} Q - Flow rate (m3/h)
 * @param {number} Jw - Water flux (m3/m2·h) — can be pre-computed from Darcy's Law or use default
 * @returns {number} Area in m2
 */
function computeMembraneArea(Q, Jw) {
    if (!Jw || Jw <= 0 || !Q || Q <= 0) return null;
    return Q / Jw;
}

/**
 * Compute required membrane area using full Darcy's Law parameters (Equation 7).
 * Combines computeMembraneFlux + computeMembraneArea into one call.
 * 
 * @param {number} Q - Flow rate (m3/h)
 * @param {number} deltaP - Transmembrane pressure (Pa)
 * @param {number} deltaPi - Osmotic pressure difference (Pa)
 * @param {number} mu - Dynamic viscosity (Pa·s)
 * @param {number} Rt - Total membrane resistance (m^-1)
 * @returns {{ area_m2: number|null, flux_m3_m2_h: number|null }}
 */
function computeMembraneAreaDarcy(Q, deltaP, deltaPi, mu, Rt) {
    const Jw = computeMembraneFlux(deltaP, deltaPi, mu, Rt);
    if (!Jw) {
        return { area_m2: null, flux_m3_m2_h: null, reason: 'Could not compute flux (check Darcy parameters)' };
    }
    const area = computeMembraneArea(Q, Jw);
    return {
        area_m2: area ? Math.round(area * 100) / 100 : null,
        flux_m3_m2_h: Math.round(Jw * 10000) / 10000
    };
}

module.exports = {
    computeEfficiency,
    computeHRT,
    computeReactorVolume,
    computeMembraneFlux,
    computeMembraneArea,
    computeMembraneAreaDarcy
};
