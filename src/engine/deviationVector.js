/**
 * Deviation Vector Analysis (Equation 1 from Math-7 Model)
 * 
 * Computes D = P - S, applies tolerance vector ε,
 * and flags non-compliant parameters where d_i > ε_i.
 */

/**
 * Compute the deviation vector and compliance flags.
 * @param {Object} P - Measured pollutant concentrations { BOD, COD, TSS, TN, TP, EC, Na, heavy_metals }
 * @param {Object} S - Standard limits (same keys as P)
 * @param {Object} LoD - Limit of Detection values (same keys as P)
 * @returns {{ deviations: Object, tolerances: Object, flags: Object, nonCompliantParams: string[] }}
 */
function computeDeviation(P, S, LoD) {
    const deviations = {};
    const tolerances = {};
    const flags = {};
    const nonCompliantParams = [];

    for (const param of Object.keys(S)) {
        const p = P[param] ?? 0;
        const s = S[param] ?? 0;
        const lod = (LoD && LoD[param]) ? LoD[param] : 0;

        // Deviation: D = P - S (Equation 2)
        const d = p - s;
        deviations[param] = d;

        // Tolerance: ε_i = max(0.05 * s_i, LoD_i)
        const epsilon = Math.max(0.05 * s, lod);
        tolerances[param] = epsilon;

        // Non-compliance flag: d_i > ε_i
        const isNonCompliant = d > epsilon;
        flags[param] = isNonCompliant;

        if (isNonCompliant) {
            nonCompliantParams.push(param);
        }
    }

    return { deviations, tolerances, flags, nonCompliantParams };
}

module.exports = { computeDeviation };
