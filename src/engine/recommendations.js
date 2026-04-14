/**
 * Recommendation Engine
 * 
 * Maps deviation flags to specific retrofit recommendations based on
 * the recommendation matrix referenced in the PDF.
 */

const RECOMMENDATION_MAP = {
    BOD: {
        category: 'Biological',
        urgency: 'high',
        suggestions: [
            'Upgrade to activated sludge process or MBR for enhanced organic removal',
            'Check aeration system efficiency — may need diffuser replacement',
            'Consider adding an anoxic zone for combined BOD/nitrogen removal',
            'Evaluate constructed wetland polishing stage'
        ]
    },
    COD: {
        category: 'Biological + Chemical',
        urgency: 'high',
        suggestions: [
            'Investigate source of refractory COD (industrial discharge)',
            'Add chemical oxidation (ozone/Fenton) for non-biodegradable fraction',
            'Increase biological retention time (HRT)',
            'Consider activated carbon adsorption for polishing'
        ]
    },
    TSS: {
        category: 'Physical',
        urgency: 'medium',
        suggestions: [
            'Install or upgrade secondary clarifier',
            'Add UF membrane filtration for guaranteed TSS removal',
            'Check sludge settling properties (SVI test)',
            'Evaluate coagulant/flocculant addition before settling'
        ]
    },
    TN: {
        category: 'Biological',
        urgency: 'medium',
        suggestions: [
            'Implement nitrification/denitrification (anoxic-aerobic cycling)',
            'Consider MBR with extended sludge age for enhanced nitrogen removal',
            'Optimize internal recirculation ratios',
            'Evaluate side-stream treatment for reject water nitrogen'
        ]
    },
    TP: {
        category: 'Chemical + Biological',
        urgency: 'medium',
        suggestions: [
            'Add chemical phosphorus precipitation (alum or ferric chloride)',
            'Implement enhanced biological phosphorus removal (EBPR)',
            'Consider side-stream struvite recovery (nutrient recovery)',
            'Evaluate membrane-based phosphorus separation'
        ]
    },
    EC: {
        category: 'Membrane',
        urgency: 'medium',
        suggestions: [
            'RO/NF membrane treatment for salinity reduction',
            'Investigate source of high TDS (industrial or groundwater infiltration)',
            'Consider blending with lower-salinity water source',
            'Evaluate electrodialysis as an energy-efficient alternative'
        ]
    },
    Na: {
        category: 'Membrane',
        urgency: 'high',
        suggestions: [
            'RO membrane treatment is required for sodium removal',
            'Critical for agricultural reuse — high Na causes soil sodification',
            'Evaluate ion exchange as a selective removal option',
            'Consider blending strategies to reduce sodium concentration'
        ]
    },
    heavy_metals: {
        category: 'Chemical',
        urgency: 'critical',
        suggestions: [
            'Immediate chemical precipitation (hydroxide or sulfide)',
            'Investigate and isolate industrial discharge sources',
            'Consider chelation or ion exchange for specific metals',
            'Implement source control and pretreatment requirements'
        ]
    },
    pathogens: {
        category: 'Quaternary (UV)',
        urgency: 'critical',
        suggestions: [
            'Install UV disinfection system sized using Chick-Watson law (Eq. 6)',
            'Ensure upstream TSS removal to < 10 mg/L for effective UV penetration',
            'Consider UV + chlorination combined approach for redundancy',
            'Evaluate medium-pressure vs low-pressure UV lamp configuration',
            'Size UV dose based on target log-reduction (typically 4-log for reuse)'
        ]
    }
};

/**
 * Get recommendations based on deviation flags.
 * @param {Object} flags - { paramName: boolean } from deviation vector
 * @returns {Array} Array of recommendation objects
 */
function getRecommendations(flags) {
    const recommendations = [];

    for (const [param, isNonCompliant] of Object.entries(flags)) {
        if (!isNonCompliant) continue;

        const rec = RECOMMENDATION_MAP[param];
        if (rec) {
            recommendations.push({
                parameter: param,
                category: rec.category,
                urgency: rec.urgency,
                suggestions: rec.suggestions
            });
        }
    }

    // Sort by urgency: critical > high > medium > low
    const urgencyOrder = { critical: 1, high: 2, medium: 3, low: 4 };
    recommendations.sort((a, b) => (urgencyOrder[a.urgency] || 5) - (urgencyOrder[b.urgency] || 5));

    return recommendations;
}

/**
 * Get quick suggestion summary for technician view.
 * @param {Object} flags - { paramName: boolean }
 * @returns {Array} Simplified suggestions
 */
function getQuickSuggestions(flags) {
    const recommendations = getRecommendations(flags);
    return recommendations.map(r => ({
        parameter: r.parameter,
        urgency: r.urgency,
        action: r.suggestions[0] // Primary suggestion only
    }));
}

module.exports = { getRecommendations, getQuickSuggestions, RECOMMENDATION_MAP };
