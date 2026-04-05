/**
 * tax.js — Swedish ISK & Depå (normal) tax calculations
 */

const TaxEngine = {

    /* ── ISK rules 2025 ─────────────────────────────────────────────────── */
    ISK: {
        statslaneRanta: 0.0196,
        schablonRanta: 0.0296,       // statslåneränta + 1%
        taxRate: 0.30,               // kapitalskatt
        freeThreshold: 150000,       // skattefri grundnivå 2025
        effectiveRate: 0.30 * 0.0296, // ≈ 0.888%
    },

    /* ── Normal depå ────────────────────────────────────────────────────── */
    DEPA: {
        capitalGainsTax: 0.30,       // 30% skatt på realiserad vinst
        dividendTax: 0.30,           // 30% skatt på utdelningar
    },

    /**
     * Calculate annual ISK tax for a given capital base
     * @param {number} capitalBase   — average quarterly value
     * @returns {{ schablonIntakt, tax, effectiveRate }}
     */
    calculateISKTax(capitalBase) {
        const taxableBase = Math.max(0, capitalBase - this.ISK.freeThreshold);
        const schablonIntakt = taxableBase * this.ISK.schablonRanta;
        const tax = schablonIntakt * this.ISK.taxRate;
        const effectiveRate = capitalBase > 0 ? tax / capitalBase : 0;

        return {
            capitalBase,
            taxableBase,
            schablonRanta: this.ISK.schablonRanta,
            schablonIntakt,
            tax,
            effectiveRate,
        };
    },

    /**
     * Calculate capital gains tax when selling a position in normal depot
     * @param {number} sellValue   — försäljningsvärde
     * @param {number} costBasis   — anskaffningsvärde (ingångsvärde)
     * @returns {{ gain, tax, netProceeds, taxRate }}
     */
    calculateCapitalGainsTax(sellValue, costBasis) {
        const gain = Math.max(0, sellValue - costBasis);
        const tax = gain * this.DEPA.capitalGainsTax;
        const netProceeds = sellValue - tax;

        return {
            sellValue,
            costBasis,
            gain,
            tax,
            netProceeds,
            taxRate: sellValue > 0 ? tax / sellValue : 0,
            effectiveTaxOnSale: sellValue > costBasis ? tax / sellValue : 0,
        };
    },

    /**
     * Calculate what can be reinvested after selling and paying tax
     * @param {Object[]} positions — [{ assetId, currentValue, costBasis, sellAmount }]
     * @param {string} taxEnv — 'ISK' or 'DEPA'
     */
    calculateRebalancingTax(positions, taxEnv) {
        if (taxEnv === 'ISK') {
            // No capital gains tax in ISK — sell freely
            return positions.map(p => ({
                ...p,
                gain: 0,
                tax: 0,
                netProceeds: p.sellAmount,
                canReinvest: p.sellAmount,
            }));
        }

        // Normal depå
        return positions.map(p => {
            // Proportional cost basis for the sold amount
            const proportion = p.currentValue > 0 ? p.sellAmount / p.currentValue : 0;
            const proportionalCostBasis = p.costBasis * proportion;
            const result = this.calculateCapitalGainsTax(p.sellAmount, proportionalCostBasis);

            return {
                ...p,
                gain: result.gain,
                tax: result.tax,
                netProceeds: result.netProceeds,
                canReinvest: result.netProceeds,
            };
        });
    },

    /**
     * Simulate portfolio growth over N years in ISK vs Depå
     * Assumes yearly rebalancing and annual average return
     * @param {number} initialValue
     * @param {number} annualReturn      — expected annual return
     * @param {number} annualDividend    — dividend yield
     * @param {number} years
     * @param {number} turnoverRate      — annual portfolio turnover (0-1)
     * @param {boolean} liquidateFinalYear — sell 100% of the portfolio in the final year
     * @returns {{ isk: number[], depa: number[] }}
     */
    simulateGrowth(initialValue, annualReturn, annualDividend = 0.02, years = 30, turnoverRate = 0.20, liquidateFinalYear = true, initialCostBasis = null) {
        const iskValues = [initialValue];
        const depaValues = [initialValue];
        const iskTaxes = [0];
        const depaTaxes = [0];

        let iskVal = initialValue;
        let depaVal = initialValue;
        let depaCostBasis = initialCostBasis !== null ? initialCostBasis : initialValue;

        for (let y = 1; y <= years; y++) {
            // ── ISK ──
            // Growth
            const iskGrowth = iskVal * annualReturn;
            iskVal += iskGrowth;

            // ISK tax (on avg value, simplified)
            const iskTaxInfo = this.calculateISKTax(iskVal);
            iskVal -= iskTaxInfo.tax;

            iskValues.push(iskVal);
            iskTaxes.push(iskTaxInfo.tax);

            // ── Depå ──
            // Dividends taxed
            const dividends = depaVal * annualDividend;
            const dividendTax = dividends * this.DEPA.dividendTax;
            const priceReturn = annualReturn - annualDividend;

            // Price appreciation (unrealized — no tax until sold)
            const reinvestment = dividends - dividendTax;
            depaVal = depaVal * (1 + priceReturn) + reinvestment;

            // Reinvested dividends become new capital, so they increase the cost basis
            depaCostBasis += reinvestment;

            // Calculate effective cost basis using Schablonmetoden (20% rule)
            const effectiveCostBasis = Math.max(depaCostBasis, depaVal * 0.20);
            
            // Yearly rebalancing cost
            const turnover = (liquidateFinalYear && y === years) ? 1.0 : turnoverRate;
            const soldAmount = depaVal * turnover;
            const soldCostBasis = effectiveCostBasis * turnover;
            const rebalanceTax = Math.max(0, (soldAmount - soldCostBasis) * this.DEPA.capitalGainsTax);
            depaVal -= rebalanceTax;

            // Update cost basis
            depaCostBasis = depaCostBasis * (1 - turnover) + soldAmount - rebalanceTax;

            depaValues.push(depaVal);
            depaTaxes.push(dividendTax + rebalanceTax);
        }

        return {
            years: Array.from({ length: years + 1 }, (_, i) => i),
            isk: { values: iskValues, taxes: iskTaxes },
            depa: { values: depaValues, taxes: depaTaxes },
        };
    },

    /**
     * Beräknar "Tidsmaskinen" (När är skattesmällen intjänad?)
     * Delar ny portfölj i Kvarvarande (Depå) och Omplacerad (Auto ISK/Depå).
     */
    calculateBreakeven(oldTotalValue, oldCostBasis, oldReturn, oldFee, lockedValue, lockedCostBasis, reinvestValue, newReturn, newFee) {
        const years = 30;
        const oldNetReturn = Math.max(0, oldReturn - oldFee);
        const newNetReturn = Math.max(0, newReturn - newFee);

        // Turn turnover down to 0 to only pay tax at the final liquidation year for fair comparison
        const oldSim = this.simulateGrowth(oldTotalValue, oldNetReturn, 0, years, 0, true, oldCostBasis);
        const newLockedSim = this.simulateGrowth(lockedValue, newNetReturn, 0, years, 0, true, lockedCostBasis);

        // Simulate reinvestment in both environments
        const reinvestSim = this.simulateGrowth(reinvestValue, newNetReturn, 0, years, 0, true, reinvestValue);
        
        let bestEnv = 'ISK';
        if (reinvestSim.depa.values[years] > reinvestSim.isk.values[years]) {
            bestEnv = 'DEPÅ';
        }
        
        const bestReinvestValues = bestEnv === 'ISK' ? reinvestSim.isk.values : reinvestSim.depa.values;

        let breakevenYear = -1;
        let diffs = [];

        // Values are net worth after liquidation
        for (let y = 1; y <= years; y++) {
            const oldNet = oldSim.depa.values[y];
            const newNet = newLockedSim.depa.values[y] + bestReinvestValues[y];
            diffs.push(newNet - oldNet);

            if (breakevenYear === -1 && newNet > oldNet) {
                // Approximate exact decimal year via linear interpolation
                const prevOldNet = oldSim.depa.values[y - 1];
                const prevNewNet = newLockedSim.depa.values[y - 1] + bestReinvestValues[y - 1];
                const prevDiff = prevOldNet - prevNewNet; // How much we were behind
                const currentDiff = newNet - oldNet; // How much we are ahead
                
                const fraction = prevDiff / (prevDiff + currentDiff);
                breakevenYear = (y - 1) + fraction;
            }
        }

        return {
            breakevenYear,
            oldSim,
            bestEnv,
            diffs,
            oldExpectedNetReturn: oldNetReturn,
            newExpectedNetReturn: newNetReturn
        };
    },

    /**
     * Format SEK amount with thousand separators
     */
    formatSEK(amount) {
        return new Intl.NumberFormat('sv-SE', {
            style: 'currency',
            currency: 'SEK',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    },

    /**
     * Format percentage
     */
    formatPct(value, decimals = 1) {
        return (value * 100).toFixed(decimals) + '%';
    },
};
