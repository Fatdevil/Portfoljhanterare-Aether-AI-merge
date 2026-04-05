/**
 * app.js — Main controller (v2)
 * Updated for exact bank fund data, fund selection, lock positions, fee savings
 */

const App = {
    state: {
        theme: 'dark',
        activeView: 'frontier',
        selectedBank: 'Handelsbanken',
        selectedFundId: 'shb_ma50',
        selectedTaxEnv: 'ISK',
        selectedTarget: 'sharpe',
        selectedTargetFundId: null,
        selectedEngine: 'markowitz',
        checkedFundIds: new Set(),
        assetData: null,
        frontier: null,
        tangent: null,
        minVar: null,
        randomPortfolios: null,
        initialized: false,
    },

    /* ═══════ INIT ═══════ */
    async init() {
        this.initCheckedFunds();
        this.bindEvents();
        this.addInitialPositionRows(3);
        this.renderFundList();

        Charts.setDefaults();
        Charts.createFrontierChart('frontier-chart');
        Charts.createAllocationChart('allocation-chart');
        Charts.createTaxChart('tax-chart');

        await this.loadAssetData();
        this.runTaxSimulation();
        
        const inputsEl = document.getElementById('portfolio-inputs');
        if (inputsEl) inputsEl.setAttribute('data-env', this.state.selectedTaxEnv);
        
        this.state.initialized = true;
    },

    /* ═══════ CHECKED FUNDS — default all checked ═══════ */
    initCheckedFunds() {
        const all = getAllFunds();
        all.forEach(f => this.state.checkedFundIds.add(f.id));
    },

    /* ═══════ LOAD DATA ═══════ */
    async loadAssetData() {
        document.getElementById('frontier-data-badge').textContent = 'LADDAR...';
        try {
            this.state.assetData = await YahooFinance.fetchAllAssetData(ASSET_CLASSES);
        } catch (e) {
            console.error('Data fetch failed, using fallback:', e);
            this.state.assetData = YahooFinance.getFallbackData(ASSET_CLASSES);
        }

        try {
            this.computeFrontier();
        } catch (e) {
            console.error('computeFrontier error:', e);
        }

        try {
            this.updateFundDetail();
            this.updateFrontierChart();
            this.updateComparisonView();
        } catch (e) {
            console.error('Chart update error:', e);
        }

        const src = this.state.assetData.source;
        document.getElementById('frontier-data-badge').textContent =
            src === 'yahoo' ? 'LIVE DATA' : 'HISTORISK DATA';
        document.getElementById('data-status').innerHTML =
            src === 'yahoo'
                ? '<span class="status-live">● LIVE</span> Yahoo Finance (10/10 tillgångar)'
                : '<span class="status-fallback">⚠ Fallback-data</span>';
    },

    computeFrontier() {
        const { expectedReturns, covMatrix } = this.state.assetData;

        // Step 1: Generate base frontier via gradient descent
        let frontier = Optimizer.generateEfficientFrontier(expectedReturns, covMatrix, 50);

        // Step 2: Generate random portfolios (used for background cloud)
        const randomAll = Optimizer.generateRandomPortfolios(expectedReturns, covMatrix, 3000);

        // Step 3: Inject bank fund portfolios as candidates
        const allFunds = getAllFunds();
        for (const fund of allFunds) {
            const stats = Optimizer.portfolioStats(fund.weights, expectedReturns, covMatrix);
            frontier.push({
                risk: stats.risk,
                return: stats.return,
                weights: [...fund.weights],
                sharpe: stats.sharpe,
            });
        }

        // Step 5: Build upper envelope from ALL candidates
        frontier.sort((a, b) => a.risk - b.risk);
        const envelope = [frontier[0]];
        let maxRet = frontier[0].return;
        for (let i = 1; i < frontier.length; i++) {
            if (frontier[i].return >= maxRet - 0.0001) {
                if (frontier[i].return > maxRet) maxRet = frontier[i].return;
                envelope.push(frontier[i]);
            }
        }

        // Step 6: Deduplicate
        const deduped = [envelope[0]];
        for (let i = 1; i < envelope.length; i++) {
            const prev = deduped[deduped.length - 1];
            const dist = Math.hypot(
                (envelope[i].risk - prev.risk) * 100,
                (envelope[i].return - prev.return) * 100
            );
            if (dist > 0.08) {
                deduped.push(envelope[i]);
            }
        }

        this.state.frontier = deduped;
        this.state.tangent = Optimizer.findTangentPortfolio(expectedReturns, covMatrix);
        this.state.minVar = Optimizer.findMinVariancePortfolio(expectedReturns, covMatrix);

        // Step 7: Filter random cloud — ONLY show portfolios below the frontier
        // This prevents visual confusion of dots appearing above the line
        this.state.randomPortfolios = this.filterCloudBelowFrontier(randomAll, deduped);
    },

    /**
     * Filter random portfolios to only include those below the frontier line
     */
    filterCloudBelowFrontier(cloud, frontier) {
        if (!frontier || frontier.length < 2) return cloud;

        // Build a lookup: for each risk level, what's the frontier return?
        const sorted = [...frontier].sort((a, b) => a.risk - b.risk);

        return cloud.filter(p => {
            // Find the two frontier points bracketing this risk level
            let lo = 0, hi = sorted.length - 1;
            for (let i = 0; i < sorted.length - 1; i++) {
                if (sorted[i].risk <= p.risk && sorted[i + 1].risk >= p.risk) {
                    lo = i;
                    hi = i + 1;
                    break;
                }
            }

            // Interpolate frontier return at this risk
            const rLo = sorted[lo].risk, rHi = sorted[hi].risk;
            const retLo = sorted[lo].return, retHi = sorted[hi].return;
            let frontierReturn;
            if (rHi === rLo) {
                frontierReturn = Math.max(retLo, retHi);
            } else {
                const t = (p.risk - rLo) / (rHi - rLo);
                frontierReturn = retLo + t * (retHi - retLo);
            }

            // Keep if below frontier (with tiny margin for visual clarity)
            return p.return <= frontierReturn + 0.002;
        });
    },

    /* ═══════ FUND LIST RENDERING ═══════ */
    renderFundList() {
        const bank = BANK_PORTFOLIOS[this.state.selectedBank];
        const container = document.getElementById('fund-list-container');
        let html = '';

        let totalFunds = 0;
        for (const series of bank.series) {
            html += `
                <div class="fund-series-header">
                    <span class="fund-series-name">${series.name}</span>
                    <span class="fund-series-type ${series.type.toLowerCase()}">${series.type.toUpperCase()}</span>
                </div>`;

            for (const fund of series.funds) {
                totalFunds++;
                const checked = this.state.checkedFundIds.has(fund.id);
                const selected = fund.id === this.state.selectedFundId;
                html += `
                    <div class="fund-item ${selected ? 'selected' : ''}"
                         data-fund-id="${fund.id}">
                        <input type="checkbox" class="fund-check"
                               data-fund-id="${fund.id}"
                               ${checked ? 'checked' : ''}>
                        <span class="fund-name">${fund.name}</span>
                        <span class="fund-equity">${Math.round(fund.equityTarget * 100)}% aktier</span>
                        <span class="fund-fee">${(fund.fee * 100).toFixed(2)}%</span>
                    </div>`;
            }
        }

        container.innerHTML = html;
        document.getElementById('fund-count-badge').textContent = `${totalFunds} FONDER`;

        // Click handlers: select fund
        container.querySelectorAll('.fund-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.classList.contains('fund-check')) return;
                this.state.selectedFundId = el.dataset.fundId;
                
                this.renderFundList();
                this.updateFundDetail();
            });
        });

        // Checkbox handlers: toggle on chart
        container.querySelectorAll('.fund-check').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) this.state.checkedFundIds.add(cb.dataset.fundId);
                else this.state.checkedFundIds.delete(cb.dataset.fundId);
                this.updateFrontierChart();
            });
        });
    },

    /* ═══════ FUND DETAIL TABLE ═══════ */
    updateFundDetail() {
        const fund = getFundById(this.state.selectedFundId);
        if (!fund || !this.state.assetData) return;

        document.getElementById('fund-detail-title').textContent = fund.fullName || fund.name;
        document.getElementById('fund-type-badge').textContent = fund.seriesType.toUpperCase();
        document.getElementById('fund-type-badge').className =
            `panel-badge ${fund.seriesType === 'Aktiv' ? '' : ''}`;

        const { expectedReturns, covMatrix } = this.state.assetData;
        const tbody = document.getElementById('fund-detail-body');

        tbody.innerHTML = ASSET_CLASSES.map((ac, i) => {
            const w = fund.weights[i];
            if (w < 0.005) return '';
            return `<tr>
                <td><span class="dot" style="background:${ac.color}"></span>${ac.name}</td>
                <td class="num">${(w * 100).toFixed(1)}%</td>
                <td class="num">${(expectedReturns[i] * 100).toFixed(1)}%</td>
                <td class="num">${(Math.sqrt(covMatrix[i][i]) * 100).toFixed(1)}%</td>
            </tr>`;
        }).join('');

        const stats = Optimizer.portfolioStats(fund.weights, expectedReturns, covMatrix);
        document.getElementById('fund-return').textContent = (stats.return * 100).toFixed(1) + '%';
        document.getElementById('fund-risk').textContent = (stats.risk * 100).toFixed(1) + '%';
        document.getElementById('fund-sharpe').textContent = stats.sharpe.toFixed(2);
        document.getElementById('fund-fee').textContent = (fund.fee * 100).toFixed(2) + '%';
    },

    /* ═══════ FRONTIER CHART ═══════ */
    updateFrontierChart() {
        if (!this.state.assetData) return;
        const { expectedReturns, covMatrix } = this.state.assetData;

        // Compute checked fund points
        const bankPoints = [];
        const allFunds = getAllFunds();
        for (const fund of allFunds) {
            if (!this.state.checkedFundIds.has(fund.id)) continue;
            const stats = Optimizer.portfolioStats(fund.weights, expectedReturns, covMatrix);
            const isPassive = fund.seriesType === 'Passiv';
            bankPoints.push({
                bank: fund.bankShortName,
                profile: fund.name,
                label: `${fund.bankShortName} ${fund.name}`,
                weights: fund.weights,
                risk: stats.risk,
                return: stats.return,
                sharpe: stats.sharpe,
                color: fund.bankColor,
                borderColor: isPassive ? '#ffffff' : fund.bankColor,
                style: isPassive ? 'rect' : (fund.equityTarget >= 0.7 ? 'triangle' : 'circle'),
            });
        }

        const chartData = {
            engine: this.state.selectedEngine,
            assetData: this.state.assetData,
            frontier: this.state.frontier,
            randomPortfolios: this.state.randomPortfolios || [],
            tangent: this.state.tangent,
            minVar: this.state.minVar,
            bankPoints,
            userPortfolio: null,
            targetPortfolio: null,
        };

        // User portfolio
        const positions = this.getUserPositions();
        if (positions.length > 0) {
            const totalValue = positions.reduce((s, p) => s + p.currentValue, 0);
            if (totalValue > 0) {
                const weights = new Array(ASSET_CLASSES.length).fill(0);
                for (const pos of positions) {
                    const idx = ASSET_CLASSES.findIndex(a => a.id === pos.assetId);
                    if (idx >= 0) weights[idx] += pos.currentValue / totalValue;
                }
                const stats = Optimizer.portfolioStats(weights, expectedReturns, covMatrix);
                chartData.userPortfolio = { ...stats, weights };

                // Target computation
                const target = this.computeTarget(stats);
                if (target) chartData.targetPortfolio = target;
            }
        }

        Charts.updateFrontierChart(chartData);
    },

    computeTarget(currentStats) {
        if (!this.state.assetData) return null;
        const { expectedReturns, covMatrix } = this.state.assetData;

        // 1. Determine intended risk level
        let targetRisk = null;
        if (this.state.selectedTarget === 'same_risk') {
            targetRisk = currentStats.risk;
        } else if (this.state.selectedTarget === 'fund_risk') {
            const fund = getFundById(this.state.selectedFundId);
            if (fund) {
                targetRisk = Optimizer.portfolioStats(fund.weights, expectedReturns, covMatrix).risk;
            }
        }

        // Exact Copy early exit
        if (this.state.selectedTarget === 'fund_copy') {
            const fund = getFundById(this.state.selectedFundId);
            if (!fund) return null;
            const stats = Optimizer.portfolioStats(fund.weights, expectedReturns, covMatrix);
            return { ...stats, weights: fund.weights };
        }

        // 2. Compute by engine
        if (this.state.selectedEngine === 'hrp') {
            const hrpWeights = Optimizer.calculateRiskParityTarget(covMatrix, targetRisk, expectedReturns);
            const stats = Optimizer.portfolioStats(hrpWeights, expectedReturns, covMatrix);
            return { ...stats, weights: hrpWeights };
        }

        // Markowitz path
        const abstractTarget = this.state.selectedTarget === 'sharpe' ? 'sharpe' : 'same_risk';
        return Optimizer.findOptimalTarget({ risk: targetRisk, return: 0 }, this.state.frontier, abstractTarget);
    },

    /* ═══════ COMPARISON VIEW ═══════ */
    updateComparisonView() {
        if (!this.state.assetData) return;
        const { expectedReturns, covMatrix } = this.state.assetData;

        // Get current equity filter
        const eqFilter = parseInt(
            document.querySelector('#compare-equity-selector .profile-btn.active')?.dataset.equity || '50'
        );

        // Find closest funds from each bank
        const matchingFunds = [];
        for (const [bankName, bank] of Object.entries(BANK_PORTFOLIOS)) {
            for (const series of bank.series) {
                let closest = null;
                let closestDist = Infinity;
                for (const fund of series.funds) {
                    const dist = Math.abs(fund.equityTarget * 100 - eqFilter);
                    if (dist < closestDist) { closest = fund; closestDist = dist; }
                }
                if (closest && closestDist <= 30) {
                    matchingFunds.push({
                        ...closest,
                        bankName,
                        bankColor: bank.color,
                        seriesName: series.name,
                        seriesType: series.type,
                    });
                }
            }
        }

        // Allocation chart
        Charts.updateAllocationChart(matchingFunds.map(f => ({
            label: `${f.bankName} ${f.name}`,
            weights: f.weights,
        })));

        // Comparison table
        const thead = document.getElementById('compare-thead');
        const tbody = document.getElementById('compare-tbody');

        thead.innerHTML = `<tr>
            <th>Tillgångsslag</th>
            ${matchingFunds.map(f => `<th class="num" style="font-size:8px">${f.bankName}<br>${f.name}</th>`).join('')}
        </tr>`;

        tbody.innerHTML = ASSET_CLASSES.map((ac, i) => `
            <tr>
                <td><span class="dot" style="background:${ac.color}"></span>${ac.name}</td>
                ${matchingFunds.map(f =>
                    `<td class="num">${(f.weights[i] * 100).toFixed(1)}%</td>`
                ).join('')}
            </tr>
        `).join('');

        // Stats cards
        const statsDiv = document.getElementById('compare-stats');
        statsDiv.innerHTML = matchingFunds.map(f => {
            const stats = Optimizer.portfolioStats(f.weights, expectedReturns, covMatrix);
            return `
                <div class="stat-card" style="border-color:${f.bankColor}40">
                    <div class="stat-label" style="color:${f.bankColor}">${f.bankName} ${f.name}</div>
                    <div style="font-size:9px;color:var(--text-muted);margin-bottom:4px">${f.seriesType} · ${(f.fee * 100).toFixed(2)}% avgift</div>
                    <div style="font-size:11px;margin-top:4px">
                        <span style="color:var(--positive)">Avk: ${(stats.return * 100).toFixed(1)}%</span><br>
                        <span style="color:var(--text-secondary)">Risk: ${(stats.risk * 100).toFixed(1)}%</span><br>
                        <span style="color:var(--accent-tertiary)">Sharpe: ${stats.sharpe.toFixed(2)}</span>
                    </div>
                </div>`;
        }).join('');
    },

    /* ═══════ USER PORTFOLIO ═══════ */
    addPositionRow(assetId = '', currentValue = '', costBasis = '') {
        const container = document.getElementById('portfolio-inputs');
        const row = document.createElement('div');
        row.className = 'position-row';

        const options = ASSET_CLASSES.map(ac =>
            `<option value="${ac.id}" ${ac.id === assetId ? 'selected' : ''}>${ac.name}</option>`
        ).join('');

        row.innerHTML = `
            <select>${options}</select>
            <input type="number" placeholder="Värde" value="${currentValue}" min="0" step="1000">
            <input type="number" class="col-cost-basis" placeholder="Ingång" value="${costBasis}" min="0" step="1000">
            <input type="checkbox" class="lock-check" title="Lås — behåll vid optimering">
            <button class="btn-remove" title="Ta bort">×</button>
        `;

        row.querySelector('.btn-remove').addEventListener('click', () => {
            row.remove();
            this.updatePositionCount();
            this.updateFrontierChart();
        });

        row.querySelectorAll('input, select').forEach(el => {
            el.addEventListener('change', () => this.updateFrontierChart());
        });

        container.appendChild(row);
        this.updatePositionCount();
    },

    addInitialPositionRows(count) {
        for (let i = 0; i < count; i++) this.addPositionRow();
    },

    updatePositionCount() {
        const positions = this.getUserPositions();
        document.getElementById('user-portfolio-badge').textContent = `${positions.length} POSITIONER`;
    },

    getUserPositions() {
        const rows = document.querySelectorAll('#portfolio-inputs .position-row');
        const positions = [];
        rows.forEach(row => {
            const select = row.querySelector('select');
            const inputs = row.querySelectorAll('input[type="number"]');
            const lockCheck = row.querySelector('.lock-check');
            if (!select || inputs.length < 2) return;

            const currentValue = parseFloat(inputs[0].value) || 0;
            const costBasis = parseFloat(inputs[1].value) || 0;
            const locked = lockCheck ? lockCheck.checked : false;

            if (currentValue > 0) {
                positions.push({
                    assetId: select.value,
                    currentValue,
                    costBasis: costBasis || currentValue,
                    locked,
                });
            }
        });
        return positions;
    },

    clearPortfolio() {
        const container = document.getElementById('portfolio-inputs');
        container.querySelectorAll('.position-row').forEach(r => r.remove());
        this.addInitialPositionRows(3);
        document.getElementById('recommendations-panel').style.display = 'none';
        this.updateFrontierChart();
    },

    /* ═══════ OPTIMIZATION ═══════ */
    runOptimization() {
        const positions = this.getUserPositions();
        if (positions.length === 0) {
            alert('Lägg till minst en position i din portfölj först.');
            return;
        }
        const totalValue = positions.reduce((s, p) => s + p.currentValue, 0);
        if (totalValue <= 0) { alert('Portföljvärdet måste vara > 0.'); return; }

        const currentWeights = new Array(ASSET_CLASSES.length).fill(0);
        for (const pos of positions) {
            const idx = ASSET_CLASSES.findIndex(a => a.id === pos.assetId);
            if (idx >= 0) currentWeights[idx] += pos.currentValue / totalValue;
        }

        if (!this.state.assetData) {
            alert('Marknadsdata laddas fortfarande. Vänta ett par sekunder och försök igen.');
            return;
        }

        const { expectedReturns, covMatrix } = this.state.assetData;
        const currentStats = Optimizer.portfolioStats(currentWeights, expectedReturns, covMatrix);

        // Calculate target
        let targetWeights;
        let targetFund = null;

        // 1. Determine intended risk level
        let targetRisk = null;
        if (this.state.selectedTarget === 'same_risk') {
            targetRisk = currentStats.risk;
        } else if (this.state.selectedTarget === 'fund_risk') {
            targetFund = getFundById(this.state.selectedFundId);
            if (targetFund) {
                targetRisk = Optimizer.portfolioStats(targetFund.weights, expectedReturns, covMatrix).risk;
            } else {
                alert('Välj en fond i listan till vänster.'); return;
            }
        }

        // Exact Copy early exit
        if (this.state.selectedTarget === 'fund_copy') {
            targetFund = getFundById(this.state.selectedFundId);
            if (!targetFund) { alert('Välj en fond i listan till vänster.'); return; }
            targetWeights = [...targetFund.weights];
        } 
        else if (this.state.selectedEngine === 'hrp') {
            // HRP respects user's risk tolerance
            targetWeights = Optimizer.calculateRiskParityTarget(covMatrix, targetRisk, expectedReturns);
        } else {
            // Markowitz
            const abstractTarget = this.state.selectedTarget === 'sharpe' ? 'sharpe' : 'same_risk';
            const target = Optimizer.findOptimalTarget({ risk: targetRisk, return: 0 }, this.state.frontier, abstractTarget);
            if (!target) { alert('Kunde inte beräkna optimalt mål.'); return; }
            targetWeights = target.weights;
        }

        // Handle locked positions — adjust target weights
        const lockedWeightSum = positions
            .filter(p => p.locked)
            .reduce((s, p) => s + p.currentValue / totalValue, 0);

        if (lockedWeightSum > 0 && lockedWeightSum < 1) {
            // Build locked weight map
            const lockedWeights = new Array(ASSET_CLASSES.length).fill(0);
            for (const pos of positions.filter(p => p.locked)) {
                const idx = ASSET_CLASSES.findIndex(a => a.id === pos.assetId);
                if (idx >= 0) lockedWeights[idx] += pos.currentValue / totalValue;
            }

            // Redistribute remaining weight proportionally
            const remainingWeight = 1 - lockedWeightSum;
            const targetNonLockedSum = targetWeights.reduce((s, w, i) =>
                s + (lockedWeights[i] > 0 ? 0 : w), 0);

            if (targetNonLockedSum > 0) {
                for (let i = 0; i < targetWeights.length; i++) {
                    if (lockedWeights[i] > 0) {
                        targetWeights[i] = lockedWeights[i];
                    } else {
                        targetWeights[i] = (targetWeights[i] / targetNonLockedSum) * remainingWeight;
                    }
                }
            }
        }

        // Generate recommendations (skip locked positions)
        const rec = Recommendations.generate(
            positions.filter(p => !p.locked),
            targetWeights,
            this.state.selectedTaxEnv,
            this.state.selectedTarget
        );

        const targetStats = Optimizer.portfolioStats(targetWeights, expectedReturns, covMatrix);

        this.displayRecommendations(rec, targetFund, currentStats, targetStats);
        this.updateFrontierChart();
    },

    displayRecommendations(rec, targetFund, currentStats, targetStats) {
        const panel = document.getElementById('recommendations-panel');
        panel.style.display = 'block';

        document.getElementById('rec-tax-badge').textContent = rec.taxEnvironment;
        // Show full portfolio value
        document.getElementById('rec-total-value').textContent = TaxEngine.formatSEK(rec.totalPortfolioValue);
        // Show amount being redistributed (sell proceeds)
        document.getElementById('rec-net-reinvest').textContent = TaxEngine.formatSEK(rec.summary.totalReinvestable);
        document.getElementById('rec-tax-impact').textContent = TaxEngine.formatSEK(rec.summary.totalTax);
        document.getElementById('rec-tax-drag').textContent = TaxEngine.formatPct(rec.summary.taxDragPct);

        const totalValue = this.getUserPositions().reduce((s, p) => s + p.currentValue, 0);
        const userFee = estimateUserPortfolioCost();
        let targetFee = userFee;

        // Fee savings
        if (targetFund) {
            targetFee = targetFund.fee;
            const saving = targetFee - userFee;
            const annualSave = totalValue * saving;
            const tenYearSave = this.compoundSaving(totalValue, saving, 10, 0.07);

            document.getElementById('fee-savings-section').style.display = 'block';
            document.getElementById('fee-bank').textContent = (targetFee * 100).toFixed(2) + '%';
            document.getElementById('fee-user').textContent = '~' + (userFee * 100).toFixed(2) + '%';
            document.getElementById('fee-annual-save').textContent = TaxEngine.formatSEK(annualSave);
            document.getElementById('fee-10y-save').textContent = TaxEngine.formatSEK(tenYearSave);
        } else {
            document.getElementById('fee-savings-section').style.display = 'none';
        }

        document.getElementById('sell-table-body').innerHTML = Recommendations.formatSellsHTML(rec.sells);
        document.getElementById('buy-table-body').innerHTML = Recommendations.formatBuysHTML(rec.buys);

        // --- Breakeven Time Machine Logic ---
        const breakevenPanel = document.getElementById('breakeven-panel');
        if (rec.taxEnvironment === 'DEPA' && rec.summary.totalTax > 0) {
            
            // Calculate old portfolio variables
            const positions = this.getUserPositions();
            const oldTotalValue = totalValue;
            const oldCostBasis = positions.reduce((s, p) => s + (p.costBasis > 0 ? p.costBasis : 0), 0);
            const oldReturn = currentStats.return;
            const oldFee = targetFund ? targetFund.fee : 0.013; // default high fee if no target fund

            // Calculate new portfolio variables (Split logic)
            const reinvestValue = rec.summary.totalReinvestable;
            const lockedValue = oldTotalValue - rec.summary.totalSellValue;
            const lockedRatio = oldTotalValue > 0 ? lockedValue / oldTotalValue : 0;
            const lockedCostBasis = oldCostBasis * lockedRatio;
            
            const newReturn = targetStats.return;
            const newFee = userFee;

            const beData = TaxEngine.calculateBreakeven(
                oldTotalValue, oldCostBasis, oldReturn, oldFee,
                lockedValue, lockedCostBasis, reinvestValue, newReturn, newFee
            );

            let beHtml = '';
            let extraClass = '';
            
            if (beData.breakevenYear > 0 && beData.breakevenYear <= 30) {
                const yearText = beData.breakevenYear.toFixed(1);
                extraClass = beData.breakevenYear <= 5 ? 'breakeven-success' : '';
                
                beHtml = `
                    <div class="breakeven-title">⏳ Tidsmaskin: Brytpunkt för skattesmäll</div>
                    <div class="breakeven-text">Skattesmällen på <strong>${TaxEngine.formatSEK(rec.summary.totalTax)}</strong> är intjänad om <strong style="color:var(--text-primary); font-size: 14px;">${yearText} år</strong>.</div>
                    <div class="breakeven-text" style="color:var(--text-muted); margin-top:4px;">
                        Tack vare en förväntad nettoavkastning på ${TaxEngine.formatPct(beData.newExpectedNetReturn)} (mot gamla ${TaxEngine.formatPct(beData.oldExpectedNetReturn)})<br/>
                        — och att det frigjorda nettot (${TaxEngine.formatSEK(reinvestValue)}) placeras i ett smart <b>${beData.bestEnv}</b>.
                    </div>
                    <div class="breakeven-progress-track">
                        <div class="breakeven-progress-fill" style="width: ${Math.min(100, (beData.breakevenYear / 10) * 100)}%;"></div>
                    </div>
                `;
            } else {
                extraClass = 'breakeven-warning';
                beHtml = `
                    <div class="breakeven-title" style="color:var(--negative)">⚠ VARNING: Matematiskt ofördelaktigt byte</div>
                    <div class="breakeven-text">Tidsmaskinen visar att det tar <strong>mer än 30 år</strong> att tjäna in skattesmällen på ${TaxEngine.formatSEK(rec.summary.totalTax)}.</div>
                    <div class="breakeven-text" style="margin-top:4px;"><strong>RÅD:</strong> För att undvika skatt, fyll i rutan "Lås" för dina största befintliga innehav och klicka Optimera på nytt, så bygger motorn runt dem utan att sälja.</div>
                    <div class="breakeven-progress-track">
                        <div class="breakeven-progress-fill warning" style="width: 100%;"></div>
                    </div>
                `;
            }
            
            breakevenPanel.innerHTML = beHtml;
            breakevenPanel.className = extraClass;
            breakevenPanel.style.display = 'block';

        } else {
            breakevenPanel.style.display = 'none';
            breakevenPanel.innerHTML = '';
        }

        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    compoundSaving(capital, annualSaving, years, growthRate) {
        let total = 0;
        let cap = capital;
        for (let y = 0; y < years; y++) {
            total += cap * annualSaving;
            cap *= (1 + growthRate);
        }
        return total;
    },

    /* ═══════ TAX SIMULATION ═══════ */
    runTaxSimulation() {
        const capital = parseFloat(document.getElementById('sim-capital').value) || 500000;
        const annualReturn = parseFloat(document.getElementById('sim-return').value) / 100;
        const dividend = parseFloat(document.getElementById('sim-dividend').value) / 100;
        const years = parseInt(document.getElementById('sim-years').value) || 20;
        const turnover = parseInt(document.getElementById('sim-turnover').value) / 100 || 0;
        const liquidate = document.getElementById('sim-liquidate') ? document.getElementById('sim-liquidate').checked : true;

        const simData = TaxEngine.simulateGrowth(capital, annualReturn, dividend, years, turnover, liquidate);
        Charts.updateTaxChart(simData);

        document.getElementById('sim-period-badge').textContent = `${years} ÅR`;

        const iskFinal = simData.isk.values[years];
        const depaFinal = simData.depa.values[years];
        const advantage = iskFinal - depaFinal;
        const iskTotalTax = simData.isk.taxes.reduce((s, t) => s + t, 0);

        document.getElementById('sim-isk-final').textContent = TaxEngine.formatSEK(iskFinal);
        document.getElementById('sim-depa-final').textContent = TaxEngine.formatSEK(depaFinal);
        document.getElementById('sim-advantage').textContent =
            (advantage >= 0 ? '+' : '') + TaxEngine.formatSEK(advantage);
        document.getElementById('sim-isk-tax').textContent = TaxEngine.formatSEK(iskTotalTax);

        document.getElementById('sim-return-display').textContent = (annualReturn * 100).toFixed(1) + '%';
        document.getElementById('sim-div-display').textContent = (dividend * 100).toFixed(1) + '%';
        document.getElementById('sim-years-display').textContent = years + ' år';
        if (document.getElementById('sim-turnover-display')) {
            document.getElementById('sim-turnover-display').textContent = (turnover * 100).toFixed(0) + '%';
        }
    },

    /* ═══════ THEME ═══════ */
    toggleTheme() {
        const html = document.documentElement;
        const isDark = html.getAttribute('data-theme') === 'dark';
        const newTheme = isDark ? 'light' : 'dark';
        html.setAttribute('data-theme', newTheme);
        this.state.theme = newTheme;
        document.getElementById('theme-icon').textContent = isDark ? '🌙' : '☀';
        document.getElementById('theme-label').textContent = isDark ? 'MÖRKT' : 'LJUST';
        Charts.updateTheme(!isDark);

        if (this.state.initialized) {
            Charts.createFrontierChart('frontier-chart');
            this.updateFrontierChart();
            Charts.createAllocationChart('allocation-chart');
            this.updateComparisonView();
            Charts.createTaxChart('tax-chart');
            this.runTaxSimulation();
        }
    },

    /* ═══════ VIEW NAV ═══════ */
    switchView(viewName) {
        this.state.activeView = viewName;
        document.querySelectorAll('.nav-btn').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.view === viewName));
        document.querySelectorAll('.view-section').forEach(s =>
            s.classList.toggle('active', s.id === `view-${viewName}`));
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);

        // Lazy-init mortgage tab
        if (viewName === 'mortgage' && !this._mortgageInit) {
            this.initMortgageTab();
        }
    },

    /* ═══════ MORTGAGE TAB ═══════ */
    _mortgageInit: false,
    _mortgageWeights: { variable: 0.50, fixed_5y: 0.50 },
    _mortHistChart: null,
    _mortBacktestChart: null,

    async initMortgageTab() {
        try {
            const statusEl = document.getElementById('data-status');
            await MortgageEngine.loadData(statusEl);
            this._mortgageInit = true;

            this.renderMortgageSliders();
            this.renderMortgageQuickBtns();
            this.bindMortgageEvents();
            this.updateMortgageCost();
            this.renderMortgageHistoryChart();
            this.runMortgageBacktest();
            this.renderMortgageStatsTable();
        } catch (e) {
            console.error('Mortgage init failed:', e);
            document.getElementById('data-status').textContent = 'Bolånedata kunde ej laddas';
        }
    },

    renderMortgageSliders() {
        const container = document.getElementById('mort-sliders');
        const types = MortgageEngine.BINDING_TYPES;
        const latest = MortgageEngine.getLatestRates();

        container.innerHTML = types.map(bt => {
            const w = Math.round((this._mortgageWeights[bt.id] || 0) * 100);
            const rate = latest[bt.id];
            const rateStr = rate !== null ? ` (${rate.toFixed(2)}%)` : '';
            return `
                <div class="mort-slider-row">
                    <label style="color:${bt.color}">${bt.label}${rateStr}</label>
                    <input type="range" min="0" max="100" step="5" value="${w}" data-binding="${bt.id}" class="mort-mix-slider">
                    <span class="mort-val" data-val="${bt.id}" style="color:${bt.color}">${w}%</span>
                </div>
            `;
        }).join('');
    },

    renderMortgageQuickBtns() {
        const container = document.getElementById('mort-quick-btns');
        const strategies = MortgageEngine.getStandardStrategies();
        container.innerHTML = strategies.map(s =>
            `<button class="mort-strategy-btn" data-strategy='${JSON.stringify(s.weights)}' title="${s.description}">${s.name}</button>`
        ).join('');
    },

    bindMortgageEvents() {
        // Loan slider
        document.getElementById('mort-loan').addEventListener('input', (e) => {
            const v = parseInt(e.target.value);
            document.getElementById('mort-loan-label').textContent = v.toLocaleString('sv-SE') + ' kr';
            this.updateMortgageCost();
        });

        // Mix sliders
        document.querySelectorAll('.mort-mix-slider').forEach(slider => {
            slider.addEventListener('input', () => {
                const id = slider.dataset.binding;
                const val = parseInt(slider.value);
                this._mortgageWeights[id] = val / 100;
                document.querySelector(`[data-val="${id}"]`).textContent = val + '%';

                const total = Object.values(this._mortgageWeights).reduce((s, v) => s + v, 0);
                const totalEl = document.getElementById('mort-weight-total');
                const pct = Math.round(total * 100);
                totalEl.textContent = pct + '%';
                totalEl.style.color = Math.abs(pct - 100) <= 1 ? 'var(--positive)' : 'var(--negative)';

                this.updateMortgageCost();
            });
        });

        // Quick strategy buttons
        document.querySelectorAll('.mort-strategy-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const weights = JSON.parse(btn.dataset.strategy);
                // Reset all to 0
                for (const bt of MortgageEngine.BINDING_TYPES) {
                    this._mortgageWeights[bt.id] = weights[bt.id] || 0;
                }
                this.renderMortgageSliders();
                this.bindMortgageMixSliders();
                this.updateMortgageCost();
                this.runMortgageBacktest();
            });
        });

        // Scenario buttons
        document.querySelectorAll('.btn-scenario').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-scenario').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const change = parseFloat(btn.dataset.change);
                this.runMortgageScenario(change);
            });
        });
    },

    bindMortgageMixSliders() {
        document.querySelectorAll('.mort-mix-slider').forEach(slider => {
            slider.addEventListener('input', () => {
                const id = slider.dataset.binding;
                const val = parseInt(slider.value);
                this._mortgageWeights[id] = val / 100;
                document.querySelector(`[data-val="${id}"]`).textContent = val + '%';

                const total = Object.values(this._mortgageWeights).reduce((s, v) => s + v, 0);
                const totalEl = document.getElementById('mort-weight-total');
                const pct = Math.round(total * 100);
                totalEl.textContent = pct + '%';
                totalEl.style.color = Math.abs(pct - 100) <= 1 ? 'var(--positive)' : 'var(--negative)';

                this.updateMortgageCost();
            });
        });
    },

    updateMortgageCost() {
        if (!MortgageEngine.isLoaded) return;
        const loan = parseInt(document.getElementById('mort-loan').value);
        const latest = MortgageEngine.getLatestRates();
        const cost = MortgageEngine.calculateMonthlyCost(loan, this._mortgageWeights, latest.month);

        document.getElementById('mort-gross').textContent = cost.grossCost.toLocaleString('sv-SE') + ' kr';
        document.getElementById('mort-net').textContent = cost.netCost.toLocaleString('sv-SE') + ' kr';
        document.getElementById('mort-eff-rate').textContent = cost.effectiveRate.toFixed(2) + '%';
        document.getElementById('mort-tax-save').textContent = '-' + cost.taxSaving.toLocaleString('sv-SE') + ' kr';
    },

    renderMortgageHistoryChart() {
        const ctx = document.getElementById('mort-history-chart');
        if (this._mortHistChart) this._mortHistChart.destroy();

        // Sample every 3rd month for readability
        const months = MortgageEngine.months.filter((_, i) => i % 3 === 0);
        const labels = months.map(m => MortgageEngine.formatMonth(m));

        const datasets = MortgageEngine.BINDING_TYPES
            .filter(bt => MortgageEngine.rateData[bt.id] && Object.keys(MortgageEngine.rateData[bt.id]).length > 50)
            .map(bt => ({
                label: bt.label,
                data: months.map(m => MortgageEngine.getRate(bt.id, m)),
                borderColor: bt.color,
                backgroundColor: bt.color + '15',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.3,
                fill: false,
            }));

        this._mortHistChart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#aaa', font: { size: 11, family: 'JetBrains Mono' }, boxWidth: 14, padding: 12 },
                    },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}%`
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#666', font: { size: 9 }, maxRotation: 45 },
                        grid: { color: 'rgba(255,255,255,0.04)' },
                    },
                    y: {
                        title: { display: true, text: 'Ränta (%)', color: '#888' },
                        ticks: { color: '#888', callback: v => v.toFixed(1) + '%' },
                        grid: { color: 'rgba(255,255,255,0.06)' },
                    }
                }
            }
        });
    },

    runMortgageBacktest() {
        if (!MortgageEngine.isLoaded) return;
        const loan = parseInt(document.getElementById('mort-loan').value);

        // Find a good 10-year window
        const endMonth = MortgageEngine.months[MortgageEngine.months.length - 1];
        const endDate = MortgageEngine.parseMonth(endMonth);
        const startDate = new Date(endDate);
        startDate.setFullYear(startDate.getFullYear() - 10);
        const startYear = startDate.getFullYear();
        const startMo = String(startDate.getMonth() + 1).padStart(2, '0');
        const startMonth = `${startYear}M${startMo}`;

        // Ensure startMonth exists
        const validStart = MortgageEngine.months.find(m => m >= startMonth) || MortgageEngine.months[0];

        // Standard strategies + user's mix
        const strategies = [
            { name: 'Din mix', weights: { ...this._mortgageWeights } },
            ...MortgageEngine.getStandardStrategies(),
        ];

        const comparison = MortgageEngine.compareStrategies(loan, strategies, validStart, endMonth);

        // Render table
        const tableEl = document.getElementById('mort-backtest-table');
        tableEl.innerHTML = `
            <table class="mort-backtest-table">
                <thead>
                    <tr>
                        <th>Strategi</th>
                        <th>Snittränta</th>
                        <th>Total nettokostnad</th>
                        <th>Besparing</th>
                    </tr>
                </thead>
                <tbody>
                    ${comparison.map((r, i) => `
                        <tr>
                            <td style="font-weight:${r.name === 'Din mix' ? '700' : '400'};color:${r.name === 'Din mix' ? 'var(--accent-primary)' : 'inherit'}">${r.name}</td>
                            <td>${r.result.avgRate.toFixed(2)}%</td>
                            <td class="${i === 0 ? 'winner' : ''}">${r.result.totalPaidNet.toLocaleString('sv-SE')} kr</td>
                            <td class="${r.savings > 0 ? 'positive' : ''}">${r.savings > 0 ? '+' + r.savings.toLocaleString('sv-SE') + ' kr' : '—'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p style="color:var(--text-muted);font-size:0.7rem;margin-top:8px">Period: ${MortgageEngine.formatMonth(validStart)} → ${MortgageEngine.formatMonth(endMonth)} (${comparison[0]?.result?.numMonths || 0} månader)</p>
        `;

        // Render backtest chart (monthly cost over time for top 3 strategies)
        this.renderMortgageBacktestChart(comparison.slice(0, 4), validStart, endMonth);
    },

    renderMortgageBacktestChart(strategies, start, end) {
        const ctx = document.getElementById('mort-backtest-chart');
        if (this._mortBacktestChart) this._mortBacktestChart.destroy();

        const colors = ['#00e5ff', '#00ff88', '#ff6600', '#ff3366'];

        // Sample every 6th month for readability
        const allMonths = strategies[0]?.result?.monthlyHistory?.map(m => m.month) || [];
        const sampleIdx = allMonths.filter((_, i) => i % 6 === 0).map(m => allMonths.indexOf(m));

        const labels = sampleIdx.map(i => MortgageEngine.formatMonth(allMonths[i]));

        const datasets = strategies.map((s, si) => ({
            label: s.name,
            data: sampleIdx.map(i => s.result.monthlyHistory[i]?.netCost || 0),
            borderColor: colors[si],
            backgroundColor: colors[si] + '15',
            borderWidth: s.name === 'Din mix' ? 3 : 1.5,
            pointRadius: 0,
            tension: 0.3,
            fill: false,
        }));

        this._mortBacktestChart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#aaa', font: { size: 10, family: 'JetBrains Mono' }, boxWidth: 12, padding: 10 },
                    },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y?.toLocaleString('sv-SE')} kr/mån`
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#666', font: { size: 9 }, maxRotation: 45 },
                        grid: { color: 'rgba(255,255,255,0.04)' },
                    },
                    y: {
                        title: { display: true, text: 'Nettokostnad/mån (kr)', color: '#888' },
                        ticks: { color: '#888', callback: v => (v/1000).toFixed(0) + 'k' },
                        grid: { color: 'rgba(255,255,255,0.06)' },
                    }
                }
            }
        });
    },

    renderMortgageStatsTable() {
        const stats = MortgageEngine.getHistoricalStats();
        const tableEl = document.getElementById('mort-stats-table');

        tableEl.innerHTML = `
            <table class="mort-stats-table">
                <thead>
                    <tr>
                        <th>Bindningstid</th>
                        <th>Nu</th>
                        <th>Snitt</th>
                        <th>Min</th>
                        <th>Max</th>
                        <th>Datapunkter</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(stats).map(([id, s]) => {
                        const bt = MortgageEngine.BINDING_TYPES.find(b => b.id === id);
                        return `
                            <tr>
                                <td style="color:${bt?.color || 'inherit'};font-weight:600">${s.label}</td>
                                <td style="font-weight:700">${s.current.toFixed(2)}%</td>
                                <td>${s.avg.toFixed(2)}%</td>
                                <td style="color:var(--positive)">${s.min.toFixed(2)}%</td>
                                <td style="color:var(--negative)">${s.max.toFixed(2)}%</td>
                                <td style="color:var(--text-muted)">${s.dataPoints} mån</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    },

    runMortgageScenario(changePercent) {
        if (!MortgageEngine.isLoaded) return;
        const loan = parseInt(document.getElementById('mort-loan').value);
        const result = MortgageEngine.simulateRateChange(loan, this._mortgageWeights, changePercent);

        const resultEl = document.getElementById('mort-scenario-result');
        resultEl.style.display = 'block';

        const isNeg = result.monthlyDiff > 0;
        resultEl.innerHTML = `
            <div class="mort-scenario-card">
                <div style="font-weight:700;margin-bottom:8px">
                    Om räntan ${changePercent > 0 ? 'höjs' : 'sänks'} med ${Math.abs(changePercent)}%:
                </div>
                <div>Ny snitträntekostnad: <strong>${result.newRate.toFixed(2)}%</strong> (från ${result.currentRate.toFixed(2)}%)</div>
                <div>Ny nettokostnad/mån: <strong>${result.newMonthlyCost.toLocaleString('sv-SE')} kr</strong></div>
                <div style="font-size:1.1rem;margin-top:8px">
                    Skillnad: <span class="${isNeg ? 'negative' : 'positive'}" style="font-weight:700">
                        ${result.monthlyDiff > 0 ? '+' : ''}${result.monthlyDiff.toLocaleString('sv-SE')} kr/mån
                    </span>
                    <span style="color:var(--text-muted)"> (${result.yearlyDiff > 0 ? '+' : ''}${result.yearlyDiff.toLocaleString('sv-SE')} kr/år)</span>
                </div>
                ${result.impacts.filter(i => i.weight > 0).map(i => `
                    <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">
                        ${i.label}: ${i.currentRate.toFixed(2)}% → ${i.newRate.toFixed(2)}%
                        ${i.affected ? '<span style="color:var(--warning)"> ⚡ påverkas direkt</span>' : '<span style="color:var(--positive)"> 🔒 låst</span>'}
                    </div>
                `).join('')}
            </div>
        `;
    },

    /* ═══════ EVENT BINDINGS ═══════ */
    bindEvents() {
        document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());

        document.querySelectorAll('.nav-btn').forEach(btn =>
            btn.addEventListener('click', () => this.switchView(btn.dataset.view)));

        // Bank selector
        document.querySelectorAll('#bank-selector .bank-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#bank-selector .bank-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.selectedBank = btn.dataset.bank;
                // Auto-select first fund of this bank
                const funds = getFundsByBank(btn.dataset.bank);
                if (funds.length > 0) this.state.selectedFundId = funds[0].id;
                this.renderFundList();
                this.updateFundDetail();
            });
        });

        // Tax toggle
        document.querySelectorAll('#user-tax-toggle .tax-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#user-tax-toggle .tax-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.selectedTaxEnv = btn.dataset.tax;
                
                const inputsEl = document.getElementById('portfolio-inputs');
                if (inputsEl) {
                    inputsEl.setAttribute('data-env', btn.dataset.tax);
                }
            });
        });

        // Engine selector toggle
        document.querySelectorAll('#engine-toggle .engine-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#engine-toggle .engine-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.selectedEngine = btn.dataset.engine;
                
                const descEl = document.getElementById('engine-description');
                const titleEl = document.getElementById('chart-main-title');
                
                if (this.state.selectedEngine === 'markowitz') {
                    descEl.innerHTML = '<strong>Bankernas Standardmodell:</strong> Optimerar uppskattad avkastning mot volatilitet. Historiska data används för att rita ut den högsta möjliga kurvan (Effektiva Fronten).';
                    titleEl.textContent = 'Strukturell Analys — Markowitz Mean-Variance';
                    document.getElementById('hrp-target-info').style.display = 'none';
                } else {
                    descEl.innerHTML = '<strong>Modern AI (Hierarkisk Riskparitet):</strong> Beräknar ej framtida avkastning. Minimerar koncentrationsrisk genom att klustra tillgångar baserat på korrelation så att orelaterade risker balanserar varandra.';
                    titleEl.textContent = 'Strukturell Analys — AI-Klustring (HRP)';
                    document.getElementById('hrp-target-info').style.display = 'block';
                }
                
                this.updateFrontierChart();
            });
        });

        // Target selector
        document.querySelectorAll('#target-selector .target-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#target-selector .target-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.selectedTarget = btn.dataset.target;
            });
        });

        // Comparison equity level filter
        document.querySelectorAll('#compare-equity-selector .profile-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#compare-equity-selector .profile-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.updateComparisonView();
            });
        });

        // Portfolio controls
        document.getElementById('btn-add-position').addEventListener('click', () => this.addPositionRow());
        document.getElementById('btn-optimize').addEventListener('click', () => this.runOptimization());
        document.getElementById('btn-clear-portfolio').addEventListener('click', () => this.clearPortfolio());

        // Tax simulation
        document.getElementById('btn-simulate').addEventListener('click', () => this.runTaxSimulation());
        ['sim-return', 'sim-dividend', 'sim-years', 'sim-turnover'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.runTaxSimulation());
        });
        document.getElementById('sim-liquidate').addEventListener('change', () => this.runTaxSimulation());
        document.getElementById('sim-capital').addEventListener('change', () => this.runTaxSimulation());
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
