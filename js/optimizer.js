/**
 * optimizer.js — Markowitz Mean-Variance Optimization & Efficient Frontier
 * Uses projected gradient descent with simplex constraints (no short selling)
 */

const Optimizer = {
    /**
     * Project a vector onto the unit simplex: w_i >= 0, Σw_i = 1
     * Algorithm from Duchi et al. (2008)
     */
    projectOntoSimplex(v) {
        const n = v.length;
        const sorted = [...v].sort((a, b) => b - a);
        let cumSum = 0;
        let rho = 0;
        for (let j = 0; j < n; j++) {
            cumSum += sorted[j];
            if (sorted[j] - (cumSum - 1) / (j + 1) > 0) {
                rho = j + 1;
            }
        }
        const theta = (sorted.slice(0, rho).reduce((s, x) => s + x, 0) - 1) / rho;
        return v.map(x => Math.max(x - theta, 0));
    },

    /**
     * Calculate portfolio return and risk (std dev)
     * @param {number[]} weights
     * @param {number[]} expectedReturns
     * @param {number[][]} covMatrix
     */
    portfolioStats(weights, expectedReturns, covMatrix) {
        const ret = Matrix.dot(weights, expectedReturns);
        const variance = Matrix.dot(weights, Matrix.multiplyVec(covMatrix, weights));
        return {
            return: ret,
            risk: Math.sqrt(Math.max(variance, 0)),
            variance,
            sharpe: (ret - RISK_FREE_RATE) / Math.sqrt(Math.max(variance, 1e-12)),
        };
    },

    /**
     * Minimize portfolio variance for a given risk-aversion parameter lambda.
     * Objective: min  w'Σw − λ × w'μ   s.t. w ≥ 0, Σw = 1
     *
     * By sweeping λ from 0 → large, we trace the efficient frontier.
     */
    optimizeForLambda(expectedReturns, covMatrix, lambda, maxIter = 500) {
        const n = expectedReturns.length;
        
        // For lambda=0 (pure min-variance), try multiple starting points
        if (lambda < 0.01) {
            return this._multiStartMinVar(expectedReturns, covMatrix, maxIter * 2);
        }
        
        let w = new Array(n).fill(1 / n);
        let lr = 0.01;

        for (let iter = 0; iter < maxIter; iter++) {
            const Sw = Matrix.multiplyVec(covMatrix, w);
            const grad = Sw.map((v, i) => 2 * v - lambda * expectedReturns[i]);
            w = w.map((wi, i) => wi - lr * grad[i]);
            w = this.projectOntoSimplex(w);
            if (iter % 100 === 0) lr *= 0.8;
        }

        return w;
    },

    /**
     * Multi-start optimization for minimum variance
     * Tries different starting allocations to find global min-variance
     */
    _multiStartMinVar(expectedReturns, covMatrix, maxIter = 1200) {
        const n = expectedReturns.length;
        let bestWeights = null;
        let bestVariance = Infinity;

        // Starting points to try:
        const starts = [
            new Array(n).fill(1 / n),           // Equal weight
        ];
        
        // Pure asset starts (bonds are indices 3,4,5 = low vol)
        for (let i = 0; i < n; i++) {
            const w = new Array(n).fill(0.01 / (n - 1));
            w[i] = 0.99;
            starts.push(w);
        }

        // Bond-heavy start
        const bondStart = new Array(n).fill(0.02);
        bondStart[3] = 0.30; bondStart[4] = 0.30; bondStart[5] = 0.30;
        const bSum = bondStart.reduce((s, v) => s + v, 0);
        starts.push(bondStart.map(v => v / bSum));

        for (const start of starts) {
            let w = [...start];
            let lr = 0.008;

            for (let iter = 0; iter < maxIter; iter++) {
                const Sw = Matrix.multiplyVec(covMatrix, w);
                const grad = Sw.map(v => 2 * v);
                w = w.map((wi, i) => wi - lr * grad[i]);
                w = this.projectOntoSimplex(w);
                if (iter % 150 === 0) lr *= 0.85;
            }

            const variance = Matrix.dot(w, Matrix.multiplyVec(covMatrix, w));
            if (variance < bestVariance) {
                bestVariance = variance;
                bestWeights = [...w];
            }
        }

        return bestWeights;
    },

    /**
     * Optimize portfolio for a specific target return
     * Uses penalty method: min w'Σw + penalty*(w'μ - target)²  s.t. w≥0, Σw=1
     */
    optimizeForTargetReturn(expectedReturns, covMatrix, targetReturn, maxIter = 800) {
        const n = expectedReturns.length;
        let w = new Array(n).fill(1 / n);
        let lr = 0.005;
        const penalty = 100;

        for (let iter = 0; iter < maxIter; iter++) {
            const Sw = Matrix.multiplyVec(covMatrix, w);
            const currentReturn = Matrix.dot(w, expectedReturns);
            const returnDiff = currentReturn - targetReturn;

            // Gradient: 2Σw + 2*penalty*(w'μ - target)*μ
            const grad = Sw.map((v, i) =>
                2 * v + 2 * penalty * returnDiff * expectedReturns[i]
            );

            w = w.map((wi, i) => wi - lr * grad[i]);
            w = this.projectOntoSimplex(w);

            if (iter % 150 === 0) lr *= 0.85;
        }

        return w;
    },

    /**
     * Generate the efficient frontier
     * Returns array of { risk, return, weights, sharpe }
     */
    generateEfficientFrontier(expectedReturns, covMatrix, numPoints = 60) {
        const n = expectedReturns.length;
        const frontier = [];

        // ── Step 1: Lambda sweep with logarithmic spacing ──
        // Low lambdas (0–1) trace the min-var → moderate-return region
        // High lambdas (1–15) trace the moderate → max-return region
        const lambdas = [0]; // Start with min-variance (lambda=0)

        // Fine resolution in low range (critical for lower frontier)
        for (let i = 1; i <= 20; i++) {
            lambdas.push(i * 0.05);  // 0.05, 0.10 ... 1.00
        }
        // Medium resolution in mid range
        for (let i = 1; i <= 20; i++) {
            lambdas.push(1.0 + i * 0.25); // 1.25, 1.50 ... 6.00
        }
        // Coarser in high range
        for (let i = 1; i <= 10; i++) {
            lambdas.push(6.0 + i * 0.5); // 6.5, 7.0 ... 11.0
        }

        for (const lambda of lambdas) {
            const weights = this.optimizeForLambda(expectedReturns, covMatrix, lambda, 600);
            const stats = this.portfolioStats(weights, expectedReturns, covMatrix);
            frontier.push({
                risk: stats.risk,
                return: stats.return,
                weights: [...weights],
                sharpe: stats.sharpe,
                lambda,
            });
        }

        // ── Step 2: Fill gaps with target-return approach ──
        // This is critical for properly tracing the lower frontier
        const existingReturns = frontier.map(p => p.return);
        const minRet = Math.min(...existingReturns);
        const maxRet = Math.max(...existingReturns);

        // Dense sampling across the full return range
        for (let i = 0; i <= 40; i++) {
            const target = minRet + (maxRet - minRet) * (i / 40);
            const weights = this.optimizeForTargetReturn(expectedReturns, covMatrix, target);
            const stats = this.portfolioStats(weights, expectedReturns, covMatrix);
            frontier.push({
                risk: stats.risk,
                return: stats.return,
                weights: [...weights],
                sharpe: stats.sharpe,
            });
        }

        // ── Step 2.5: Anchor at true min-variance and interpolate ──
        // The gradient optimizer may not fully converge to the global minimum
        // So we explicitly find min-var and add intermediate points
        const mvWeights = this._multiStartMinVar(expectedReturns, covMatrix, 2000);
        const mvStats = this.portfolioStats(mvWeights, expectedReturns, covMatrix);
        frontier.push({
            risk: mvStats.risk,
            return: mvStats.return,
            weights: [...mvWeights],
            sharpe: mvStats.sharpe,
        });

        // Add interpolated points between min-var and the second-lowest risk point
        const sortedByRisk = [...frontier].sort((a, b) => a.risk - b.risk);
        const mvPoint = sortedByRisk[0];
        // Find first point that is meaningfully different from min-var
        const nextPoint = sortedByRisk.find(p => p.risk > mvPoint.risk + 0.005);
        if (nextPoint) {
            for (let t = 0.1; t <= 0.9; t += 0.1) {
                const interpWeights = mvPoint.weights.map((w, i) =>
                    w * (1 - t) + nextPoint.weights[i] * t
                );
                const interpStats = this.portfolioStats(interpWeights, expectedReturns, covMatrix);
                frontier.push({
                    risk: interpStats.risk,
                    return: interpStats.return,
                    weights: [...interpWeights],
                    sharpe: interpStats.sharpe,
                });
            }
        }

        // ── Step 3: Build the TRUE efficient frontier (upper envelope) ──
        // The efficient frontier must satisfy:
        //   1. Sorted by risk (ascending)
        //   2. Return is strictly non-decreasing with risk
        //   3. No point is "dominated" (same risk, lower return → remove)
        //   4. Curve is convex (no concavities)

        // 3a: Sort all candidates by risk
        frontier.sort((a, b) => a.risk - b.risk);

        // 3b: For each thin risk-bucket, keep only the HIGHEST return
        const bucketSize = 0.001; // 0.1% risk buckets
        const bucketMap = new Map();
        for (const pt of frontier) {
            const bucket = Math.round(pt.risk / bucketSize);
            const existing = bucketMap.get(bucket);
            if (!existing || pt.return > existing.return) {
                bucketMap.set(bucket, pt);
            }
        }
        const bestPerBucket = [...bucketMap.values()].sort((a, b) => a.risk - b.risk);

        // 3c: Enforce monotonicity — return must never decrease as risk increases
        const monotonic = [bestPerBucket[0]];
        let maxRetSoFar = bestPerBucket[0].return;
        for (let i = 1; i < bestPerBucket.length; i++) {
            if (bestPerBucket[i].return >= maxRetSoFar - 0.0001) {
                if (bestPerBucket[i].return > maxRetSoFar) {
                    maxRetSoFar = bestPerBucket[i].return;
                }
                monotonic.push(bestPerBucket[i]);
            }
            // else: skip — this point has LOWER return at HIGHER risk (dominated)
        }

        // 3d: Smooth out small concavities instead of removing them
        // (Graham scan was too aggressive, removing ALL mid-range points)
        // Instead, just ensure the curve is roughly monotonic increasing
        const smoothed = [monotonic[0]];
        for (let i = 1; i < monotonic.length; i++) {
            const prev = smoothed[smoothed.length - 1];
            // Only keep if return is at least as high (with small tolerance for numerical noise)
            if (monotonic[i].return >= prev.return - 0.0005 && monotonic[i].risk > prev.risk + 0.0005) {
                smoothed.push(monotonic[i]);
            }
        }

        // ── Step 4: Deduplicate close points ──
        if (smoothed.length === 0) return frontier.slice(0, 10);

        const deduped = [smoothed[0]];
        for (let i = 1; i < smoothed.length; i++) {
            const prev = deduped[deduped.length - 1];
            const dist = Math.hypot(
                (smoothed[i].risk - prev.risk) * 100,
                (smoothed[i].return - prev.return) * 100
            );
            if (dist > 0.10) {
                deduped.push(smoothed[i]);
            }
        }

        // ── Step 5: Smooth the curve while preserving the upper envelope ──
        // The frontier must NEVER dip below any candidate point at any risk level
        if (deduped.length > 4) {
            // Save original returns before smoothing
            const origReturns = deduped.map(p => p.return);

            // Light smoothing: only smooth if it doesn't lower the curve
            for (let pass = 0; pass < 2; pass++) {
                for (let i = 1; i < deduped.length - 1; i++) {
                    const avgReturn = (deduped[i - 1].return + deduped[i].return + deduped[i + 1].return) / 3;
                    // Only apply smoothing if it raises or maintains the return (never lower!)
                    deduped[i] = { ...deduped[i], return: Math.max(avgReturn, origReturns[i]) };
                }
            }

            // Re-enforce strict monotonicity
            for (let i = 1; i < deduped.length; i++) {
                if (deduped[i].return < deduped[i - 1].return) {
                    deduped[i] = { ...deduped[i], return: deduped[i - 1].return };
                }
            }
        }

        return deduped;
    },

    /**
     * Find the tangent portfolio (maximum Sharpe ratio)
     */
    findTangentPortfolio(expectedReturns, covMatrix) {
        const n = expectedReturns.length;
        let bestSharpe = -Infinity;
        let bestWeights = null;

        // Sweep lambda to find peak Sharpe
        for (let lambda = 0; lambda <= 10; lambda += 0.05) {
            const w = this.optimizeForLambda(expectedReturns, covMatrix, lambda, 600);
            const stats = this.portfolioStats(w, expectedReturns, covMatrix);
            if (stats.sharpe > bestSharpe) {
                bestSharpe = stats.sharpe;
                bestWeights = [...w];
            }
        }

        return {
            weights: bestWeights,
            ...this.portfolioStats(bestWeights, expectedReturns, covMatrix),
        };
    },

    /**
     * Find minimum-variance portfolio
     */
    findMinVariancePortfolio(expectedReturns, covMatrix) {
        const w = this.optimizeForLambda(expectedReturns, covMatrix, 0, 800);
        return {
            weights: w,
            ...this.portfolioStats(w, expectedReturns, covMatrix),
        };
    },

    /**
     * Generate random portfolios for the "cloud" visualization
     */
    generateRandomPortfolios(expectedReturns, covMatrix, count = 2000) {
        const n = expectedReturns.length;
        const portfolios = [];

        for (let i = 0; i < count; i++) {
            // Random weights from Dirichlet distribution
            const raw = new Array(n).fill(0).map(() => -Math.log(Math.random()));
            const sum = raw.reduce((s, v) => s + v, 0);
            const weights = raw.map(v => v / sum);

            const stats = this.portfolioStats(weights, expectedReturns, covMatrix);
            portfolios.push({
                risk: stats.risk,
                return: stats.return,
                sharpe: stats.sharpe,
            });
        }

        return portfolios;
    },

    /**
     * Find the nearest efficient portfolio to a given portfolio
     * Returns the frontier point closest in risk-return space
     */
    findNearestEfficientPortfolio(portfolio, frontier) {
        let minDist = Infinity;
        let nearest = null;

        for (const pt of frontier) {
            // Normalize distance (risk and return on different scales)
            const dist = Math.hypot(
                (pt.risk - portfolio.risk) * 5,
                pt.return - portfolio.return
            );
            if (dist < minDist) {
                minDist = dist;
                nearest = pt;
            }
        }

        return nearest;
    },

    /**
     * Find the optimal portfolio for the user:
     * The point on the frontier with the same risk but higher return,
     * or same return with lower risk.
     */
    findOptimalTarget(currentStats, frontier, preference = 'sharpe') {
        if (preference === 'sharpe') {
            // Return the tangent portfolio
            let best = frontier[0];
            for (const pt of frontier) {
                if (pt.sharpe > best.sharpe) best = pt;
            }
            return best;
        }

        if (preference === 'same_risk') {
            // Find frontier point with same risk as the reference (selected fund)
            let closest = null;
            let minRiskDiff = Infinity;
            for (const pt of frontier) {
                const diff = Math.abs(pt.risk - currentStats.risk);
                if (diff < minRiskDiff) {
                    minRiskDiff = diff;
                    closest = pt;
                }
            }
            return closest;
        }

        if (preference === 'same_return') {
            let closest = null;
            let minRetDiff = Infinity;
            for (const pt of frontier) {
                const diff = Math.abs(pt.return - currentStats.return);
                if (diff < minRetDiff) {
                    minRetDiff = diff;
                    closest = pt;
                }
            }
            return closest;
        }

        return frontier[Math.floor(frontier.length / 2)];
    },

    /**
     * Riskparitet (Inverse Volatility)
     * Allocates weights inversely proportional to volatility to create a balanced risk profile
     * independent of subjective return forecasts.
     * NOTE: This is NOT true HRP (which uses hierarchical clustering). It is Inverse Volatility Weighting.
     */
    calculateRiskParityTarget(covMatrix, targetRisk = null, expectedReturns = null) {
        // Extract volatilities from covariance diagonal
        const vols = covMatrix.map((row, i) => Math.sqrt(row[i]));
        
        // Calculate inverse volatilities
        const invVols = vols.map(v => 1 / Math.max(v, 0.0001));
        
        // Normalize so weights sum to 1
        const sumInvVols = invVols.reduce((sum, val) => sum + val, 0);
        const rpWeights = invVols.map(v => v / sumInvVols);
        
        // If no specific risk target, return the pure Risk Parity portfolio
        if (targetRisk === null || !expectedReturns) {
            return rpWeights;
        }

        // Blend the Risk Parity portfolio with the extremes to hit the exact target risk
        const rpRisk = this.portfolioStats(rpWeights, expectedReturns, covMatrix).risk;
        const maxRiskIndex = vols.indexOf(Math.max(...vols));
        const minRiskIndex = vols.indexOf(Math.min(...vols));

        let bestWeights = [...rpWeights];
        let bestDiff = Infinity;

        // Try blending 0% to 100% away from Risk Parity
        for (let w = 0; w <= 1; w += 0.01) {
            let tempWeights = rpWeights.map(x => x * (1 - w));
            
            if (targetRisk > rpRisk) {
                // To increase risk, blend with the riskiest asset
                tempWeights[maxRiskIndex] += w; 
            } else {
                // To decrease risk, blend with the safest asset
                tempWeights[minRiskIndex] += w;
            }

            const currentRisk = this.portfolioStats(tempWeights, expectedReturns, covMatrix).risk;
            const diff = Math.abs(currentRisk - targetRisk);
            
            if (diff < bestDiff) {
                bestDiff = diff;
                bestWeights = tempWeights;
            }
        }

        return bestWeights;
    },
};
