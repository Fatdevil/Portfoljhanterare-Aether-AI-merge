/**
 * mortgage.js — Mortgage Rate Portfolio Engine
 * 
 * Fetches historical Swedish mortgage rates from SCB (Statistics Sweden)
 * and provides portfolio simulation, backtesting, and scenario analysis.
 * 
 * Data source: SCB FM5001C/RantaT04N
 * "Bolåneräntor till hushåll fördelat på räntebindningstid"
 */

const MortgageEngine = {

    // ── Rate binding types ──────────────────────────────────────────
    BINDING_TYPES: [
        { id: 'variable',     label: 'Rörlig (3 mån)',  months: 3,   color: '#00d4ff' },
        { id: 'fixed_1y',     label: 'Bunden 1 år',     months: 12,  color: '#00ff88' },
        { id: 'fixed_2y',     label: 'Bunden 2 år',     months: 24,  color: '#ffaa00' },
        { id: 'fixed_3y',     label: 'Bunden 3 år',     months: 36,  color: '#ff6600' },
        { id: 'fixed_5y',     label: 'Bunden 3-5 år',   months: 60,  color: '#ff3366' },
        { id: 'fixed_5y_plus', label: 'Bunden 5+ år',   months: 84,  color: '#aa33ff' },
    ],

    // ── State ───────────────────────────────────────────────────────
    rateData: null,      // { variable: { "2005M09": 2.60, ... }, ... }
    months: [],          // Sorted list of all months
    isLoaded: false,

    // ── SCB API Configuration ───────────────────────────────────────
    SCB_API_URL: 'https://api.scb.se/OV0104/v1/doris/sv/ssd/FM/FM5001/FM5001C/RantaT04N',

    SCB_QUERY: {
        query: [
            { code: "Referenssektor", selection: { filter: "item", values: ["1"] } },
            { code: "Motpartssektor", selection: { filter: "item", values: ["2c"] } },
            { code: "Avtal",          selection: { filter: "item", values: ["0100"] } },
            { code: "Rantebindningstid", selection: { filter: "item", values: [
                "1.1.1", "1.1.2.1", "1.1.2.2.1.1", "1.1.2.2.1.2", "1.1.2.2.2", "1.1.2.3"
            ]}}
        ],
        response: { format: "json" }
    },

    SCB_CODE_MAP: {
        '1.1.1':       'variable',
        '1.1.2.1':     'fixed_1y',
        '1.1.2.2.1.1': 'fixed_2y',
        '1.1.2.2.1.2': 'fixed_3y',
        '1.1.2.2.2':   'fixed_5y',
        '1.1.2.3':     'fixed_5y_plus',
    },

    // ── Data Loading ────────────────────────────────────────────────
    
    /**
     * Load rate data — try SCB API first, fallback to local file
     */
    async loadData(statusEl) {
        if (this.isLoaded) return this.rateData;

        if (statusEl) statusEl.textContent = 'Hämtar bolåneräntor från SCB...';

        // Try SCB API first
        try {
            const resp = await fetch(this.SCB_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.SCB_QUERY),
                signal: AbortSignal.timeout(8000),
            });
            
            if (resp.ok) {
                const raw = await resp.json();
                this.rateData = this._parseSCBResponse(raw);
                this._buildMonthIndex();
                this.isLoaded = true;
                if (statusEl) statusEl.textContent = `SCB-data laddad: ${this.months.length} månader`;
                console.log(`[Mortgage] Loaded ${this.months.length} months from SCB API`);
                return this.rateData;
            }
        } catch (e) {
            console.warn('[Mortgage] SCB API failed, trying local fallback:', e.message);
        }

        // Fallback to local pre-processed file
        try {
            if (statusEl) statusEl.textContent = 'Använder lokal räntedata...';
            const resp = await fetch('scb_clean.json');
            this.rateData = await resp.json();
            this._buildMonthIndex();
            this.isLoaded = true;
            if (statusEl) statusEl.textContent = `Lokal data laddad: ${this.months.length} månader`;
            console.log(`[Mortgage] Loaded ${this.months.length} months from local file`);
            return this.rateData;
        } catch (e) {
            console.error('[Mortgage] All data sources failed:', e);
            throw new Error('Kunde inte ladda bolånedata');
        }
    },

    _parseSCBResponse(raw) {
        const result = {};
        for (const label of Object.values(this.SCB_CODE_MAP)) {
            result[label] = {};
        }
        for (const entry of raw.data) {
            const label = this.SCB_CODE_MAP[entry.key[3]];
            const rate = parseFloat(entry.values[0]);
            if (label && !isNaN(rate)) {
                result[label][entry.key[4]] = Math.round(rate * 100) / 100;
            }
        }
        return result;
    },

    _buildMonthIndex() {
        // Build sorted union of all available months
        const allMonths = new Set();
        for (const type of Object.values(this.rateData)) {
            for (const m of Object.keys(type)) allMonths.add(m);
        }
        this.months = [...allMonths].sort();
    },

    // ── Helpers ─────────────────────────────────────────────────────

    /**
     * Parse SCB month string "2023M06" -> Date
     */
    parseMonth(m) {
        const [y, mo] = m.split('M');
        return new Date(parseInt(y), parseInt(mo) - 1, 1);
    },

    /**
     * Format month for display "2023M06" -> "Jun 2023"
     */
    formatMonth(m) {
        const date = this.parseMonth(m);
        return date.toLocaleDateString('sv-SE', { month: 'short', year: 'numeric' });
    },

    /**
     * Get rate for a specific binding type and month
     * Falls back to nearest available if exact month missing
     */
    getRate(bindingId, month) {
        const series = this.rateData[bindingId];
        if (!series) return null;
        if (series[month] !== undefined) return series[month];
        
        // Fallback: find nearest earlier month
        const sorted = Object.keys(series).sort();
        for (let i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i] <= month) return series[sorted[i]];
        }
        return null;
    },

    /**
     * Get the latest available rates for all binding types
     */
    getLatestRates() {
        const latest = {};
        const lastMonth = this.months[this.months.length - 1];
        for (const bt of this.BINDING_TYPES) {
            latest[bt.id] = this.getRate(bt.id, lastMonth);
        }
        latest.month = lastMonth;
        return latest;
    },

    // ── Portfolio Simulation ────────────────────────────────────────
    
    /**
     * Calculate monthly cost for a mortgage portfolio
     * @param {number} loanAmount - Total loan in SEK
     * @param {object} weights - { variable: 0.5, fixed_3y: 0.3, fixed_5y: 0.2 }
     * @param {string} month - SCB month string
     * @param {number} taxDeduction - Ränteavdrag rate (default 0.30)
     * @returns {object} { grossCost, netCost, effectiveRate, breakdown }
     */
    calculateMonthlyCost(loanAmount, weights, month, taxDeduction = 0.30) {
        let totalWeightedRate = 0;
        const breakdown = [];

        for (const bt of this.BINDING_TYPES) {
            const w = weights[bt.id] || 0;
            if (w <= 0) continue;

            const rate = this.getRate(bt.id, month);
            if (rate === null) continue;

            const share = loanAmount * w;
            const monthlyCost = (share * (rate / 100)) / 12;
            totalWeightedRate += w * rate;

            breakdown.push({
                id: bt.id,
                label: bt.label,
                weight: w,
                rate: rate,
                share: share,
                monthlyCost: monthlyCost,
            });
        }

        const grossMonthly = (loanAmount * (totalWeightedRate / 100)) / 12;
        const taxSaving = grossMonthly * taxDeduction;
        const netMonthly = grossMonthly - taxSaving;

        return {
            grossCost: Math.round(grossMonthly),
            netCost: Math.round(netMonthly),
            effectiveRate: Math.round(totalWeightedRate * 100) / 100,
            netRate: Math.round(totalWeightedRate * (1 - taxDeduction) * 100) / 100,
            taxSaving: Math.round(taxSaving),
            breakdown,
            month,
        };
    },

    // ── Backtest Engine ─────────────────────────────────────────────

    /**
     * Run a historical backtest of a mortgage portfolio strategy
     * 
     * Simulates what the customer would have paid over a given period
     * with their chosen rate mix.
     * 
     * For fixed rates: Locks in the rate at the start of each binding period.
     *   When the period expires, re-locks at the new prevailing rate.
     * For variable: Updates every 3 months.
     * 
     * @param {number} loanAmount - Loan in SEK
     * @param {object} weights - { variable: 0.5, fixed_5y: 0.5 }
     * @param {string} startMonth - e.g. "2010M01"
     * @param {string} endMonth - e.g. "2026M02"
     * @returns {object} { totalPaid, avgRate, monthlyHistory, summary }
     */
    backtest(loanAmount, weights, startMonth, endMonth) {
        const startIdx = this.months.indexOf(startMonth);
        const endIdx = this.months.indexOf(endMonth);
        if (startIdx < 0 || endIdx < 0 || startIdx >= endIdx) {
            return null;
        }

        // Track locked rates and their expiry for each portion
        const locks = {};
        for (const bt of this.BINDING_TYPES) {
            const w = weights[bt.id] || 0;
            if (w > 0) {
                locks[bt.id] = { 
                    weight: w,
                    lockedRate: null,
                    expiryIdx: startIdx, // Force immediate lock
                    months: bt.months,
                };
            }
        }

        let totalPaid = 0;
        let totalPaidNet = 0;
        const monthlyHistory = [];
        const rateHistory = [];

        for (let i = startIdx; i <= endIdx; i++) {
            const month = this.months[i];
            let weightedRate = 0;

            for (const [id, lock] of Object.entries(locks)) {
                // Check if we need to re-lock
                if (i >= lock.expiryIdx) {
                    const newRate = this.getRate(id, month);
                    lock.lockedRate = newRate;
                    lock.expiryIdx = i + lock.months;
                }

                if (lock.lockedRate !== null) {
                    weightedRate += lock.weight * lock.lockedRate;
                }
            }

            const grossMonthly = (loanAmount * (weightedRate / 100)) / 12;
            const netMonthly = grossMonthly * 0.70; // After 30% tax deduction
            totalPaid += grossMonthly;
            totalPaidNet += netMonthly;

            monthlyHistory.push({
                month,
                rate: Math.round(weightedRate * 100) / 100,
                grossCost: Math.round(grossMonthly),
                netCost: Math.round(netMonthly),
            });
        }

        const numMonths = endIdx - startIdx + 1;
        const avgRate = monthlyHistory.reduce((s, m) => s + m.rate, 0) / numMonths;

        return {
            totalPaidGross: Math.round(totalPaid),
            totalPaidNet: Math.round(totalPaidNet),
            avgRate: Math.round(avgRate * 100) / 100,
            numMonths,
            startMonth,
            endMonth,
            monthlyHistory,
        };
    },

    /**
     * Compare multiple portfolio strategies over the same period
     */
    compareStrategies(loanAmount, strategies, startMonth, endMonth) {
        const results = strategies.map(s => ({
            name: s.name,
            weights: s.weights,
            result: this.backtest(loanAmount, s.weights, startMonth, endMonth),
        }));

        // Sort by total cost
        results.sort((a, b) => a.result.totalPaidNet - b.result.totalPaidNet);

        // Add savings vs worst strategy
        const worst = results[results.length - 1];
        for (const r of results) {
            r.savings = worst.result.totalPaidNet - r.result.totalPaidNet;
        }

        return results;
    },

    /**
     * Get predefined standard strategies for comparison
     */
    getStandardStrategies() {
        return [
            { 
                name: '100% Rörlig',
                description: 'Maximalt flexibelt, men exponerat för ränteökningar',
                weights: { variable: 1.0 }
            },
            { 
                name: '100% Bunden 3-5 år',
                description: 'Maximal trygghet, men potentiellt dyrare',
                weights: { fixed_5y: 1.0 }
            },
            {
                name: '50/50 Mix',
                description: 'Klassisk mix av rörligt och bundet',
                weights: { variable: 0.50, fixed_5y: 0.50 }
            },
            {
                name: 'Trappa (33/33/33)',
                description: 'Diversifierad räntebindning',
                weights: { variable: 0.34, fixed_3y: 0.33, fixed_5y: 0.33 }
            },
            {
                name: '70/30 Rörlig-tung',
                description: 'Satsar på att rörligt vinner long-term',
                weights: { variable: 0.70, fixed_5y: 0.30 }
            },
        ];
    },

    // ── Scenario Analysis ───────────────────────────────────────────

    /**
     * Simulate impact of rate changes on the portfolio
     * @param {number} loanAmount
     * @param {object} weights
     * @param {number} rateChangePercent - e.g. +1.0 for +1% rate hike
     * @returns {object} Impact analysis
     */
    simulateRateChange(loanAmount, weights, rateChangePercent) {
        const latest = this.getLatestRates();
        const currentMonth = latest.month;

        // Current cost
        const current = this.calculateMonthlyCost(loanAmount, weights, currentMonth);
        
        // Simulate: variable rate moves immediately, fixed stays locked
        let newWeightedRate = 0;
        const impacts = [];

        for (const bt of this.BINDING_TYPES) {
            const w = weights[bt.id] || 0;
            if (w <= 0) continue;

            const currentRate = latest[bt.id] || 0;
            let newRate;
            
            if (bt.id === 'variable') {
                // Variable rate moves immediately
                newRate = currentRate + rateChangePercent;
            } else {
                // Fixed rates: locked, no change until expiry
                newRate = currentRate;
            }

            newWeightedRate += w * newRate;
            impacts.push({
                id: bt.id,
                label: bt.label,
                weight: w,
                currentRate,
                newRate: Math.round(newRate * 100) / 100,
                change: Math.round((newRate - currentRate) * 100) / 100,
                affected: bt.id === 'variable',
            });
        }

        const newGrossMonthly = (loanAmount * (newWeightedRate / 100)) / 12;
        const newNetMonthly = newGrossMonthly * 0.70;

        return {
            currentMonthlyCost: current.netCost,
            newMonthlyCost: Math.round(newNetMonthly),
            monthlyDiff: Math.round(newNetMonthly - current.netCost),
            yearlyDiff: Math.round((newNetMonthly - current.netCost) * 12),
            currentRate: current.effectiveRate,
            newRate: Math.round(newWeightedRate * 100) / 100,
            impacts,
            rateChange: rateChangePercent,
        };
    },

    // ── Statistics ───────────────────────────────────────────────────

    /**
     * Get summary statistics for the full historical period
     */
    getHistoricalStats() {
        const stats = {};
        
        for (const bt of this.BINDING_TYPES) {
            const series = this.rateData[bt.id];
            if (!series) continue;

            const values = Object.values(series).filter(v => !isNaN(v));
            if (values.length === 0) continue;

            const months = Object.keys(series).sort();
            
            stats[bt.id] = {
                label: bt.label,
                current: values[values.length - 1],
                min: Math.min(...values),
                max: Math.max(...values),
                avg: Math.round(values.reduce((s, v) => s + v, 0) / values.length * 100) / 100,
                volatility: Math.round(this._stdDev(values) * 100) / 100,
                dataPoints: values.length,
                firstMonth: months[0],
                lastMonth: months[months.length - 1],
            };
        }

        return stats;
    },

    _stdDev(arr) {
        const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
        const sqDiffs = arr.map(v => Math.pow(v - avg, 2));
        return Math.sqrt(sqDiffs.reduce((s, v) => s + v, 0) / arr.length);
    },

    /**
     * Find periods where binding was cheapest
     * (Rolling window analysis)
     */
    findCheapestPeriods(windowMonths = 60) {
        const results = [];
        const types = ['variable', 'fixed_1y', 'fixed_5y'];

        for (let i = 0; i <= this.months.length - windowMonths; i++) {
            const start = this.months[i];
            const end = this.months[i + windowMonths - 1];

            const costs = {};
            let allAvailable = true;

            for (const type of types) {
                let sum = 0;
                let count = 0;
                for (let j = i; j < i + windowMonths; j++) {
                    const rate = this.getRate(type, this.months[j]);
                    if (rate !== null) {
                        sum += rate;
                        count++;
                    }
                }
                if (count > 0) {
                    costs[type] = Math.round((sum / count) * 100) / 100;
                } else {
                    allAvailable = false;
                }
            }

            if (allAvailable) {
                const cheapest = Object.entries(costs).sort((a, b) => a[1] - b[1])[0];
                results.push({
                    startMonth: start,
                    endMonth: end,
                    costs,
                    cheapest: cheapest[0],
                    cheapestRate: cheapest[1],
                });
            }
        }

        return results;
    },
};
