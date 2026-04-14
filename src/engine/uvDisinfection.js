/**
 * UV Disinfection — Chick-Watson Law (Equation 6 from Math-7 Model)
 * 
 * ln(Nt / N0) = -kUV · DUV
 * 
 * Where:
 *   N0  = initial pathogen count (CFU/100mL or similar)
 *   Nt  = target pathogen count after disinfection
 *   kUV = UV inactivation rate constant (cm²/mJ), range 0.15-0.30
 *   DUV = required UV dose (mJ/cm²)
 * 
 * Assumptions:
 *   - Uniform UV intensity distribution without shading from suspended solids (EPA [5])
 *   - First-order inactivation kinetics
 */

/**
 * Compute the required UV dose for target pathogen reduction.
 * DUV = -ln(Nt / N0) / kUV
 * 
 * @param {number} N0 - Initial pathogen count (CFU/100mL)
 * @param {number} Nt - Target pathogen count (CFU/100mL)
 * @param {number} kUV - UV inactivation rate constant (cm²/mJ), default 0.2
 * @returns {{ dose_mJ_cm2: number|null, logReduction: number, valid: boolean }}
 */
function computeUVDose(N0, Nt, kUV = 0.2) {
    if (!N0 || N0 <= 0 || !Nt || Nt <= 0 || !kUV || kUV <= 0) {
        return { dose_mJ_cm2: null, logReduction: null, valid: false, reason: 'Invalid input parameters' };
    }
    if (Nt >= N0) {
        return { dose_mJ_cm2: 0, logReduction: 0, valid: true, reason: 'Target already met (Nt >= N0)' };
    }

    // DUV = -ln(Nt / N0) / kUV = ln(N0 / Nt) / kUV
    const logRatio = Math.log(N0 / Nt);
    const dose = logRatio / kUV;
    const logReduction = Math.log10(N0 / Nt);

    return {
        dose_mJ_cm2: Math.round(dose * 100) / 100,
        logReduction: Math.round(logReduction * 100) / 100,
        valid: true
    };
}

/**
 * Compute pathogen survival after a given UV dose.
 * Nt = N0 × exp(-kUV × DUV)
 * 
 * @param {number} N0 - Initial pathogen count
 * @param {number} DUV - Applied UV dose (mJ/cm²)
 * @param {number} kUV - UV inactivation rate constant (cm²/mJ)
 * @returns {{ surviving: number, logReduction: number }}
 */
function computeUVSurvival(N0, DUV, kUV = 0.2) {
    if (!N0 || N0 <= 0 || !DUV || DUV < 0) {
        return { surviving: N0 || 0, logReduction: 0 };
    }
    const surviving = N0 * Math.exp(-kUV * DUV);
    const logReduction = Math.log10(N0 / Math.max(surviving, 1e-10));

    return {
        surviving: Math.round(surviving * 100) / 100,
        logReduction: Math.round(logReduction * 100) / 100
    };
}

/**
 * Estimate UV system power requirement.
 * P_UV = DUV × Q × 1000 / (η_UV × 3600)
 * 
 * @param {number} DUV - Required UV dose (mJ/cm²)
 * @param {number} Q - Flow rate (m³/h)
 * @param {number} etaUV - UV lamp efficiency (fraction, default 0.3)
 * @returns {number} UV power in kW
 */
function computeUVPower(DUV, Q, etaUV = 0.3) {
    if (!DUV || DUV <= 0 || !Q || Q <= 0 || !etaUV || etaUV <= 0) return 0;
    // Convert: DUV (mJ/cm²) × Q (m³/h) × 10^4 (cm²/m²) / (η × 3.6×10^6 mJ/kWh)
    // Simplified: P = DUV × Q × 10000 / (etaUV × 3600000) [kW]
    return Math.round((DUV * Q * 10000 / (etaUV * 3600000)) * 1000) / 1000;
}

module.exports = { computeUVDose, computeUVSurvival, computeUVPower };
