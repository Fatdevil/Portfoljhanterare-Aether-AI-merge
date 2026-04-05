// savings_data.js
// Holds the static data for savings accounts. Can be updated by a python scraper in the future.

const SAVINGS_ACCOUNTS = [
    // ════════ RÖRLIGT (FRIA UTTAG) ════════
    // Storbanker
    { id: "shb_rorligt", name: "Handelsbanken (E-kapitalkonto)", rate: 0.00, type: "flexible", guarantee: true, isBigBank: true },
    { id: "swedbank_rorligt", name: "Swedbank (e-sparkonto)", rate: 2.00, type: "flexible", guarantee: true, isBigBank: true },
    { id: "seb_rorligt", name: "SEB (Enkla sparkontot)", rate: 2.00, type: "flexible", guarantee: true, isBigBank: true },
    { id: "storbank_lon", name: "Generellt Lönekonto", rate: 0.00, type: "flexible", guarantee: true, isBigBank: true },

    // Nischbanker 
    { id: "borgo_rorligt", name: "Borgo", rate: 2.40, type: "flexible", guarantee: true, isBigBank: false },
    { id: "morrow_rorligt", name: "Morrow Bank", rate: 2.50, type: "flexible", guarantee: true, isBigBank: false },
    { id: "avanza_rorligt", name: "Avanza Sparkonto+", rate: 1.75, type: "flexible", guarantee: true, isBigBank: false },
    { id: "sbab_rorligt", name: "SBAB (Sparkonto)", rate: 2.25, type: "flexible", guarantee: true, isBigBank: false },

    // ════════ BUNDET: 3 MÅNADER ════════
    // Storbanker
    { id: "shb_3m", name: "Handelsbanken (Placeringskonto)", rate: 1.75, type: "fixed_3m", guarantee: true, isBigBank: true },
    { id: "nordea_3m", name: "Nordea (Fasträntekonto)", rate: 1.75, type: "fixed_3m", guarantee: true, isBigBank: true },
    { id: "swedbank_3m", name: "Swedbank (Fasträntekonto)", rate: 1.80, type: "fixed_3m", guarantee: true, isBigBank: true },
    
    // Nischbanker
    { id: "marginalen_3m", name: "Marginalen Bank", rate: 2.60, type: "fixed_3m", guarantee: true, isBigBank: false },
    { id: "avanza_3m", name: "Avanza Sparkonto+", rate: 2.05, type: "fixed_3m", guarantee: true, isBigBank: false },
    { id: "borgo_3m", name: "Borgo", rate: 2.50, type: "fixed_3m", guarantee: true, isBigBank: false },

    // ════════ BUNDET: 12 MÅNADER (1 ÅR) ════════
    // Storbanker
    { id: "shb_12m", name: "Handelsbanken (Bunden placering)", rate: 2.10, type: "fixed_12m", guarantee: true, isBigBank: true },
    { id: "swedbank_12m", name: "Swedbank (Fasträntekonto)", rate: 2.15, type: "fixed_12m", guarantee: true, isBigBank: true },
    
    // Nischbanker
    { id: "avanza_12m", name: "Avanza Sparkonto+", rate: 2.25, type: "fixed_12m", guarantee: true, isBigBank: false },
    { id: "sbab_12m", name: "SBAB (Fasträntekonto)", rate: 2.20, type: "fixed_12m", guarantee: true, isBigBank: false },
    { id: "marginalen_12m", name: "Marginalen Bank", rate: 2.45, type: "fixed_12m", guarantee: true, isBigBank: false },
];

window.SAVINGS_ACCOUNTS = SAVINGS_ACCOUNTS;
