/**
 * Water Quality Index (Equations 2-3 from Math-7 Model)
 * 
 * WQI = W^T · Q = Σ(w_i × q_i) where q_i = (C_i / S_i) × 100
 * Higher WQI = poorer water quality (values > 100 indicate exceedance).
 */

/**
 * Compute the Water Quality Index.
 * @param {Object} concentrations - Measured concentrations { BOD, COD, TSS, ... }
 * @param {Object} standards - Standard limits (same keys)
 * @param {Object} weights - AHP-derived weights (same keys, should sum to ~1)
 * @returns {{ wqi: number, ratings: Object, interpretation: string }}
 */
function computeWQI(concentrations, standards, weights) {
    const ratings = {};
    let wqi = 0;

    for (const param of Object.keys(weights)) {
        const C = concentrations[param] ?? 0;
        const S = standards[param];
        if (!S || S === 0) continue;

        // q_i = (C_i / S_i) × 100
        const q = (C / S) * 100;
        ratings[param] = q;

        // WQI += w_i × q_i
        const w = weights[param] ?? 0;
        wqi += w * q;
    }

    // Interpretation (higher = worse)
    let interpretation;
    if (wqi <= 50) interpretation = 'Excellent';
    else if (wqi <= 75) interpretation = 'Good';
    else if (wqi <= 100) interpretation = 'Acceptable';
    else if (wqi <= 150) interpretation = 'Poor';
    else interpretation = 'Very Poor';

    return { wqi: Math.round(wqi * 100) / 100, ratings, interpretation };
}

module.exports = { computeWQI };
