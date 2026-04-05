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
        
        // Lazy-init savings tab
        if (viewName === 'savings' && !this._savingsInit) {
            this.initSavingsTab();
        }
        
        // Lazy-init compare-mortgage tab
        if (viewName === 'compare-mortgage' && !this._compareMortgageInit) {
            this.initCompareMortgageTab();
        }
    },

    /* ═══════ MORTGAGE TAB ═══════ */
    _mortgageInit: false,
    _mortgageWeights: { variable: 0.34, fixed_1y: 0.33, fixed_3y: 0.33 },
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
        // Subtabs (Historik vs Backtest)
        document.querySelectorAll('.mort-subtab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.mort-subtab').forEach(b => {
                    b.classList.remove('active');
                    b.style.color = 'var(--text-muted)';
                    b.style.borderBottomColor = 'transparent';
                });
                
                const target = e.target;
                target.classList.add('active');
                target.style.color = 'var(--text-primary)';
                target.style.borderBottomColor = 'var(--accent-primary)';
                
                const tabId = target.dataset.tab;
                document.getElementById('mort-view-historik').style.display = tabId === 'historik' ? 'block' : 'none';
                document.getElementById('mort-view-backtest').style.display = tabId === 'backtest' ? 'block' : 'none';
            });
        });

        // Loan slider
        document.getElementById('mort-loan').addEventListener('input', (e) => {
            const v = parseInt(e.target.value);
            document.getElementById('mort-loan-label').textContent = v.toLocaleString('sv-SE') + ' kr';
            this.updateMortgageCost();
            clearTimeout(this._mortBacktestTimer);
            this._mortBacktestTimer = setTimeout(() => this.runMortgageBacktest(), 300);
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

                // Debounced backtest update (avoids lag while dragging)
                clearTimeout(this._mortBacktestTimer);
                this._mortBacktestTimer = setTimeout(() => this.runMortgageBacktest(), 200);
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

        // Period selector for backtest
        const periodSelect = document.getElementById('mort-period-select');
        if (periodSelect) {
            periodSelect.addEventListener('change', () => {
                this.runMortgageBacktest();
            });
        }
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
            .map(bt => {
                // Use NaN (not null) for missing data — Chart.js skips NaN properly
                const data = months.map(m => {
                    const series = MortgageEngine.rateData[bt.id];
                    return (series && series[m] !== undefined) ? series[m] : NaN;
                });
                return {
                    label: bt.label,
                    data: data,
                    borderColor: bt.color,
                    backgroundColor: bt.color + '15',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.2,
                    fill: false,
                    spanGaps: false,
                };
            });

        // Add dashed reference line: SCB aggregate "Bunden 1-5 år" (full data from 2005)
        const refSeries = MortgageEngine.rateData['ref_1to5y'];
        if (refSeries && Object.keys(refSeries).length > 100) {
            datasets.push({
                label: 'Snitt 1-5 år (ref)',
                data: months.map(m => (refSeries && refSeries[m] !== undefined) ? refSeries[m] : NaN),
                borderColor: 'rgba(255,255,255,0.3)',
                borderWidth: 1.5,
                borderDash: [6, 4],
                pointRadius: 0,
                pointHoverRadius: 3,
                tension: 0.2,
                fill: false,
                spanGaps: false,
            });
        }

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
                            label: ctx => {
                                const v = ctx.parsed.y;
                                return (v !== null && !isNaN(v)) ? `${ctx.dataset.label}: ${v.toFixed(2)}%` : null;
                            }
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

        // Only run when weights sum to 100% — prevents misleading results
        const totalWeight = Math.round(Object.values(this._mortgageWeights).reduce((s, v) => s + v, 0) * 100);
        const tableEl = document.getElementById('mort-backtest-table');
        if (Math.abs(totalWeight - 100) > 1) {
            tableEl.innerHTML = `
                <div style="text-align:center;padding:24px;color:var(--text-muted);border:1px dashed var(--border-color);border-radius:8px;margin-top:12px">
                    <span style="font-size:1.5rem">⚠️</span><br>
                    <strong style="color:var(--negative)">Summan är ${totalWeight}% — måste vara 100%</strong><br>
                    <span style="font-size:0.75rem">Justera reglagen ovan så att summan blir exakt 100% för att se backtestet</span>
                </div>
            `;
            if (this._mortBacktestChart) { this._mortBacktestChart.destroy(); this._mortBacktestChart = null; }
            return;
        }

        const loan = parseInt(document.getElementById('mort-loan').value);
        const periodSelect = document.getElementById('mort-period-select');
        const periodYears = periodSelect ? parseInt(periodSelect.value) : 10;

        // Calculate start/end based on selected period
        const endMonth = MortgageEngine.months[MortgageEngine.months.length - 1];
        const endDate = MortgageEngine.parseMonth(endMonth);
        const startDate = new Date(endDate);
        startDate.setFullYear(startDate.getFullYear() - periodYears);
        const startYear = startDate.getFullYear();
        const startMo = String(startDate.getMonth() + 1).padStart(2, '0');
        const startMonth = `${startYear}M${startMo}`;

        // Ensure startMonth exists and all selected binding types have data
        let validStart = MortgageEngine.months.find(m => m >= startMonth) || MortgageEngine.months[0];

        // For binding types with partial data, clamp start to earliest available
        const usedTypes = new Set();
        for (const s of [...MortgageEngine.getStandardStrategies(), { weights: this._mortgageWeights }]) {
            for (const id of Object.keys(s.weights)) {
                if (s.weights[id] > 0) usedTypes.add(id);
            }
        }
        for (const typeId of usedTypes) {
            const series = MortgageEngine.rateData[typeId];
            if (series) {
                const firstMonth = Object.keys(series).sort()[0];
                if (firstMonth > validStart) validStart = firstMonth;
            }
        }

        // Standard strategies + user's mix
        const strategies = [
            { name: 'Din mix', weights: { ...this._mortgageWeights } },
            ...MortgageEngine.getStandardStrategies(),
        ];

        const comparison = MortgageEngine.compareStrategies(loan, strategies, validStart, endMonth);

        // Render table
        const numMonths = comparison[0]?.result?.numMonths || 0;
        const numYears = (numMonths / 12).toFixed(1);
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
            <p style="color:var(--text-muted);font-size:0.7rem;margin-top:8px">Period: ${MortgageEngine.formatMonth(validStart)} → ${MortgageEngine.formatMonth(endMonth)} (${numMonths} månader ≈ ${numYears} år)</p>
        `;

        // Render backtest chart (monthly cost over time for top strategies)
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
        const allTypes = MortgageEngine.BINDING_TYPES;

        tableEl.innerHTML = `
            <table class="mort-stats-table">
                <thead>
                    <tr>
                        <th>Bindningstid</th>
                        <th>Nu</th>
                        <th>Snitt</th>
                        <th>Min</th>
                        <th>Max</th>
                        <th>Data från</th>
                        <th>Punkter</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(stats).map(([id, s]) => {
                        const bt = allTypes.find(b => b.id === id);

                        return `
                            <tr>
                                <td style="color:${bt?.color || 'inherit'};font-weight:600">${isDetail ? '  └ ' : ''}${s.label}</td>
                                <td style="font-weight:700">${s.current.toFixed(2)}%</td>
                                <td>${s.avg.toFixed(2)}%</td>
                                <td style="color:var(--positive)">${s.min.toFixed(2)}%</td>
                                <td style="color:var(--negative)">${s.max.toFixed(2)}%</td>
                                <td style="color:var(--text-muted)">${MortgageEngine.formatMonth(s.firstMonth)}</td>
                                <td style="color:var(--text-muted)">${s.dataPoints}</td>
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

        document.querySelectorAll('.nav-btn').forEach(btn => {
            if (btn.dataset.view) {
                btn.addEventListener('click', () => this.switchView(btn.dataset.view));
            }
        });

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

    /* ═══════ SAVINGS TAB ═══════ */
    _savingsInit: false,
    _savingsActiveType: 'flexible',

    initSavingsTab() {
        if (!window.SAVINGS_ACCOUNTS) {
            console.error('Savings data not loaded.');
            return;
        }

        // Bind type toggle
        document.querySelectorAll('#savings-type-toggle .tax-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#savings-type-toggle .tax-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._savingsActiveType = btn.dataset.type;
                this.populateSavingsBankSelect();
                this.updateSavingsView();
            });
        });

        this.populateSavingsBankSelect();

        // Bind events
        document.getElementById('savings-amount').addEventListener('input', (e) => {
            const v = parseInt(e.target.value);
            document.getElementById('savings-amount-label').textContent = v.toLocaleString('sv-SE') + ' kr';
            this.updateSavingsView();
        });

        document.getElementById('savings-current-bank').addEventListener('change', () => {
            this.updateSavingsView();
        });

        this.updateSavingsView();
        this._savingsInit = true;
    },

    populateSavingsBankSelect() {
        const bankSelect = document.getElementById('savings-current-bank');
        
        // Populate dropdown with all banks (both big and niche) that match the active type
        // Put big banks first for UX
        const relevantAccounts = window.SAVINGS_ACCOUNTS.filter(a => a.type === this._savingsActiveType);
        const bigBanks = relevantAccounts.filter(a => a.isBigBank);
        const nicheBanks = relevantAccounts.filter(a => !a.isBigBank);
        
        bankSelect.innerHTML = 
            '<optgroup label="Storbanker (Vanligast)">' +
            bigBanks.map(b => `<option value="${b.id}">${b.name} — ${b.rate.toFixed(2)}%</option>`).join('') +
            '</optgroup>' +
            '<optgroup label="Nischbanker">' +
            nicheBanks.map(b => `<option value="${b.id}">${b.name} — ${b.rate.toFixed(2)}%</option>`).join('') +
            '</optgroup>';
    },

    updateSavingsView() {
        const capital = parseInt(document.getElementById('savings-amount').value);
        let selectedId = document.getElementById('savings-current-bank').value;
        const relevantAccounts = window.SAVINGS_ACCOUNTS.filter(a => a.type === this._savingsActiveType);
        
        let currentBank = relevantAccounts.find(a => a.id === selectedId);
        if (!currentBank) {
            // Fallback if type changed and previous ID no longer exists
            currentBank = relevantAccounts[0];
            document.getElementById('savings-current-bank').value = currentBank.id;
        }
        
        // Find best alternative in this category
        const alternatives = relevantAccounts
                                   .filter(a => a.guarantee)
                                   .sort((a, b) => b.rate - a.rate);
        
        const bestBank = alternatives[0];
        
        // Calculate diff
        const currentYield = capital * (currentBank.rate / 100);
        const currentYieldAfterTax = currentYield * 0.7; // 30% tax
        
        const bestYield = capital * (bestBank.rate / 100);
        const bestYieldAfterTax = bestYield * 0.7;
        
        const extraYield = bestYieldAfterTax - currentYieldAfterTax;
        
        document.getElementById('savings-extra-yield').textContent = '+' + Math.round(extraYield).toLocaleString('sv-SE') + ' kr/år';
        document.getElementById('savings-action-text').innerHTML = `
            Genom att flytta ditt buffertsparande från <strong>${currentBank.name}</strong> (${currentBank.rate.toFixed(2)}%) till <strong>${bestBank.name}</strong> (${bestBank.rate.toFixed(2)}%) får du <strong>${Math.round(extraYield).toLocaleString('sv-SE')} kr mer i plånboken varje år</strong> (räknat efter 30% kapitalskatt), helt riskfritt tack vare den statliga insättningsgarantin.
        `;
        
        // Render table
        this.renderSavingsTable(currentBank.id, capital, relevantAccounts);
    },
    
    renderSavingsTable(currentBankId, capital, relevantAccounts) {
        const container = document.getElementById('savings-table-container');
        
        // Sort best first
        const sorted = [...relevantAccounts].sort((a, b) => b.rate - a.rate);
        
        let html = `
            <table class="data-table" style="width:100%; text-align:left;">
                <thead>
                    <tr>
                        <th style="padding-bottom:8px">Aktör</th>
                        <th style="padding-bottom:8px">Ränta</th>
                        <th style="padding-bottom:8px; text-align:right">Tjänar/År (efter skatt)</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        const currentBank = relevantAccounts.find(a => a.id === currentBankId);
        const currentYieldAfterTax = capital * (currentBank.rate / 100) * 0.7;

        for (const bank of sorted) {
            const isCurrent = bank.id === currentBankId;
            const yieldAfterTax = capital * (bank.rate / 100) * 0.7;
            const extra = yieldAfterTax - currentYieldAfterTax;
            
            // Format diff
            let extraStr = '—';
            let color = 'var(--text-muted)';
            if (extra > 0) {
                extraStr = '+' + Math.round(extra).toLocaleString('sv-SE') + ' kr';
                color = 'var(--positive)';
            } else if (extra < 0) {
                extraStr = Math.round(extra).toLocaleString('sv-SE') + ' kr';
                color = 'var(--negative)';
            } else {
                extraStr = 'Din valda bank';
            }

            html += `
                <tr style="${isCurrent ? 'background:var(--bg-panel-hover)' : ''}">
                    <td style="padding:10px 4px; border-bottom:1px solid var(--border-highlight);">
                        <span style="font-weight:600; color:var(--text-primary)">${bank.name}</span>
                        ${isCurrent ? '<span style="font-size:9px; margin-left:6px; background:var(--border-highlight); padding:2px 4px; border-radius:3px">VALD</span>' : ''}
                    </td>
                    <td style="padding:10px 4px; border-bottom:1px solid var(--border-highlight); font-weight:700; color:var(--accent)">
                        ${bank.rate.toFixed(2)}%
                    </td>
                    <td style="padding:10px 4px; border-bottom:1px solid var(--border-highlight); text-align:right; font-weight:600; color:${color}">
                        ${extraStr}
                    </td>
                </tr>
            `;
        }
        
        html += `</tbody></table>`;
        container.innerHTML = html;
    },

    /* ═══════ COMPARE MORTGAGE TAB ═══════ */
    _compareMortgageInit: false,
    _compareMortgageActiveType: 'variable',

    renderRatesFreshnessBadge() {
        const badge = document.getElementById('rates-freshness-badge');
        if (!badge) return;

        const meta = window.MORTGAGE_BANKS_META;
        if (!meta || !meta.lastUpdated) {
            badge.textContent = '⚠️ Okänd källa';
            badge.style.background = 'rgba(255,100,0,0.15)';
            badge.style.color = '#ff6600';
            return;
        }

        const updated = new Date(meta.lastUpdated + 'T00:00:00');
        const now = new Date();
        const diffMs = now - updated;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        // Swedish month names
        const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
        const dateStr = `${updated.getDate()} ${months[updated.getMonth()]} ${updated.getFullYear()}`;

        let icon, color, bgColor;
        if (diffDays <= 2) {
            icon = '🟢'; color = '#00ff88'; bgColor = 'rgba(0,255,136,0.1)';
        } else if (diffDays <= 7) {
            icon = '🟡'; color = '#ffcc00'; bgColor = 'rgba(255,204,0,0.1)';
        } else {
            icon = '🔴'; color = '#ff3366'; bgColor = 'rgba(255,51,102,0.1)';
        }

        badge.innerHTML = `${icon} Uppdaterad: ${dateStr}`;
        badge.style.background = bgColor;
        badge.style.color = color;
        badge.style.border = `1px solid ${color}33`;

        // Tooltip with extra details
        const verified = meta.lastVerified || '—';
        const bankCount = meta.totalBanks || '—';
        badge.title = `Listräntor verifierade: ${verified}\nAntal bankposter: ${bankCount}\nKällor: ${meta.sources || '—'}`;
    },

    initCompareMortgageTab() {
        if (!window.MORTGAGE_BANKS) {
            console.error('Mortgage banks data not loaded.');
            return;
        }

        // ── Render freshness badge ──
        this.renderRatesFreshnessBadge();

        // Bind type toggle  
        document.querySelectorAll('#compare-mortgage-type-toggle .mortgage-bind-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#compare-mortgage-type-toggle .mortgage-bind-btn').forEach(b => {
                    b.classList.remove('active');
                    b.style.border = '2px solid var(--border-color)';
                    b.style.background = 'var(--bg-tertiary)';
                    b.style.color = 'var(--text-muted)';
                    b.style.fontWeight = '600';
                });
                btn.classList.add('active');
                btn.style.border = '2px solid var(--accent-primary)';
                btn.style.background = 'rgba(0,255,136,0.12)';
                btn.style.color = '#00ff88';
                btn.style.fontWeight = '700';
                this._compareMortgageActiveType = btn.dataset.type;
                this.populateCompareMortgageSelect();
                this.updateCompareMortgageView();
                this.updatePersonalRates();
            });
        });

        this.populateCompareMortgageSelect();

        // Bind property value slider
        const propSlider = document.getElementById('compare-property-value');
        if (propSlider) {
            propSlider.addEventListener('input', (e) => {
                const v = parseInt(e.target.value);
                document.getElementById('compare-property-value-label').textContent = v.toLocaleString('sv-SE') + ' kr';
                this.updateLTV();
                this.updatePersonalRates();
                this.updateCompareMortgageView();
            });
        }

        // Bind loan amount slider
        document.getElementById('compare-mortgage-amount').addEventListener('input', (e) => {
            const v = parseInt(e.target.value);
            document.getElementById('compare-mortgage-amount-label').textContent = v.toLocaleString('sv-SE') + ' kr';
            this.updateLTV();
            this.updatePersonalRates();
            this.updateCompareMortgageView();
        });

        document.getElementById('compare-mortgage-current-bank').addEventListener('change', () => {
            this.updateCompareMortgageView();
            // Re-render chart and insights if history tab is active
            const activeTabBtn = document.querySelector('#compare-mortgage-right-tabs .nav-btn.active');
            if (activeTabBtn && activeTabBtn.dataset.tab === 'history') {
                this.renderMortgageHistoryChart();
            }
        });

        // Bind right panel tabs
        document.querySelectorAll('#compare-mortgage-right-tabs .nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('#compare-mortgage-right-tabs .nav-btn').forEach(b => {
                    b.classList.remove('active');
                    b.style.color = 'var(--text-muted)';
                    b.style.borderBottom = '2px solid transparent';
                });
                const target = e.currentTarget;
                target.classList.add('active');
                target.style.color = 'var(--text-primary)';
                target.style.borderBottom = '2px solid var(--accent-primary)';
                
                const tab = target.dataset.tab;
                if (tab === 'history') {
                    document.getElementById('compare-mortgage-table-container').style.display = 'none';
                    document.getElementById('compare-mortgage-history-container').style.display = 'block';
                    this.renderMortgageHistoryChart();
                } else {
                    document.getElementById('compare-mortgage-history-container').style.display = 'none';
                    document.getElementById('compare-mortgage-table-container').style.display = 'block';
                }
            });
        });

        // Bind zoom buttons for history chart
        document.querySelectorAll('.zoom-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.zoom-btn').forEach(b => {
                    b.classList.remove('active');
                    b.style.background = 'var(--bg-tertiary)';
                    b.style.color = 'var(--text-muted)';
                    b.style.borderColor = 'var(--border-color)';
                });
                btn.classList.add('active');
                btn.style.background = 'var(--accent-primary)';
                btn.style.color = '#fff';
                btn.style.borderColor = 'var(--accent-primary)';
                this.renderMortgageHistoryChart();
            });
        });

        // Initial render
        this.updateLTV();
        this.updatePersonalRates();
        this.renderDiscountCurvesFreshness();
        this.updateCompareMortgageView();
        
        // Also ensure charting works initially if they start on history (unlikely, but safe)
        if(document.querySelector('#compare-mortgage-right-tabs .active').dataset.tab === 'history'){
             this.renderMortgageHistoryChart();
        }

        this._compareMortgageInit = true;
    },

    // ── LTV Calculation ──
    updateLTV() {
        const loan = parseInt(document.getElementById('compare-mortgage-amount')?.value || 3000000);
        const prop = parseInt(document.getElementById('compare-property-value')?.value || 5000000);
        const ltv = Math.round((loan / prop) * 100);
        const ltvEl = document.getElementById('compare-ltv-display');
        if (ltvEl) {
            ltvEl.textContent = ltv + '%';
            // Color code
            if (ltv <= 50) {
                ltvEl.style.color = '#00ff88';
            } else if (ltv <= 70) {
                ltvEl.style.color = '#00ccff';
            } else if (ltv <= 75) {
                ltvEl.style.color = '#ffcc00';
            } else {
                ltvEl.style.color = '#ff3366';
            }
        }
        return ltv;
    },

    // ── Interpolate discount from curve ──
    interpolateDiscount(curve, ltv) {
        if (!curve) return 0;

        const points = Object.keys(curve).map(Number).sort((a, b) => a - b);
        const values = points.map(p => curve[String(p)]);

        // Clamp to range
        if (ltv <= points[0]) return values[0];
        if (ltv >= points[points.length - 1]) return values[values.length - 1];

        // Linear interpolation
        for (let i = 0; i < points.length - 1; i++) {
            if (ltv >= points[i] && ltv <= points[i + 1]) {
                const t = (ltv - points[i]) / (points[i + 1] - points[i]);
                return values[i] + t * (values[i + 1] - values[i]);
            }
        }
        return 0;
    },

    // ── Generate Mortgage Insights ──
    generateMortgageInsights(db, currentData, binding) {
        const insightsList = document.getElementById('history-insights-list');
        if (!insightsList) return;
        
        const scb = currentData["SCB_Marknad"];
        if (!scb) {
            insightsList.innerHTML = '<li>Marknadsdata (SCB) saknas.</li>';
            return;
        }

        const months = db.months;
        const N = months.length;
        
        // ── Step 1: Analyze every bank ──
        const bankAnalyses = [];
        
        for (const [bankName, rates] of Object.entries(currentData)) {
            if (bankName === "SCB_Marknad") continue;
            
            const nonNull = rates.filter(r => r !== null);
            if (nonNull.length < 12) continue; // Need at least 1 year of data
            
            // Calculate average vs SCB over entire overlap
            let totalDiffSum = 0, totalDiffCount = 0;
            let last3yDiffSum = 0, last3yCount = 0;
            
            for (let i = 0; i < N; i++) {
                if (rates[i] !== null && scb[i] !== null) {
                    const diff = rates[i] - scb[i];
                    totalDiffSum += diff;
                    totalDiffCount++;
                    
                    if (i >= N - 36) { // Last 3 years
                        last3yDiffSum += diff;
                        last3yCount++;
                    }
                }
            }
            
            if (totalDiffCount === 0) continue;
            
            const avgDiffAll = totalDiffSum / totalDiffCount; // pos = dyrare
            const avgDiff3y = last3yCount > 0 ? last3yDiffSum / last3yCount : null;
            const currentRate = rates[N - 1];
            
            // Reactivity analysis: how fast does this bank follow SCB during big moves?
            // Look at the 2022-2023 hike period
            let hikeReactivity = null;
            const hikeStartIdx = months.indexOf("2022-01");
            const hikePeakIdx = months.indexOf("2023-09");
            if (hikeStartIdx >= 0 && hikePeakIdx >= 0 && rates[hikeStartIdx] !== null && rates[hikePeakIdx] !== null && scb[hikeStartIdx] !== null && scb[hikePeakIdx] !== null) {
                const bankHike = rates[hikePeakIdx] - rates[hikeStartIdx];
                const scbHike = scb[hikePeakIdx] - scb[hikeStartIdx];
                hikeReactivity = scbHike > 0 ? (bankHike / scbHike) : null;
            }
            
            // Drop analysis: how fast did they lower during 2024-2025?
            let dropReactivity = null;
            const dropStartIdx = months.indexOf("2023-09");
            const dropEndIdx = N - 1;
            if (dropStartIdx >= 0 && rates[dropStartIdx] !== null && rates[dropEndIdx] !== null && scb[dropStartIdx] !== null && scb[dropEndIdx] !== null) {
                const bankDrop = rates[dropStartIdx] - rates[dropEndIdx];
                const scbDrop = scb[dropStartIdx] - scb[dropEndIdx];
                dropReactivity = scbDrop > 0 ? (bankDrop / scbDrop) : null;
            }
            
            bankAnalyses.push({
                name: bankName,
                avgDiffAll: avgDiffAll,
                avgDiff3y: avgDiff3y,
                currentRate: currentRate,
                months: totalDiffCount,
                hikeReactivity: hikeReactivity,
                dropReactivity: dropReactivity
            });
        }
        
        if (bankAnalyses.length === 0) {
            insightsList.innerHTML = '<li>Ingen tillräcklig historik finns för att göra en analys.</li>';
            return;
        }
        
        // ── Step 2: Rank banks ──
        const ranked = [...bankAnalyses].sort((a, b) => a.avgDiffAll - b.avgDiffAll); // Lowest diff = cheapest
        
        // Binding type label
        const bindingLabels = {
            'variable': 'Rörligt (3 mån)',
            'fixed_1y': '1 År bunden',
            'fixed_2y': '2 År bunden',
            'fixed_3y': '3 År bunden',
            'fixed_5y': '5 År bunden'
        };
        const bindLabel = bindingLabels[binding] || binding;
        
        // Find the date range across all analyzed banks
        const firstDataMonth = months.find((m, i) => {
            return ranked.some(bank => {
                const rates = currentData[bank.name];
                return rates && rates[i] !== null;
            });
        }) || months[0];
        const lastDataMonth = months[N - 1];
        
        // ── Step 3: Generate per-bank verdict ──
        let html = '';
        
        // Overall ranking header
        const bestName = ranked[0].name;
        const worstName = ranked[ranked.length - 1].name;
        
        html += `<li style="margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid var(--border-color);">
            <b>📊 Ranking för ${bindLabel}</b> <span style="opacity:0.5;font-size:0.75rem;">(${firstDataMonth} → ${lastDataMonth}, jämfört med SCB marknadssnitt)</span><br>
            <span style="color:#00ff88;">🥇 ${ranked[0].name}</span>`;
        if (ranked.length > 1) html += ` · <span style="color:#00ccff;">🥈 ${ranked[1].name}</span>`;
        if (ranked.length > 2) html += ` · <span style="color:#ff9900;">🥉 ${ranked[2].name}</span>`;
        if (ranked.length > 3) {
            html += `<br><span style="font-size:0.75rem;opacity:0.7;">`;
            for (let i = 3; i < ranked.length; i++) {
                html += `${i + 1}. ${ranked[i].name}`;
                if (i < ranked.length - 1) html += ' · ';
            }
            html += `</span>`;
        }
        html += `</li>`;
        
        // Per-bank analysis
        for (const bank of ranked) {
            let emoji = '';
            let verdict = '';
            const diffPct = Math.abs(bank.avgDiffAll).toFixed(2);
            
            // Price level verdict
            if (bank.avgDiffAll < -0.05) {
                emoji = '💰';
                verdict = `Historiskt <b>${diffPct}% billigare</b> än marknadssnittet.`;
            } else if (bank.avgDiffAll > 0.05) {
                emoji = '💸';
                verdict = `Historiskt <b>${diffPct}% dyrare</b> än marknadssnittet.`;
            } else {
                emoji = '🎯';
                verdict = `Exakt på genomsnittet historiskt.`;
            }
            
            // Reactivity verdict
            let reactVerdict = '';
            if (bank.hikeReactivity !== null && bank.dropReactivity !== null) {
                if (bank.hikeReactivity > 1.05 && bank.dropReactivity < 0.95) {
                    reactVerdict = ` Höjde snabbare än snittet under 2022–2023, men <b>sänkte långsammare</b> efter. Förhandla hårt!`;
                } else if (bank.hikeReactivity < 0.95 && bank.dropReactivity > 1.05) {
                    reactVerdict = ` Skyddade sina kunder under räntechocken 2022, och var <b>snabb på att sänka</b> när det vände. Kundvänligt beteende.`;
                } else if (bank.dropReactivity > 1.05) {
                    reactVerdict = ` <b>Snabb på att sänka</b> räntan under det senaste nedsvinget – bra för låntagaren.`;
                } else if (bank.dropReactivity < 0.90) {
                    reactVerdict = ` <b>Trög på att sänka</b> – behöll marginaler längre än konkurrenterna under senaste perioden av räntesänkningar.`;
                } else {
                    reactVerdict = ` Följde marknadens rörelser nästan identiskt under hela räntecykeln 2022–2025.`;
                }
            }
            
            html += `<li style="margin-bottom:8px;">${emoji} <b>${bank.name}:</b> ${verdict}${reactVerdict} <span style="opacity:0.6;font-size:0.75rem;">(Nu: ${bank.currentRate}%)</span></li>`;
        }
        
        insightsList.innerHTML = html;
    },

    // ── Render History Chart ──
    renderMortgageHistoryChart() {
        if (!window.MORTGAGE_HISTORY) return;
        
        const canvas = document.getElementById('mortgage-history-chart');
        if (!canvas) return;
        
        const db = window.MORTGAGE_HISTORY;
        const binding = this._compareMortgageActiveType;
        const currentData = db.data[binding];
        if (!currentData) return;
        
        // Zoom functionality
        let zoomYears = 5;
        const activeZoomBtn = document.querySelector('.zoom-btn.active');
        if (activeZoomBtn) {
            zoomYears = activeZoomBtn.dataset.years === '10' ? 999 : parseInt(activeZoomBtn.dataset.years);
        }
        
        const bankSelect = document.getElementById('compare-mortgage-current-bank');
        const selectedId = bankSelect ? bankSelect.value : null;
        let myBank = null;
        if (selectedId && window.MORTGAGE_BANKS) {
            const b = window.MORTGAGE_BANKS.find(x => x.id === selectedId);
            if (b) myBank = b.name;
        }
        
        this.generateMortgageInsights(db, currentData, binding);

        // Calculate slice index based on zoom
        const monthsCount = db.months.length;
        let startIndex = 0;
        if (zoomYears !== 999) {
            startIndex = Math.max(0, monthsCount - (zoomYears * 12));
        }

        const slicedMonths = db.months.slice(startIndex);

        // Find the absolute best bank (lowest average today)
        let lowestRate = 99;
        let bestBank = '';
        for (const [bank, rates] of Object.entries(currentData)) {
            if (bank === "SCB_Marknad") continue;
            const lastVal = rates[rates.length - 1];
            if (lastVal && lastVal < lowestRate) {
                lowestRate = lastVal;
                bestBank = bank;
            }
        }

        // Colors mapping
        const bankColors = {
            "SCB_Marknad": "rgba(255, 255, 255, 0.4)",
            "SBAB": "#00ff88",
            "Swedbank": "#ff9900",
            "Handelsbanken": "#00aaff",
            "SEB": "#00cc66",
            "Nordea": "#0055ff",
            "ICA Banken": "#ff3366",
            "Skandiabanken": "#00ccff",
            "Länsförsäkringar": "#ff0000",
            "Danske Bank": "#eeb422"
        };

        const datasets = [];
        
        for (const [bank, rates] of Object.entries(currentData)) {
            const isScb = bank === "SCB_Marknad";
            const isMyBank = bank === myBank;
            const isBestBank = bank === bestBank;
            
            // Anti-spaghetti logic: dim non-interesting banks initially
            // Let chartjs display them via legend interactions, or make them visually dim
            let defaultHidden = false;
            let displayOpacity = 1;
            let borderWidth = 2.5;
            
            if (!isScb && !isMyBank && !isBestBank) {
                defaultHidden = true; // They are in legend, but crossed out by default
            }
            if (isScb) {
                borderWidth = 2;
                displayOpacity = 0.5;
            } else if (isBestBank && !isMyBank) {
                displayOpacity = 0.7; // Best bank gets highlighted, but myBank is king
            }

            const c = bankColors[bank] || "hsl(" + (Math.random() * 360) + ", 70%, 60%)";
            
            // For custom hover interaction logic, ChartJS handles it usually, 
            // but we use hidden config to reduce spaghetti
            datasets.push({
                label: isScb ? "Snitt Marknaden (SCB)" : bank + (isBestBank ? ' (🥇 Bäst nu)' : ''),
                data: rates.slice(startIndex),
                borderColor: c,
                backgroundColor: 'transparent',
                borderWidth: isScb ? 2 : (isMyBank ? 4 : 2),
                borderDash: isScb ? [5, 5] : [],
                tension: 0.1,
                pointRadius: 0,
                pointHoverRadius: 5,
                hidden: defaultHidden
            });
        }

        if (this._mortgageChartInstance) {
            this._mortgageChartInstance.destroy();
        }

        const ctx = canvas.getContext('2d');
        const Chart = window.Chart;

        this._mortgageChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: slicedMonths,
                datasets: datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#bbb', font: {family: "'Inter', sans-serif", size: 11}, usePointStyle: true }
                    },
                    tooltip: {
                        backgroundColor: '#1a1f2e',
                        titleColor: '#fff',
                        bodyColor: '#00ff88',
                        borderColor: '#2e3a4e',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.y + '%';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'transparent', drawBorder: false },
                        ticks: { color: '#888', maxTicksLimit: 8 }
                    },
                    y: {
                        grid: { color: '#2e3a4e', drawBorder: false },
                        ticks: {
                            color: '#888',
                            callback: function(value) { return value + '%'; }
                        }
                    }
                }
            }
        });
    },

    // ── Personal Rate Cards ──
    updatePersonalRates() {
        const container = document.getElementById('personal-rate-cards');
        if (!container || !window.DISCOUNT_CURVES) return;

        const ltv = this.updateLTV();
        const type = this._compareMortgageActiveType;
        const loan = parseInt(document.getElementById('compare-mortgage-amount')?.value || 3000000);

        const results = [];

        for (const [bankName, curves] of Object.entries(window.DISCOUNT_CURVES)) {
            const curve = curves[type];
            if (!curve) continue;

            // Find listRate for this bank + type
            const bankEntry = window.MORTGAGE_BANKS.find(b => b.name === bankName && b.type === type);
            if (!bankEntry) continue;

            const discount = this.interpolateDiscount(curve, ltv);
            const personalRate = Math.max(bankEntry.listRate - discount, 0.5); // Floor at 0.5%
            const yearlyCost = loan * (personalRate / 100);
            const monthlyCost = Math.round(yearlyCost / 12);

            results.push({
                name: bankName,
                listRate: bankEntry.listRate,
                discount: discount,
                personalRate: personalRate,
                monthlyCost: monthlyCost
            });
        }

        // Sort by personal rate (cheapest first)
        results.sort((a, b) => a.personalRate - b.personalRate);

        if (results.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;">Inga avdragskurvor för denna bindningstid</p>';
            return;
        }

        container.innerHTML = results.map((r, i) => {
            const rateColor = i === 0 ? '#00ff88' : (i === 1 ? '#00ccff' : 'var(--text-primary)');
            const badge = i === 0 ? ' <span style="background:#00ff8822;color:#00ff88;padding:1px 6px;border-radius:4px;font-size:0.6rem;margin-left:4px;">BÄST</span>' : '';
            return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-tertiary);border:1px solid ${i === 0 ? '#00ff8833' : 'var(--border-color)'};border-radius:8px;">
                    <div>
                        <span style="font-weight:600;font-size:0.85rem;color:var(--text-primary);">${r.name}</span>${badge}
                        <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;">List ${r.listRate.toFixed(2)}% − avdrag ${r.discount.toFixed(2)}%</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:1.1rem;color:${rateColor};">${r.personalRate.toFixed(2)}%</div>
                        <div style="font-size:0.65rem;color:var(--text-muted);">${r.monthlyCost.toLocaleString('sv-SE')} kr/mån</div>
                    </div>
                </div>
            `;
        }).join('');
    },

    renderDiscountCurvesFreshness() {
        const el = document.getElementById('discount-curves-freshness');
        if (!el || !window.DISCOUNT_CURVES_META) return;
        const meta = window.DISCOUNT_CURVES_META;
        const method = meta.method === 'playwright_auto' ? 'Automatisk (Playwright)' : 'Manuell initial';
        el.textContent = `Kalibrerad: ${meta.lastCalibrated} · Metod: ${method} · Banker: ${meta.banks.join(', ')}`;
    },


    populateCompareMortgageSelect() {
        const bankSelect = document.getElementById('compare-mortgage-current-bank');
        
        const relevantAccounts = window.MORTGAGE_BANKS.filter(a => a.type === this._compareMortgageActiveType);
        const bigBanks = relevantAccounts.filter(a => a.isBigBank);
        const nicheBanks = relevantAccounts.filter(a => !a.isBigBank);
        
        bankSelect.innerHTML = 
            '<optgroup label="Storbanker">' +
            bigBanks.map(b => `<option value="${b.id}">${b.name} — ${b.avgRate.toFixed(2)}% (Snitt)</option>`).join('') +
            '</optgroup>' +
            '<optgroup label="Nischbanker">' +
            nicheBanks.map(b => `<option value="${b.id}">${b.name} — ${b.avgRate.toFixed(2)}% (Snitt)</option>`).join('') +
            '</optgroup>';
    },

    updateCompareMortgageView() {
        const capital = parseInt(document.getElementById('compare-mortgage-amount').value);
        let selectedId = document.getElementById('compare-mortgage-current-bank').value;
        const relevantAccounts = window.MORTGAGE_BANKS.filter(a => a.type === this._compareMortgageActiveType);
        
        if (relevantAccounts.length === 0) return;

        let currentBank = relevantAccounts.find(a => a.id === selectedId);
        if (!currentBank) {
            currentBank = relevantAccounts[0];
            document.getElementById('compare-mortgage-current-bank').value = currentBank.id;
        }
        
        // Find best alternative in this category based on average rate
        const alternatives = [...relevantAccounts].sort((a, b) => a.avgRate - b.avgRate);
        const bestBank = alternatives[0];
        
        // Calculate diff. Since this is a loan, lower is better. We pay interest.
        // Difference is current payment minus best payment.
        const currentInterest = capital * (currentBank.avgRate / 100);
        const currentCostAfterDeduction = currentInterest * 0.7; // 30% ränteavdrag
        
        const bestInterest = capital * (bestBank.avgRate / 100);
        const bestCostAfterDeduction = bestInterest * 0.7; // 30% ränteavdrag
        
        const extraYield = currentCostAfterDeduction - bestCostAfterDeduction; 
        
        const yieldEl = document.getElementById('compare-mortgage-extra-yield');
        const actionTextEl = document.getElementById('compare-mortgage-action-text');
        
        if (extraYield > 0) {
            yieldEl.textContent = '+' + Math.round(extraYield).toLocaleString('sv-SE') + ' kr/år';
            yieldEl.className = 'stat-value positive';
            actionTextEl.innerHTML = `
                Genom att flytta ditt bolån från <strong>${currentBank.name}</strong> (snittränta ${currentBank.avgRate.toFixed(2)}%) till <strong>${bestBank.name}</strong> (snittränta ${bestBank.avgRate.toFixed(2)}%) kan du <strong>spara ${Math.round(extraYield).toLocaleString('sv-SE')} kr varje år</strong> (räknat efter 30% ränteavdrag).
            `;
        } else {
            yieldEl.textContent = 'Din valda bank är bäst';
            yieldEl.className = 'stat-value';
            actionTextEl.innerHTML = `Du har redan angett banken med lägst snittränta på denna bindningstid. Bra jobbat!`;
        }
        
        // Render table
        this.renderCompareMortgageTable(currentBank.id, capital, relevantAccounts);
    },
    
    renderCompareMortgageTable(currentBankId, capital, relevantAccounts) {
        const container = document.getElementById('compare-mortgage-table-container');
        
        // Sort lowest avgRate first
        const sorted = [...relevantAccounts].sort((a, b) => a.avgRate - b.avgRate);
        
        let html = `
            <table class="data-table" style="width:100%; text-align:left;">
                <thead>
                    <tr>
                        <th style="padding-bottom:8px">Aktör</th>
                        <th style="padding-bottom:8px">Listränta</th>
                        <th style="padding-bottom:8px">Snittränta</th>
                        <th style="padding-bottom:8px; text-align:right">Sparar/År</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        const currentBank = relevantAccounts.find(a => a.id === currentBankId);
        const currentCostAfterDeduction = capital * (currentBank.avgRate / 100) * 0.7;

        for (const bank of sorted) {
            const isCurrent = bank.id === currentBankId;
            const costAfterDeduction = capital * (bank.avgRate / 100) * 0.7;
            const extra = currentCostAfterDeduction - costAfterDeduction;
            
            let extraStr = '—';
            let color = 'var(--text-muted)';
            if (extra > 0) {
                extraStr = '+' + Math.round(extra).toLocaleString('sv-SE') + ' kr';
                color = 'var(--positive)';
            } else if (extra < 0) {
                extraStr = Math.round(extra).toLocaleString('sv-SE') + ' kr';
                color = 'var(--negative)';
            } else {
                extraStr = 'Din valda bank';
            }

            html += `
                <tr style="${isCurrent ? 'background:var(--bg-panel-hover)' : ''}">
                    <td style="padding:10px 4px; border-bottom:1px solid var(--border-highlight);">
                        <span style="font-weight:600; color:var(--text-primary)">${bank.name}</span>
                        ${isCurrent ? '<span style="font-size:9px; margin-left:6px; background:var(--border-highlight); padding:2px 4px; border-radius:3px">VALD</span>' : ''}
                    </td>
                    <td style="padding:10px 4px; border-bottom:1px solid var(--border-highlight); font-weight:400; color:var(--text-muted)">
                        <span style="text-decoration: line-through; opacity:0.8">${bank.listRate.toFixed(2)}%</span>
                    </td>
                    <td style="padding:10px 4px; border-bottom:1px solid var(--border-highlight); font-weight:700; color:var(--accent)">
                        ${bank.avgRate.toFixed(2)}%
                    </td>
                    <td style="padding:10px 4px; border-bottom:1px solid var(--border-highlight); text-align:right; font-weight:600; color:${color}">
                        ${extraStr}
                    </td>
                </tr>
            `;
        }
        
        html += `</tbody></table>`;
        container.innerHTML = html;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
