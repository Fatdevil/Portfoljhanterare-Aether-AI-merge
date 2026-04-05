// savings_data.js
// Holds the static data for savings accounts. Can be updated by a python scraper in the future.

const SAVINGS_ACCOUNTS = [
    // Storbanker (Zero or very low interest checking/savings accounts)
    { id: "swedbank_ekar", name: "Swedbank (e-sparkonto)", rate: 2.00, guarantee: true, isBigBank: true },
    { id: "handelsbanken", name: "Handelsbanken (E-kapitalkonto)", rate: 2.05, guarantee: true, isBigBank: true },
    { id: "seb_enkla", name: "SEB (Enkla sparkontot)", rate: 2.00, guarantee: true, isBigBank: true },
    { id: "storbank_lon", name: "Storbank (Lönekonto)", rate: 0.00, guarantee: true, isBigBank: true },

    // Nischbanker / Specialister (High interest)
    { id: "sbab_spar", name: "SBAB (Sparkonto)", rate: 3.25, guarantee: true, isBigBank: false },
    { id: "avanza_spar", name: "Avanza Sparkonto+", rate: 3.50, guarantee: true, isBigBank: false },
    { id: "morrow_spar", name: "Morrow Bank (Sparkonto)", rate: 3.75, guarantee: true, isBigBank: false },
    { id: "borgo_spar", name: "Borgo (Sparkonto)", rate: 3.65, guarantee: true, isBigBank: false },
    { id: "nordax_spar", name: "Nordax Bank", rate: 3.60, guarantee: true, isBigBank: false },
    { id: "moank_spar", name: "Moank (Sparkonto)", rate: 3.70, guarantee: true, isBigBank: false },
    
    // Bundna alternativ (For comparison)
    { id: "avanza_3m", name: "Avanza Sparkonto+ (3 mån)", rate: 3.90, guarantee: true, isBigBank: false },
    { id: "sbab_3m", name: "SBAB (3 mån)", rate: 3.50, guarantee: true, isBigBank: false }
];

window.SAVINGS_ACCOUNTS = SAVINGS_ACCOUNTS;
