const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { computeDeviation } = require('../src/engine/deviationVector');
const { computeWQI } = require('../src/engine/waterQualityIndex');
const { computeEfficiency, computeHRT, computeReactorVolume, computeMembraneArea } = require('../src/engine/removalEfficiency');
const { computeSEC, computePumpPower, computeTotalPower } = require('../src/engine/energyBreakdown');
const { getRecommendations, getQuickSuggestions } = require('../src/engine/recommendations');

// ---- Deviation Vector Tests ----
describe('Deviation Vector (Equations 1-2)', () => {
    it('should compute deviation D = P - S correctly', () => {
        const P = { BOD: 60, COD: 100, TSS: 50 };
        const S = { BOD: 40, COD: 80, TSS: 40 };
        const LoD = { BOD: 2, COD: 5, TSS: 2 };

        const result = computeDeviation(P, S, LoD);

        assert.equal(result.deviations.BOD, 20);  // 60 - 40
        assert.equal(result.deviations.COD, 20);  // 100 - 80
        assert.equal(result.deviations.TSS, 10);  // 50 - 40
    });

    it('should flag non-compliant parameters where d > ε', () => {
        const P = { BOD: 60, COD: 82, TSS: 41 };
        const S = { BOD: 40, COD: 80, TSS: 40 };
        const LoD = { BOD: 2, COD: 5, TSS: 2 };

        const result = computeDeviation(P, S, LoD);

        // BOD: d=20, ε=max(0.05*40, 2)=max(2,2)=2 → 20 > 2 → flagged
        assert.equal(result.flags.BOD, true);

        // COD: d=2, ε=max(0.05*80, 5)=max(4,5)=5 → 2 > 5 → NOT flagged
        assert.equal(result.flags.COD, false);

        // TSS: d=1, ε=max(0.05*40, 2)=max(2,2)=2 → 1 > 2 → NOT flagged
        assert.equal(result.flags.TSS, false);
    });

    it('should list non-compliant parameters', () => {
        const P = { BOD: 100, COD: 200, TSS: 30 };
        const S = { BOD: 40, COD: 80, TSS: 40 };
        const LoD = { BOD: 2, COD: 5, TSS: 2 };

        const result = computeDeviation(P, S, LoD);

        assert.ok(result.nonCompliantParams.includes('BOD'));
        assert.ok(result.nonCompliantParams.includes('COD'));
        assert.ok(!result.nonCompliantParams.includes('TSS'));
    });

    it('should compute tolerance ε = max(0.05*s, LoD)', () => {
        const P = { BOD: 0 };
        const S = { BOD: 40 };
        const LoD = { BOD: 5 };

        const result = computeDeviation(P, S, LoD);

        // ε = max(0.05*40, 5) = max(2, 5) = 5
        assert.equal(result.tolerances.BOD, 5);
    });
});

// ---- WQI Tests ----
describe('Water Quality Index (Equation 3)', () => {
    it('should compute WQI = Σ(w_i × q_i) correctly', () => {
        const concentrations = { BOD: 40, COD: 80 };
        const standards = { BOD: 40, COD: 80 };
        const weights = { BOD: 0.5, COD: 0.5 };

        const result = computeWQI(concentrations, standards, weights);

        // q_BOD = (40/40)*100 = 100, q_COD = (80/80)*100 = 100
        // WQI = 0.5*100 + 0.5*100 = 100
        assert.equal(result.wqi, 100);
    });

    it('should give Excellent for WQI <= 50', () => {
        const concentrations = { BOD: 10 };
        const standards = { BOD: 40 };
        const weights = { BOD: 1.0 };

        const result = computeWQI(concentrations, standards, weights);

        // q = (10/40)*100 = 25, WQI = 1.0*25 = 25
        assert.equal(result.wqi, 25);
        assert.equal(result.interpretation, 'Excellent');
    });

    it('should give Very Poor for WQI > 150', () => {
        const concentrations = { BOD: 100 };
        const standards = { BOD: 40 };
        const weights = { BOD: 1.0 };

        const result = computeWQI(concentrations, standards, weights);

        // q = (100/40)*100 = 250, WQI = 250
        assert.equal(result.wqi, 250);
        assert.equal(result.interpretation, 'Very Poor');
    });
});

