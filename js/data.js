/**
 * data.js — Asset classes, bank fund definitions with exact names & allocations
 *
 * Sources:
 *   - Handelsbanken: Multi Asset 25/50/75/100, Auto Criteria 25/50/75/100
 *   - SEB: Active 30/55/80
 *   - Nordea: Stratega 10/30/50/70/100
 *   - Swedbank Robur: Bas 25/50/75, Access Mix
 *   Allocations are best-effort estimates from public factsheets.
 *   Last verified: 2025-Q1
 */

// Risk-free rate (Swedish government bond yield, approximate)
const RISK_FREE_RATE = 0.03;

// ═══════════════════════════════════════════════════════════════════════
// ASSET CLASSES — The 10 building blocks
// ═══════════════════════════════════════════════════════════════════════
const ASSET_CLASSES = [
    { id: 'se_equity',     name: 'Svenska Aktier',       ticker: 'EWD',   color: '#2196F3', category: 'equity' },
    { id: 'global_equity', name: 'Globala Aktier',        ticker: 'URTH',  color: '#1565C0', category: 'equity' },
    { id: 'em_equity',     name: 'Tillväxtmarknader',     ticker: 'EEM',   color: '#0D47A1', category: 'equity' },
    { id: 'se_bonds',      name: 'Svenska Räntor',        ticker: 'SHY',   color: '#4CAF50', category: 'bonds' },
    { id: 'global_bonds',  name: 'Globala Räntor',        ticker: 'AGG',   color: '#388E3C', category: 'bonds' },
    { id: 'corp_ig',       name: 'Företag IG',            ticker: 'LQD',   color: '#2E7D32', category: 'bonds' },
    { id: 'corp_hy',       name: 'Företag HY',            ticker: 'HYG',   color: '#1B5E20', category: 'bonds' },
    { id: 'alternatives',  name: 'Alternativa',           ticker: 'QAI',   color: '#FF9800', category: 'alt' },
    { id: 'real_estate',   name: 'Fastigheter',           ticker: 'VNQ',   color: '#E65100', category: 'alt' },
    { id: 'gold',          name: 'Guld',                  ticker: 'GLD',   color: '#FFC107', category: 'alt' },
];

// Helper: index lookup
const ASSET_INDEX = {};
ASSET_CLASSES.forEach((a, i) => { ASSET_INDEX[a.id] = i; });

// ═══════════════════════════════════════════════════════════════════════
// FALLBACK CORRELATION MATRIX  (10 × 10)
// Used when Yahoo Finance data is unavailable
// ═══════════════════════════════════════════════════════════════════════
const FALLBACK_CORRELATIONS = [
//   SE_EQ  GL_EQ  EM_EQ  SE_BD  GL_BD  C_IG   C_HY   ALT    REAL   GOLD
    [1.00,  0.82,  0.72,  0.05, -0.02,  0.15,  0.45,  0.30,  0.55,  0.05],  // SE Equity
    [0.82,  1.00,  0.78,  0.00, -0.05,  0.12,  0.50,  0.35,  0.60,  0.02],  // Global Equity
    [0.72,  0.78,  1.00,  0.02,  0.00,  0.18,  0.55,  0.32,  0.48,  0.08],  // EM Equity
    [0.05,  0.00,  0.02,  1.00,  0.85,  0.70,  0.25, -0.05, -0.10,  0.20],  // SE Bonds
    [-0.02,-0.05,  0.00,  0.85,  1.00,  0.75,  0.30, -0.02, -0.08,  0.25],  // Global Bonds
    [0.15,  0.12,  0.18,  0.70,  0.75,  1.00,  0.55,  0.10,  0.05,  0.15],  // Corp IG
    [0.45,  0.50,  0.55,  0.25,  0.30,  0.55,  1.00,  0.40,  0.35,  0.05],  // Corp HY
    [0.30,  0.35,  0.32, -0.05, -0.02,  0.10,  0.40,  1.00,  0.30,  0.15],  // Alternatives
    [0.55,  0.60,  0.48, -0.10, -0.08,  0.05,  0.35,  0.30,  1.00,  0.10],  // Real Estate
    [0.05,  0.02,  0.08,  0.20,  0.25,  0.15,  0.05,  0.15,  0.10,  1.00],  // Gold
];

