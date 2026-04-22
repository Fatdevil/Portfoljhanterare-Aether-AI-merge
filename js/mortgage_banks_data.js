// AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.
// Uppdaterad: 2026-04-22 — Verifierade listräntor
// Källor: sbab.se, nordea.se, handelsbanken.se, swedbank.se, seb.se, lansforsakringar.se, skandia.se, danskebank.se, SCB FM5001C
// Snitträntor: SCB Finansmarknadsstatistik — nya avtal
const MORTGAGE_BANKS = [
    // ═══════════════════════════════════════════
    //  RÖRLIG (3 MÅN) — Listränta & Snittränta
    // ═══════════════════════════════════════════
    {"id": "sbab_m3", "name": "SBAB", "type": "variable", "listRate": 3.2, "avgRate": 2.65, "isBigBank": false},
    {"id": "ica_m3", "name": "ICA Banken", "type": "variable", "listRate": 3.48, "avgRate": 2.7, "isBigBank": false},
    {"id": "lansforsakringar_m3", "name": "Länsförsäkringar", "type": "variable", "listRate": 3.84, "avgRate": 2.65, "isBigBank": false},
    {"id": "swedbank_m3", "name": "Swedbank", "type": "variable", "listRate": 3.94, "avgRate": 2.75, "isBigBank": true},
    {"id": "seb_m3", "name": "SEB", "type": "variable", "listRate": 3.99, "avgRate": 2.63, "isBigBank": true},
    {"id": "nordea_m3", "name": "Nordea", "type": "variable", "listRate": 3.99, "avgRate": 2.7, "isBigBank": true},
    {"id": "handelsbanken_m3", "name": "Handelsbanken", "type": "variable", "listRate": 3.99, "avgRate": 2.63, "isBigBank": true},
    {"id": "skandia_m3", "name": "Skandiabanken", "type": "variable", "listRate": 4.08, "avgRate": 2.7, "isBigBank": false},
    {"id": "danske_m3", "name": "Danske Bank", "type": "variable", "listRate": 4.39, "avgRate": 2.8, "isBigBank": true},
    // ═══════════════════════════════════════════
    //  BUNDEN 1 ÅR — Listränta & Snittränta
    // ═══════════════════════════════════════════
    {"id": "danske_1y", "name": "Danske Bank", "type": "fixed_1y", "listRate": 3.49, "avgRate": 2.55, "isBigBank": true},
    {"id": "sbab_1y", "name": "SBAB", "type": "fixed_1y", "listRate": 3.62, "avgRate": 2.55, "isBigBank": false},
    {"id": "lansforsakringar_1y", "name": "Länsförsäkringar", "type": "fixed_1y", "listRate": 3.69, "avgRate": 2.6, "isBigBank": false},
    {"id": "seb_1y", "name": "SEB", "type": "fixed_1y", "listRate": 3.99, "avgRate": 2.7, "isBigBank": true},
    {"id": "ica_1y", "name": "ICA Banken", "type": "fixed_1y", "listRate": 4.0, "avgRate": 2.7, "isBigBank": false},
    {"id": "nordea_1y", "name": "Nordea", "type": "fixed_1y", "listRate": 4.05, "avgRate": 2.7, "isBigBank": true},
    {"id": "skandia_1y", "name": "Skandiabanken", "type": "fixed_1y", "listRate": 4.08, "avgRate": 2.65, "isBigBank": false},
    {"id": "handelsbanken_1y", "name": "Handelsbanken", "type": "fixed_1y", "listRate": 4.15, "avgRate": 2.75, "isBigBank": true},
    {"id": "swedbank_1y", "name": "Swedbank", "type": "fixed_1y", "listRate": 4.17, "avgRate": 2.8, "isBigBank": true},
    // ═══════════════════════════════════════════
    //  BUNDEN 2 ÅR — Listränta & Snittränta
    // ═══════════════════════════════════════════
    {"id": "swedbank_2y", "name": "Swedbank", "type": "fixed_2y", "listRate": 3.34, "avgRate": 2.5, "isBigBank": true},
    {"id": "seb_2y", "name": "SEB", "type": "fixed_2y", "listRate": 3.34, "avgRate": 2.5, "isBigBank": true},
    {"id": "handelsbanken_2y", "name": "Handelsbanken", "type": "fixed_2y", "listRate": 3.49, "avgRate": 2.55, "isBigBank": true},
    {"id": "danske_2y", "name": "Danske Bank", "type": "fixed_2y", "listRate": 3.66, "avgRate": 2.55, "isBigBank": true},
    {"id": "lansforsakringar_2y", "name": "Länsförsäkringar", "type": "fixed_2y", "listRate": 3.74, "avgRate": 2.6, "isBigBank": false},
    {"id": "sbab_2y", "name": "SBAB", "type": "fixed_2y", "listRate": 3.84, "avgRate": 2.65, "isBigBank": false},
    {"id": "nordea_2y", "name": "Nordea", "type": "fixed_2y", "listRate": 3.89, "avgRate": 2.6, "isBigBank": true},
    {"id": "skandia_2y", "name": "Skandiabanken", "type": "fixed_2y", "listRate": 4.27, "avgRate": 2.8, "isBigBank": false},
    {"id": "ica_2y", "name": "ICA Banken", "type": "fixed_2y", "listRate": 4.3, "avgRate": 2.8, "isBigBank": false},
    // ═══════════════════════════════════════════
    //  BUNDEN 3 ÅR — Listränta & Snittränta
    // ═══════════════════════════════════════════
    {"id": "lansforsakringar_3y", "name": "Länsförsäkringar", "type": "fixed_3y", "listRate": 3.75, "avgRate": 2.55, "isBigBank": false},
    {"id": "nordea_3y", "name": "Nordea", "type": "fixed_3y", "listRate": 3.75, "avgRate": 2.55, "isBigBank": true},
    {"id": "danske_3y", "name": "Danske Bank", "type": "fixed_3y", "listRate": 3.79, "avgRate": 2.6, "isBigBank": true},
    {"id": "seb_3y", "name": "SEB", "type": "fixed_3y", "listRate": 3.85, "avgRate": 2.65, "isBigBank": true},
    {"id": "handelsbanken_3y", "name": "Handelsbanken", "type": "fixed_3y", "listRate": 3.85, "avgRate": 2.6, "isBigBank": true},
    {"id": "swedbank_3y", "name": "Swedbank", "type": "fixed_3y", "listRate": 3.89, "avgRate": 2.7, "isBigBank": true},
    {"id": "sbab_3y", "name": "SBAB", "type": "fixed_3y", "listRate": 3.99, "avgRate": 2.65, "isBigBank": false},
    {"id": "skandia_3y", "name": "Skandiabanken", "type": "fixed_3y", "listRate": 4.39, "avgRate": 2.85, "isBigBank": false},
    {"id": "ica_3y", "name": "ICA Banken", "type": "fixed_3y", "listRate": 4.5, "avgRate": 2.9, "isBigBank": false},
    // ═══════════════════════════════════════════
    //  BUNDEN 5 ÅR — Listränta & Snittränta
    // ═══════════════════════════════════════════
    {"id": "swedbank_5y", "name": "Swedbank", "type": "fixed_5y", "listRate": 3.69, "avgRate": 2.55, "isBigBank": true},
    {"id": "seb_5y", "name": "SEB", "type": "fixed_5y", "listRate": 3.69, "avgRate": 2.55, "isBigBank": true},
    {"id": "handelsbanken_5y", "name": "Handelsbanken", "type": "fixed_5y", "listRate": 3.89, "avgRate": 2.65, "isBigBank": true},
    {"id": "danske_5y", "name": "Danske Bank", "type": "fixed_5y", "listRate": 3.94, "avgRate": 2.65, "isBigBank": true},
    {"id": "lansforsakringar_5y", "name": "Länsförsäkringar", "type": "fixed_5y", "listRate": 4.09, "avgRate": 2.7, "isBigBank": false},
    {"id": "nordea_5y", "name": "Nordea", "type": "fixed_5y", "listRate": 4.09, "avgRate": 2.7, "isBigBank": true},
    {"id": "sbab_5y", "name": "SBAB", "type": "fixed_5y", "listRate": 4.19, "avgRate": 2.75, "isBigBank": false},
    {"id": "skandia_5y", "name": "Skandiabanken", "type": "fixed_5y", "listRate": 4.58, "avgRate": 2.95, "isBigBank": false},
    {"id": "ica_5y", "name": "ICA Banken", "type": "fixed_5y", "listRate": 4.87, "avgRate": 3.1, "isBigBank": false},
];

window.MORTGAGE_BANKS = MORTGAGE_BANKS;

// Metadata — used by the UI to show data freshness
const MORTGAGE_BANKS_META = {
    "lastUpdated": "2026-04-22",
    "lastVerified": "2026-04-22",
    "sources": "sbab.se, nordea.se, handelsbanken.se, swedbank.se, seb.se, lansforsakringar.se, skandia.se, danskebank.se, SCB FM5001C",
    "avgRateSource": "SCB Finansmarknadsstatistik — nya avtal",
    "totalBanks": 45
};
window.MORTGAGE_BANKS_META = MORTGAGE_BANKS_META;