// ---- Removal Efficiency Tests ----
describe('Removal Efficiency (Equations 4-6)', () => {
    it('should compute efficiency E = (Cin - Cout) / Cin × 100', () => {
        const result = computeEfficiency(100, 20, 2);
        assert.equal(result.efficiency, 80);
        assert.equal(result.valid, true);
    });

    it('should reject when Cin <= LoD', () => {
        const result = computeEfficiency(1, 0.5, 2);
        assert.equal(result.valid, false);
        assert.equal(result.efficiency, null);
    });

    it('should compute HRT = (1/k) × ln(Cin/Cout)', () => {
        const hrt = computeHRT(100, 20, 0.5);
        // HRT = (1/0.5) * ln(100/20) = 2 * ln(5) ≈ 2 * 1.6094 = 3.2189
        assert.ok(Math.abs(hrt - 3.2189) < 0.001);
    });

    it('should compute reactor volume V = Q × HRT', () => {
        const vol = computeReactorVolume(500, 4);
        assert.equal(vol, 2000);
    });

    it('should compute membrane area A = Q / (J × Oh)', () => {
        const area = computeMembraneArea(500, 0.03, 20);
        // A = 500 / (0.03 * 20) = 500 / 0.6 ≈ 833.33
        assert.ok(Math.abs(area - 833.33) < 0.01);
    });
});

// ---- Energy Tests ----
describe('Energy Breakdown (Equations 7-9)', () => {
    it('should compute SEC = Ptotal / V', () => {
        const sec = computeSEC(100, 500);
        assert.equal(sec, 0.2);
    });

    it('should return null for zero flow', () => {
        assert.equal(computeSEC(100, 0), null);
    });

    it('should compute pump power P = (ρ·g·Q·H) / η', () => {
        const power = computePumpPower(1000, 9.81, 0.139, 15, 0.70);
        // P = (1000 * 9.81 * 0.139 * 15) / 0.70 ≈ 29,223 W
        assert.ok(power > 29000 && power < 30000);
    });

    it('should compute total power from components', () => {
        const total = computeTotalPower({ aeration: 50, pumps: 30, membranes: 10, auxiliary: 5 });
        assert.equal(total, 95);
    });
});

// ---- Recommendations Tests ----
describe('Recommendations Engine', () => {
    it('should return recommendations for flagged parameters', () => {
        const flags = { BOD: true, COD: false, TSS: false, heavy_metals: true };
        const recs = getRecommendations(flags);

        assert.ok(recs.length === 2);
        assert.ok(recs.some(r => r.parameter === 'BOD'));
        assert.ok(recs.some(r => r.parameter === 'heavy_metals'));
    });

    it('should sort by urgency (critical first)', () => {
        const flags = { TN: true, heavy_metals: true };
        const recs = getRecommendations(flags);

        // heavy_metals is critical, TN is medium
        assert.equal(recs[0].parameter, 'heavy_metals');
        assert.equal(recs[0].urgency, 'critical');
        assert.equal(recs[1].parameter, 'TN');
        assert.equal(recs[1].urgency, 'medium');
    });

    it('should return empty array when no violations', () => {
        const flags = { BOD: false, COD: false };
        const recs = getRecommendations(flags);
        assert.equal(recs.length, 0);
    });

    it('should return quick suggestions', () => {
        const flags = { TN: true };
        const suggestions = getQuickSuggestions(flags);

        assert.equal(suggestions.length, 1);
        assert.equal(suggestions[0].parameter, 'TN');
        assert.ok(suggestions[0].action.length > 0);
    });
});