// Fallback expected returns (annual) — forward-looking estimates, NOT historical
// Sources: consensus capital market assumptions 2025-2026
const FALLBACK_RETURNS = [
    0.070,  // Svenska Aktier – 7.0% (historiskt ~8-9%, men komprimerad riskpremie)
    0.065,  // Globala Aktier – 6.5% (justerat från 12%+ senaste 5 år)
    0.075,  // Tillväxtmarknader – 7.5%
    0.028,  // Svenska Räntor – 2.8%
    0.030,  // Globala Räntor – 3.0%
    0.038,  // Företag IG – 3.8%
    0.048,  // Företag HY – 4.8%
    0.035,  // Alternativa – 3.5%
    0.055,  // Fastigheter – 5.5%
    0.040,  // Guld – 4.0% (nominellt, ingen yield)
];

// Long-term return priors for Bayesian shrinkage of live data
// Used to dampen extreme bull/bear market bias in short historical windows
const LONG_TERM_RETURN_PRIORS = [...FALLBACK_RETURNS];

// Fallback volatilities (annual)
const FALLBACK_VOLS = [
    0.20,   // Svenska Aktier (historisk 18-22%)
    0.15,   // Globala Aktier
    0.22,   // Tillväxtmarknader (historisk 20-24%)
    0.035,  // Svenska Räntor
    0.05,   // Globala Räntor
    0.065,  // Företag IG
    0.10,   // Företag HY
    0.10,   // Alternativa (historisk 8-12%)
    0.18,   // Fastigheter (historisk 16-20%)
    0.16,   // Guld
];


// ═══════════════════════════════════════════════════════════════════════
// HELPER: Build weight array from allocation object
// ═══════════════════════════════════════════════════════════════════════
function buildWeights(alloc) {
    const w = new Array(ASSET_CLASSES.length).fill(0);
    for (const [id, val] of Object.entries(alloc)) {
        if (ASSET_INDEX[id] !== undefined) {
            w[ASSET_INDEX[id]] = val;
        }
    }
    // Normalize to sum=1 (safety)
    const sum = w.reduce((a, b) => a + b, 0);
    if (sum > 0 && Math.abs(sum - 1) > 0.001) {
        for (let i = 0; i < w.length; i++) w[i] /= sum;
    }
    return w;
}


