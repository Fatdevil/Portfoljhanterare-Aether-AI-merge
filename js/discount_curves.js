// AUTO-GENERATED FILE — Uppdateras veckovis av calibrate_discount_curves.py
// Senast kalibrerad: 2026-04-05 (initial manuell kalibrering)
//
// Avdragskurvor per bank, bindningstid och belåningsgrad (LTV).
// Avdrag = Listränta − Personlig ränta
// Personlig ränta = Listränta − interpolate(discount_curve, LTV)
//
// Banker utan öppen kalkylator (Nordea, SEB, Swedbank, Handelsbanken,
// Danske Bank, Länsförsäkringar) har INTE avdragskurvor — de visas
// enbart med listränta/snittränta.

const DISCOUNT_CURVES = {
    // ═══════════════════════════════════════════════════════
    //  SBAB — Kalibrerad mot sbab.se/sa_blir_din_ranta
    //  Modell: Ren LTV-baserad, inga förhandlingsrabatter
    //  Känt datapunkt: 50% LTV rörlig = 2.67% (list 3.20, avdrag 0.53)
    // ═══════════════════════════════════════════════════════
    "SBAB": {
        "variable":  { "25": 0.72, "30": 0.68, "40": 0.60, "50": 0.53, "60": 0.44, "70": 0.35, "75": 0.28, "80": 0.20, "85": 0.12 },
        "fixed_1y":  { "25": 0.78, "30": 0.73, "40": 0.65, "50": 0.57, "60": 0.48, "70": 0.38, "75": 0.30, "80": 0.22, "85": 0.13 },
        "fixed_2y":  { "25": 0.80, "30": 0.75, "40": 0.67, "50": 0.59, "60": 0.49, "70": 0.39, "75": 0.31, "80": 0.23, "85": 0.14 },
        "fixed_3y":  { "25": 0.82, "30": 0.77, "40": 0.69, "50": 0.60, "60": 0.50, "70": 0.40, "75": 0.32, "80": 0.24, "85": 0.14 },
        "fixed_5y":  { "25": 0.84, "30": 0.79, "40": 0.71, "50": 0.62, "60": 0.52, "70": 0.42, "75": 0.34, "80": 0.25, "85": 0.15 }
    },

    // ═══════════════════════════════════════════════════════
    //  SKANDIABANKEN — Kalibrerad mot skandia.se/bolan
    //  Modell: LTV-baserad + möjlig tjänstepensionsrabatt
    // ═══════════════════════════════════════════════════════
    "Skandiabanken": {
        "variable":  { "25": 1.55, "30": 1.48, "40": 1.35, "50": 1.20, "60": 1.00, "70": 0.80, "75": 0.68, "80": 0.50, "85": 0.30 },
        "fixed_1y":  { "25": 1.55, "30": 1.48, "40": 1.35, "50": 1.20, "60": 1.00, "70": 0.80, "75": 0.68, "80": 0.50, "85": 0.30 },
        "fixed_2y":  { "25": 1.60, "30": 1.53, "40": 1.39, "50": 1.24, "60": 1.04, "70": 0.83, "75": 0.70, "80": 0.52, "85": 0.32 },
        "fixed_3y":  { "25": 1.65, "30": 1.58, "40": 1.43, "50": 1.27, "60": 1.07, "70": 0.85, "75": 0.72, "80": 0.54, "85": 0.33 },
        "fixed_5y":  { "25": 1.70, "30": 1.63, "40": 1.48, "50": 1.32, "60": 1.10, "70": 0.88, "75": 0.75, "80": 0.56, "85": 0.35 }
    },

    // ═══════════════════════════════════════════════════════
    //  ICA BANKEN — Kalibrerad mot icabanken.se/bolan
    //  Modell: LTV-baserad + ICA-stammisrabatt (ej inkluderad här)
    // ═══════════════════════════════════════════════════════
    "ICA Banken": {
        "variable":  { "25": 0.95, "30": 0.90, "40": 0.80, "50": 0.68, "60": 0.56, "70": 0.42, "75": 0.34, "80": 0.24, "85": 0.14 },
        "fixed_1y":  { "25": 1.20, "30": 1.14, "40": 1.02, "50": 0.88, "60": 0.74, "70": 0.56, "75": 0.46, "80": 0.34, "85": 0.20 },
        "fixed_2y":  { "25": 1.35, "30": 1.28, "40": 1.15, "50": 1.00, "60": 0.84, "70": 0.64, "75": 0.52, "80": 0.39, "85": 0.23 },
        "fixed_3y":  { "25": 1.45, "30": 1.38, "40": 1.24, "50": 1.08, "60": 0.90, "70": 0.70, "75": 0.57, "80": 0.42, "85": 0.25 },
        "fixed_5y":  { "25": 1.65, "30": 1.57, "40": 1.42, "50": 1.24, "60": 1.04, "70": 0.80, "75": 0.66, "80": 0.49, "85": 0.29 }
    }
};

// Metadata
const DISCOUNT_CURVES_META = {
    lastCalibrated: "2026-04-05",
    method: "initial_manual",  // Will become "playwright_auto" after first calibration
    ltvLevels: [25, 30, 40, 50, 60, 70, 75, 80, 85],
    banks: Object.keys(DISCOUNT_CURVES),
    note: "Avdrag i procentenheter. Personlig ränta = listränta − avdrag. Interpolera för mellanliggande LTV."
};

window.DISCOUNT_CURVES = DISCOUNT_CURVES;
window.DISCOUNT_CURVES_META = DISCOUNT_CURVES_META;
