/**
 * yahoo.js — Fetch historical price data from Yahoo Finance via CORS proxy
 * Falls back to hardcoded data if fetch fails
 */

const YahooFinance = {
    CORS_PROXIES: [
        (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    ],

    BASE_URL: 'https://query1.finance.yahoo.com/v8/finance/chart/',

    /**
     * Fetch monthly adjusted-close prices for the last 10 years.
     * Returns { timestamps: [...], prices: [...] }
     */
    async fetchPrices(ticker, range = '10y', interval = '1mo') {
        const rawUrl = `${this.BASE_URL}${ticker}?range=${range}&interval=${interval}&includeAdjustedClose=true`;

        for (const proxyFn of this.CORS_PROXIES) {
            try {
                const url = proxyFn(rawUrl);
                const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
                if (!resp.ok) continue;

                const data = await resp.json();
                const result = data?.chart?.result?.[0];
                if (!result) continue;

                const timestamps = result.timestamp;
                const adjClose = result.indicators?.adjclose?.[0]?.adjclose
                    || result.indicators?.quote?.[0]?.close;

                if (!timestamps || !adjClose) continue;

                // Filter out null values
                const clean = [];
                for (let i = 0; i < timestamps.length; i++) {
                    if (adjClose[i] != null) {
                        clean.push({ t: timestamps[i], p: adjClose[i] });
                    }
                }
                return clean;
            } catch (e) {
                console.warn(`Proxy failed for ${ticker}:`, e.message);
            }
        }
        return null; // All proxies failed
    },

    /**
     * Convert price series to monthly log-returns
     */
    pricesToReturns(prices) {
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push(Math.log(prices[i].p / prices[i - 1].p));
        }
        return returns;
    },

    /**
     * Fetch data for all asset classes, compute covariance matrix & expected returns.
     * Returns { expectedReturns: [], covMatrix: [][], source: 'yahoo'|'fallback' }
     */
    async fetchAllAssetData(assetClasses) {
        const statusEl = document.getElementById('data-status');
        const n = assetClasses.length;
        let allReturns = [];
        let fetchedCount = 0;
        let failedTickers = [];

        for (let i = 0; i < n; i++) {
            const ac = assetClasses[i];
            if (statusEl) {
                statusEl.textContent = `Hämtar ${ac.name} (${ac.ticker})... ${i + 1}/${n}`;
            }

            const prices = await this.fetchPrices(ac.ticker, 'max');
            if (prices && prices.length > 6) {
                const returns = this.pricesToReturns(prices);
                allReturns.push(returns);
                fetchedCount++;
            } else {
                failedTickers.push(ac.ticker);
                allReturns.push(null);
            }

            // Rate-limit to be polite
            await new Promise(r => setTimeout(r, 100));
        }

        // If we got at least 3 out of 10, use real data where available
        if (fetchedCount >= 3) {
            // Determine minimum common length
            const validReturns = allReturns.filter(r => r !== null);
            const minLen = Math.min(...validReturns.map(r => r.length));

            // Trim all to same length, fill missing with fallback
            const trimmed = allReturns.map((r, i) => {
                if (r !== null) {
                    return r.slice(r.length - minLen);
                }
                // Generate synthetic returns from fallback params
                return this.generateSyntheticReturns(
                    FALLBACK_RETURNS[i],
                    FALLBACK_VOLS[i],
                    minLen
                );
            });

            const covMatrix = Matrix.covarianceMatrix(trimmed, 12);

            // Expected returns: Bayesian shrinkage toward long-term priors
            // This prevents 3-5 year bull/bear market bias from inflating/deflating Sharpe ratios
            // Formula: adjusted = shrinkWeight × prior + (1 - shrinkWeight) × historical
            // With 10 years of data, we can trust the historical data much more.
            const SHRINK_WEIGHT = 0.10; // 10% prior, 90% historical
            const expectedReturns = trimmed.map((r, i) => {
                const monthlyMean = r.reduce((s, v) => s + v, 0) / r.length;
                const historicalAnnual = monthlyMean * 12;
                const prior = LONG_TERM_RETURN_PRIORS[i] || 0.05;
                return SHRINK_WEIGHT * prior + (1 - SHRINK_WEIGHT) * historicalAnnual;
            });

            if (statusEl) {
                statusEl.innerHTML = `<span class="status-live">● LIVE</span> Yahoo Finance (${fetchedCount}/${n} tillgångar)`;
                if (failedTickers.length > 0) {
                    statusEl.innerHTML += ` <span class="status-fallback">Fallback: ${failedTickers.join(', ')}</span>`;
                }
            }

            return { expectedReturns, covMatrix, source: 'yahoo' };
        }

        // Fall back to hardcoded data
        if (statusEl) {
            statusEl.innerHTML = `<span class="status-fallback">● OFFLINE</span> Historiska estimat (fallback)`;
        }
        return this.getFallbackData(assetClasses);
    },

    /** Generate synthetic monthly returns from expected annual return & vol */
    generateSyntheticReturns(annualReturn, annualVol, length) {
        const monthlyMu = annualReturn / 12;
        const monthlySigma = annualVol / Math.sqrt(12);
        const returns = [];
        for (let i = 0; i < length; i++) {
            // Box-Muller transform
            const u1 = Math.random(), u2 = Math.random();
            const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            returns.push(monthlyMu + monthlySigma * z);
        }
        return returns;
    },

    /** Build fallback from hardcoded correlation matrix & asset params */
    getFallbackData(assetClasses) {
        const expectedReturns = [...FALLBACK_RETURNS];
        const vols = [...FALLBACK_VOLS];
        const covMatrix = Matrix.corrToCov(FALLBACK_CORRELATIONS, vols);
        return { expectedReturns, covMatrix, source: 'fallback' };
    },
};