// ═══════════════════════════════════════════════════════════════════════
// BANK PORTFOLIOS — Exact fund names and allocations
// ═══════════════════════════════════════════════════════════════════════
const BANK_PORTFOLIOS = {

    // ─────────────────────────────────────────────────────────────────
    // HANDELSBANKEN
    // ─────────────────────────────────────────────────────────────────
    Handelsbanken: {
        shortName: 'SHB',
        color: '#005AA0',
        series: [
            {
                name: 'Multi Asset',
                type: 'Aktiv',
                description: 'Aktivt förvaltade fond-i-fonder med alternativa tillgångar',
                funds: [
                    {
                        id: 'shb_ma25',
                        name: 'Multi Asset 25',
                        fullName: 'Handelsbanken Multi Asset 25',
                        fee: 0.012,
                        equityTarget: 0.25,
                        equityRange: [0.10, 0.35],
                        altRange: [0.00, 0.30],
                        weights: buildWeights({
                            se_equity: 0.04, global_equity: 0.15, em_equity: 0.03,
                            se_bonds: 0.20, global_bonds: 0.18, corp_ig: 0.15, corp_hy: 0.05,
                            alternatives: 0.10, real_estate: 0.05, gold: 0.05,
                        }),
                    },
                    {
                        id: 'shb_ma50',
                        name: 'Multi Asset 50',
                        fullName: 'Handelsbanken Multi Asset 50',
                        fee: 0.013,
                        equityTarget: 0.50,
                        equityRange: [0.35, 0.65],
                        altRange: [0.00, 0.30],
                        weights: buildWeights({
                            se_equity: 0.08, global_equity: 0.30, em_equity: 0.07,
                            se_bonds: 0.12, global_bonds: 0.10, corp_ig: 0.08, corp_hy: 0.05,
                            alternatives: 0.10, real_estate: 0.05, gold: 0.05,
                        }),
                    },
                    {
                        id: 'shb_ma75',
                        name: 'Multi Asset 75',
                        fullName: 'Handelsbanken Multi Asset 75',
                        fee: 0.014,
                        equityTarget: 0.75,
                        equityRange: [0.60, 0.90],
                        altRange: [0.00, 0.30],
                        weights: buildWeights({
                            se_equity: 0.12, global_equity: 0.42, em_equity: 0.11,
                            se_bonds: 0.05, global_bonds: 0.05, corp_ig: 0.05, corp_hy: 0.03,
                            alternatives: 0.08, real_estate: 0.05, gold: 0.04,
                        }),
                    },
                    {
                        id: 'shb_ma100',
                        name: 'Multi Asset 100',
                        fullName: 'Handelsbanken Multi Asset 100',
                        fee: 0.015,
                        equityTarget: 1.00,
                        equityRange: [0.85, 1.00],
                        altRange: [0.00, 0.00],
                        weights: buildWeights({
                            se_equity: 0.18, global_equity: 0.55, em_equity: 0.15,
                            se_bonds: 0.00, global_bonds: 0.00, corp_ig: 0.00, corp_hy: 0.00,
                            alternatives: 0.05, real_estate: 0.05, gold: 0.02,
                        }),
                    },
                ],
            },
            {
                name: 'Auto Criteria',
                type: 'Passiv',
                description: 'Passivt förvaltade, indexnära (ESG Paris Aligned)',
                funds: [
                    {
                        id: 'shb_auto25',
                        name: 'Auto 25 Criteria',
                        fullName: 'Handelsbanken Auto 25 Criteria',
                        fee: 0.006,
                        equityTarget: 0.25,
                        equityRange: null,
                        weights: buildWeights({
                            se_equity: 0.06, global_equity: 0.19, em_equity: 0.00,
                            se_bonds: 0.30, global_bonds: 0.15, corp_ig: 0.20, corp_hy: 0.00,
                            alternatives: 0.00, real_estate: 0.05, gold: 0.05,
                        }),
                    },
                    {
                        id: 'shb_auto50',
                        name: 'Auto 50 Criteria',
                        fullName: 'Handelsbanken Auto 50 Criteria',
                        fee: 0.006,
                        equityTarget: 0.50,
                        equityRange: null,
                        weights: buildWeights({
                            se_equity: 0.12, global_equity: 0.38, em_equity: 0.00,
                            se_bonds: 0.18, global_bonds: 0.10, corp_ig: 0.12, corp_hy: 0.00,
                            alternatives: 0.00, real_estate: 0.05, gold: 0.05,
                        }),
                    },
                    {
                        id: 'shb_auto75',
                        name: 'Auto 75 Criteria',
                        fullName: 'Handelsbanken Auto 75 Criteria',
                        fee: 0.006,
                        equityTarget: 0.75,
                        equityRange: null,
                        weights: buildWeights({
                            se_equity: 0.19, global_equity: 0.56, em_equity: 0.00,
                            se_bonds: 0.08, global_bonds: 0.05, corp_ig: 0.07, corp_hy: 0.00,
                            alternatives: 0.00, real_estate: 0.03, gold: 0.02,
                        }),
                    },
                    {
                        id: 'shb_auto100',
                        name: 'Auto 100 Criteria',
                        fullName: 'Handelsbanken Auto 100 Criteria',
                        fee: 0.006,
                        equityTarget: 1.00,
                        equityRange: null,
                        weights: buildWeights({
                            se_equity: 0.25, global_equity: 0.75, em_equity: 0.00,
                            se_bonds: 0.00, global_bonds: 0.00, corp_ig: 0.00, corp_hy: 0.00,
                            alternatives: 0.00, real_estate: 0.00, gold: 0.00,
                        }),
                    },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────
    // SEB
    // ─────────────────────────────────────────────────────────────────
    SEB: {
        shortName: 'SEB',
        color: '#41B06E',
        series: [
            {
                name: 'Active',
                type: 'Aktiv',
                description: 'Aktivt förvaltade blandfonder med alternativa tillgångar',
                funds: [
                    {
                        id: 'seb_active30',
                        name: 'Active 30',
                        fullName: 'SEB Active 30',
                        fee: 0.013,
                        equityTarget: 0.30,
                        equityRange: [0.15, 0.45],
                        weights: buildWeights({
                            se_equity: 0.06, global_equity: 0.16, em_equity: 0.04,
                            se_bonds: 0.18, global_bonds: 0.15, corp_ig: 0.12, corp_hy: 0.06,
                            alternatives: 0.12, real_estate: 0.05, gold: 0.06,
                        }),
                    },
                    {
                        id: 'seb_active55',
                        name: 'Active 55',
                        fullName: 'SEB Active 55',
                        fee: 0.014,
                        equityTarget: 0.55,
                        equityRange: [0.40, 0.70],
                        weights: buildWeights({
                            se_equity: 0.12, global_equity: 0.28, em_equity: 0.08,
                            se_bonds: 0.10, global_bonds: 0.08, corp_ig: 0.08, corp_hy: 0.06,
                            alternatives: 0.10, real_estate: 0.05, gold: 0.05,
                        }),
                    },
                    {
                        id: 'seb_active80',
                        name: 'Active 80',
                        fullName: 'SEB Active 80',
                        fee: 0.014,
                        equityTarget: 0.80,
                        equityRange: [0.65, 0.95],
                        weights: buildWeights({
                            se_equity: 0.18, global_equity: 0.40, em_equity: 0.12,
                            se_bonds: 0.04, global_bonds: 0.03, corp_ig: 0.03, corp_hy: 0.03,
                            alternatives: 0.08, real_estate: 0.05, gold: 0.04,
                        }),
                    },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────
    // NORDEA
    // ─────────────────────────────────────────────────────────────────
    Nordea: {
        shortName: 'NORDEA',
        color: '#0000C1',
        series: [
            {
                name: 'Stratega',
                type: 'Aktiv',
                description: 'Aktivt förvaltade fond-i-fonder',
                funds: [
                    {
                        id: 'nordea_s10',
                        name: 'Stratega 10',
                        fullName: 'Nordea Stratega 10',
                        fee: 0.010,
                        equityTarget: 0.10,
                        equityRange: [0.00, 0.25],
                        weights: buildWeights({
                            se_equity: 0.03, global_equity: 0.05, em_equity: 0.02,
                            se_bonds: 0.30, global_bonds: 0.25, corp_ig: 0.18, corp_hy: 0.05,
                            alternatives: 0.07, real_estate: 0.03, gold: 0.02,
                        }),
                    },
                    {
                        id: 'nordea_s30',
                        name: 'Stratega 30',
                        fullName: 'Nordea Stratega 30',
                        fee: 0.012,
                        equityTarget: 0.30,
                        equityRange: [0.15, 0.45],
                        weights: buildWeights({
                            se_equity: 0.06, global_equity: 0.16, em_equity: 0.04,
                            se_bonds: 0.22, global_bonds: 0.18, corp_ig: 0.12, corp_hy: 0.05,
                            alternatives: 0.08, real_estate: 0.05, gold: 0.04,
                        }),
                    },
                    {
                        id: 'nordea_s50',
                        name: 'Stratega 50',
                        fullName: 'Nordea Stratega 50',
                        fee: 0.013,
                        equityTarget: 0.50,
                        equityRange: [0.35, 0.65],
                        weights: buildWeights({
                            se_equity: 0.10, global_equity: 0.26, em_equity: 0.08,
                            se_bonds: 0.15, global_bonds: 0.12, corp_ig: 0.10, corp_hy: 0.05,
                            alternatives: 0.06, real_estate: 0.05, gold: 0.03,
                        }),
                    },
                    {
                        id: 'nordea_s70',
                        name: 'Stratega 70',
                        fullName: 'Nordea Stratega 70',
                        fee: 0.013,
                        equityTarget: 0.70,
                        equityRange: [0.55, 0.85],
                        weights: buildWeights({
                            se_equity: 0.14, global_equity: 0.36, em_equity: 0.12,
                            se_bonds: 0.08, global_bonds: 0.06, corp_ig: 0.06, corp_hy: 0.04,
                            alternatives: 0.06, real_estate: 0.05, gold: 0.03,
                        }),
                    },
                    {
                        id: 'nordea_s100',
                        name: 'Stratega 100',
                        fullName: 'Nordea Stratega 100',
                        fee: 0.014,
                        equityTarget: 1.00,
                        equityRange: [0.85, 1.00],
                        weights: buildWeights({
                            se_equity: 0.20, global_equity: 0.50, em_equity: 0.18,
                            se_bonds: 0.00, global_bonds: 0.00, corp_ig: 0.00, corp_hy: 0.00,
                            alternatives: 0.05, real_estate: 0.05, gold: 0.02,
                        }),
                    },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────
    // SWEDBANK ROBUR
    // ─────────────────────────────────────────────────────────────────
    Swedbank: {
        shortName: 'SWED',
        color: '#FF6600',
        series: [
            {
                name: 'Bas',
                type: 'Aktiv',
                description: 'Aktivt förvaltade fond-i-fonder (Selection)',
                funds: [
                    {
                        id: 'swed_bas25',
                        name: 'Bas 25',
                        fullName: 'Swedbank Robur Bas 25',
                        fee: 0.013,
                        equityTarget: 0.25,
                        equityRange: [0.10, 0.40],
                        weights: buildWeights({
                            se_equity: 0.06, global_equity: 0.12, em_equity: 0.04,
                            se_bonds: 0.22, global_bonds: 0.18, corp_ig: 0.15, corp_hy: 0.05,
                            alternatives: 0.08, real_estate: 0.05, gold: 0.05,
                        }),
                    },
                    {
                        id: 'swed_bas50',
                        name: 'Bas 50',
                        fullName: 'Swedbank Robur Bas 50',
                        fee: 0.014,
                        equityTarget: 0.50,
                        equityRange: [0.35, 0.65],
                        weights: buildWeights({
                            se_equity: 0.12, global_equity: 0.24, em_equity: 0.07,
                            se_bonds: 0.14, global_bonds: 0.10, corp_ig: 0.10, corp_hy: 0.05,
                            alternatives: 0.08, real_estate: 0.05, gold: 0.05,
                        }),
                    },
                    {
                        id: 'swed_bas75',
                        name: 'Bas 75',
                        fullName: 'Swedbank Robur Bas 75',
                        fee: 0.014,
                        equityTarget: 0.75,
                        equityRange: [0.60, 0.90],
                        weights: buildWeights({
                            se_equity: 0.18, global_equity: 0.38, em_equity: 0.10,
                            se_bonds: 0.06, global_bonds: 0.04, corp_ig: 0.05, corp_hy: 0.03,
                            alternatives: 0.07, real_estate: 0.05, gold: 0.04,
                        }),
                    },
                ],
            },
            {
                name: 'Access Mix',
                type: 'Passiv',
                description: 'Indexnära blandfond — 50/50 svenska aktier/räntor',
                funds: [
                    {
                        id: 'swed_access_mix',
                        name: 'Access Mix',
                        fullName: 'Swedbank Robur Access Mix',
                        fee: 0.004,
                        equityTarget: 0.50,
                        equityRange: null,
                        weights: buildWeights({
                            se_equity: 0.50, global_equity: 0.00, em_equity: 0.00,
                            se_bonds: 0.30, global_bonds: 0.00, corp_ig: 0.20, corp_hy: 0.00,
                            alternatives: 0.00, real_estate: 0.00, gold: 0.00,
                        }),
                    },
                ],
            },
        ],
    },
};


// ═══════════════════════════════════════════════════════════════════════
// HELPERS: Flatten all funds for easy access
// ═══════════════════════════════════════════════════════════════════════

/**
 * Returns flat array of all funds across all banks and series.
 * Each item includes: bankName, seriesName, seriesType, and all fund properties.
 */
function getAllFunds() {
    const funds = [];
    for (const [bankName, bank] of Object.entries(BANK_PORTFOLIOS)) {
        for (const series of bank.series) {
            for (const fund of series.funds) {
                funds.push({
                    ...fund,
                    bankName,
                    bankColor: bank.color,
                    bankShortName: bank.shortName,
                    seriesName: series.name,
                    seriesType: series.type,
                    seriesDescription: series.description,
                });
            }
        }
    }
    return funds;
}

/**
 * Find fund by id.
 */
function getFundById(id) {
    return getAllFunds().find(f => f.id === id) || null;
}

/**
 * Return all funds for a given bank.
 */
function getFundsByBank(bankName) {
    return getAllFunds().filter(f => f.bankName === bankName);
}

/**
 * Return estimated user cost (assumes ETF/index portfolio ~0.15% avg).
 */
function estimateUserPortfolioCost() {
    return 0.0020; // 0.20% weighted average for typical ETF portfolio according to user
}
