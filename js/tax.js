/**
 * tax.js — Swedish ISK & Depå (normal) tax calculations
 */

const TaxEngine = {

    /* ── ISK rules 2026 ─────────────────────────────────────────────────── */
    ISK: {
        statslaneRanta: 0.0196,
        schablonRanta: 0.0296,       // statslåneränta + 1%
        taxRate: 0.30,               // kapitalskatt
        freeThreshold: 300000,       // skattefri grundnivå 2026 (höjd från 150k)
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
            // Quarterly average for capital base (regulatory requirement)
            const qReturn = Math.pow(1 + annualReturn, 0.25) - 1;
            const q1 = iskVal;
            const q2 = iskVal * (1 + qReturn);
            const q3 = q2 * (1 + qReturn);
            const q4 = q3 * (1 + qReturn);
            const avgQuarterlyValue = (q1 + q2 + q3 + q4) / 4;

            // Full year growth
            iskVal *= (1 + annualReturn);

            // ISK tax on quarterly average
            const iskTaxInfo = this.calculateISKTax(avgQuarterlyValue);
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

            // Yearly rebalancing cost
            const turnover = (liquidateFinalYear && y === years) ? 1.0 : turnoverRate;
            const soldAmount = depaVal * turnover;
            // Schablonmetoden: 20% of SALE PROCEEDS, not market value
            const schablonAvdrag = soldAmount * 0.20;
            const effectiveCostBasis = Math.max(depaCostBasis * turnover, schablonAvdrag);
            const rebalanceTax = Math.max(0, (soldAmount - effectiveCostBasis) * this.DEPA.capitalGainsTax);
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

    /**
     * Simulate Depå → ISK migration
     * Scenario A: Keep depå, sell at sellYear → see the tax cliff
     * Scenario B: Sell now → pay tax → invest in ISK
     */
    simulateDepaMigration(currentValue, costBasis, annualReturn, dividend = 0.02, years = 30, sellYear = null) {
        if (sellYear === null) sellYear = years;

        // ── Scenario A: Keep in Depå ──
        const depaGrossValues = [currentValue];
        const depaNetValues = [currentValue];
        let depaVal = currentValue;
        let depaCB = costBasis;

        for (let y = 1; y <= years; y++) {
            if (y <= sellYear) {
                const divs = depaVal * dividend;
                const divTax = divs * this.DEPA.dividendTax;
                const priceReturn = annualReturn - dividend;
                const reinvest = divs - divTax;
                depaVal = depaVal * (1 + priceReturn) + reinvest;
                depaCB += reinvest;
                depaGrossValues.push(depaVal);

                // Net if sold this year (schablonmetod: 20% of sale proceeds)
                const effectiveCB = Math.max(depaCB, depaVal * 0.20);
                const g = Math.max(0, depaVal - effectiveCB);
                depaNetValues.push(depaVal - g * this.DEPA.capitalGainsTax);
            } else {
                // After sell — flat at net value
                const soldNet = depaNetValues[sellYear];
                depaGrossValues.push(soldNet);
                depaNetValues.push(soldNet);
            }
        }

        // Tax at sell year
        const sellYearGross = depaGrossValues[Math.min(sellYear, years)];
        const sellEffCB = Math.max(depaCB, sellYearGross * 0.20);
        const depaSellGain = Math.max(0, sellYearGross - sellEffCB);
        const depaSellTax = depaSellGain * this.DEPA.capitalGainsTax;
        const depaSellNet = sellYearGross - depaSellTax;

        // ── Scenario B: Sell now → ISK ──
        const effectiveCBNow = Math.max(costBasis, currentValue * 0.20);
        const gain = Math.max(0, currentValue - effectiveCBNow);
        const sellTax = gain * this.DEPA.capitalGainsTax;
        const iskStartCapital = currentValue - sellTax;

        const iskValues = [iskStartCapital];
        let iskVal = iskStartCapital;

        for (let y = 1; y <= years; y++) {
            // Quarterly average for ISK capital base
            const qReturn = Math.pow(1 + annualReturn, 0.25) - 1;
            const q1 = iskVal;
            const q2 = iskVal * (1 + qReturn);
            const q3 = q2 * (1 + qReturn);
            const q4 = q3 * (1 + qReturn);
            const avgQ = (q1 + q2 + q3 + q4) / 4;

            iskVal *= (1 + annualReturn);
            const iskTaxInfo = this.calculateISKTax(avgQ);
            iskVal -= iskTaxInfo.tax;
            iskValues.push(iskVal);
        }

        // ── Chart line: Depå with cliff ──
        const depaChartValues = [];
        for (let y = 0; y <= years; y++) {
            if (y < sellYear) {
                depaChartValues.push(depaGrossValues[y]);
            } else {
                depaChartValues.push(depaNetValues[y]); // cliff at sellYear
            }
        }

        // ── Breakeven ──
        let breakevenYear = -1;
        for (let y = 1; y <= years; y++) {
            if (breakevenYear === -1 && iskValues[y] >= depaNetValues[y]) {
                if (y === 1) {
                    breakevenYear = 1;
                } else {
                    const prev = depaNetValues[y-1] - iskValues[y-1];
                    const curr = iskValues[y] - depaNetValues[y];
                    breakevenYear = (prev + curr) > 0
                        ? (y - 1) + Math.min(prev / (prev + curr), 1)
                        : y;
                }
            }
        }

        return {
            gain,
            sellTax,
            iskStartCapital,
            depaGrossValues,
            depaNetValues,
            depaChartValues,
            iskValues,
            depaSellNet,
            depaSellTax,
            depaSellGain,
            sellYear,
            iskFinal: iskValues[years],
            breakevenYear,
            years,
            advantage: iskValues[years] - depaNetValues[years],
            isFreeFromISKTax: iskStartCapital <= this.ISK.freeThreshold,
        };
    },
};
