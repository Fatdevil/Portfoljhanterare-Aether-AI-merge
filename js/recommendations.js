/**
 * recommendations.js — Buy/sell recommendation engine
 */

const Recommendations = {

    /**
     * Generate rebalancing recommendations
     * @param {Object[]} userPositions  — [{ assetId, currentValue, costBasis }]
     * @param {number[]} targetWeights  — target allocation weights
     * @param {string} taxEnv           — 'ISK' or 'DEPA'
     * @param {string} targetName       — name of target portfolio
     * @returns {Object} recommendations
     */
    generate(userPositions, targetWeights, taxEnv, targetName = 'Optimal') {
        const n = ASSET_CLASSES.length;
        const totalValue = userPositions.reduce((s, p) => s + p.currentValue, 0);

        if (totalValue <= 0) return null;

        // Build current weights
        const currentWeights = new Array(n).fill(0);
        const positions = new Array(n).fill(null).map((_, i) => ({
            assetId: ASSET_CLASSES[i].id,
            assetName: ASSET_CLASSES[i].name,
            currentValue: 0,
            costBasis: 0,
        }));

        for (const pos of userPositions) {
            const idx = ASSET_CLASSES.findIndex(a => a.id === pos.assetId);
            if (idx >= 0) {
                positions[idx].currentValue = pos.currentValue;
                positions[idx].costBasis = pos.costBasis;
                currentWeights[idx] = pos.currentValue / totalValue;
            }
        }

        // Calculate trades
        const sells = [];
        const buys = [];
        let totalSellValue = 0;
        let totalTax = 0;
        let totalReinvestable = 0;

        for (let i = 0; i < n; i++) {
            const currentVal = positions[i].currentValue;
            const targetVal = totalValue * targetWeights[i];
            const diff = targetVal - currentVal;

            if (diff < -10) {
                // Need to sell
                const sellAmount = Math.abs(diff);
                let tax = 0;
                let netProceeds = sellAmount;

                if (taxEnv === 'DEPA') {
                    // Schablonmetoden (20% rule)
                    const effectiveCostBasisUser = positions[i].costBasis > 0 ? positions[i].costBasis : 0;
                    const effectiveCostBasis = Math.max(effectiveCostBasisUser, currentVal * 0.20);
                    
                    const proportion = currentVal > 0 ? sellAmount / currentVal : 0;
                    const propCostBasis = effectiveCostBasis * proportion;
                    const gain = Math.max(0, sellAmount - propCostBasis);
                    tax = gain * 0.30;
                    netProceeds = sellAmount - tax;
                }

                sells.push({
                    asset: ASSET_CLASSES[i],
                    currentValue: currentVal,
                    sellAmount,
                    costBasis: positions[i].costBasis,
                    gain: taxEnv === 'DEPA' ? Math.max(0, sellAmount - (positions[i].costBasis * (sellAmount / Math.max(currentVal, 1)))) : 0,
                    tax,
                    netProceeds,
                    currentWeight: currentWeights[i],
                    targetWeight: targetWeights[i],
                    weightDiff: targetWeights[i] - currentWeights[i],
                });

                totalSellValue += sellAmount;
                totalTax += tax;
                totalReinvestable += netProceeds;
            } else if (diff > 10) {
                buys.push({
                    asset: ASSET_CLASSES[i],
                    currentValue: currentVal,
                    buyAmount: diff,
                    currentWeight: currentWeights[i],
                    targetWeight: targetWeights[i],
                    weightDiff: targetWeights[i] - currentWeights[i],
                });
            }
        }

        // Adjust buys if tax reduces available capital
        const totalBuyTarget = buys.reduce((s, b) => s + b.buyAmount, 0);
        if (taxEnv === 'DEPA' && totalTax > 0 && totalBuyTarget > 0) {
            const adjustFactor = Math.max(0, (totalBuyTarget - totalTax)) / totalBuyTarget;
            buys.forEach(b => {
                b.adjustedBuyAmount = b.buyAmount * adjustFactor;
                b.taxImpact = b.buyAmount - b.adjustedBuyAmount;
            });
        } else {
            buys.forEach(b => {
                b.adjustedBuyAmount = b.buyAmount;
                b.taxImpact = 0;
            });
        }

        return {
            targetName,
            taxEnvironment: taxEnv,
            totalPortfolioValue: totalValue,
            sells: sells.sort((a, b) => b.sellAmount - a.sellAmount),
            buys: buys.sort((a, b) => b.buyAmount - a.buyAmount),
            summary: {
                totalSellValue,
                totalTax,
                totalReinvestable,
                totalBuyTarget,
                adjustedBuyTotal: buys.reduce((s, b) => s + b.adjustedBuyAmount, 0),
                taxDrag: totalTax,
                taxDragPct: totalValue > 0 ? totalTax / totalValue : 0,
            },
        };
    },

    /**
     * Format recommendations as HTML table rows
     */
    formatSellsHTML(sells) {
        if (!sells || sells.length === 0) {
            return '<tr><td colspan="6" class="empty-cell">Inga försäljningar behövs</td></tr>';
        }

        return sells.map(s => `
            <tr class="sell-row">
                <td><span class="dot" style="background:${s.asset.color}"></span>${s.asset.name}</td>
                <td class="num">${TaxEngine.formatPct(s.currentWeight)}</td>
                <td class="num">${TaxEngine.formatPct(s.targetWeight)}</td>
                <td class="num negative">${TaxEngine.formatSEK(-s.sellAmount)}</td>
                <td class="num negative">${TaxEngine.formatSEK(-s.tax)}</td>
                <td class="num">${TaxEngine.formatSEK(s.netProceeds)}</td>
            </tr>
        `).join('');
    },

    formatBuysHTML(buys) {
        if (!buys || buys.length === 0) {
            return '<tr><td colspan="5" class="empty-cell">Inga köp behövs</td></tr>';
        }

        return buys.map(b => `
            <tr class="buy-row">
                <td><span class="dot" style="background:${b.asset.color}"></span>${b.asset.name}</td>
                <td class="num">${TaxEngine.formatPct(b.currentWeight)}</td>
                <td class="num">${TaxEngine.formatPct(b.targetWeight)}</td>
                <td class="num positive">+${TaxEngine.formatSEK(b.adjustedBuyAmount)}</td>
                <td class="num ${b.taxImpact > 0 ? 'negative' : ''}">${b.taxImpact > 0 ? TaxEngine.formatSEK(-b.taxImpact) : '—'}</td>
            </tr>
        `).join('');
    },
};
