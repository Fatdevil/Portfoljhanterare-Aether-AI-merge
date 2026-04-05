/**
 * charts.js — Chart.js configurations for the portfolio optimizer
 */

const Charts = {
    instances: {},
    isDark: true,

    /* ── Color helpers ─────────────────────────────────────────────────── */
    colors() {
        return {
            bg: this.isDark ? '#000000' : '#f5f5f5',
            panel: this.isDark ? '#0d0d0d' : '#ffffff',
            text: this.isDark ? '#e0e0e0' : '#1a1a1a',
            textMuted: this.isDark ? '#666666' : '#999999',
            grid: this.isDark ? '#1a1a1a' : '#e8e8e8',
            frontierLine: this.isDark ? '#00e5ff' : '#0066cc',
            frontierFill: this.isDark ? 'rgba(0,229,255,0.08)' : 'rgba(0,102,204,0.06)',
            cloud: this.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.06)',
            cml: this.isDark ? 'rgba(255,215,0,0.5)' : 'rgba(180,150,0,0.5)',
            userDot: '#ff3366',
            targetDot: '#00ff41',
            tangent: '#ffd700',
            minVar: '#00e5ff',
            iskLine: '#00e5ff',
            depaLine: '#ff6633',
        };
    },

    /* ── Chart defaults ─────────────────────────────────────────────── */
    setDefaults() {
        const c = this.colors();
        Chart.defaults.color = c.text;
        Chart.defaults.font.family = "'JetBrains Mono', 'Consolas', monospace";
        Chart.defaults.font.size = 11;
        Chart.defaults.plugins.legend.labels.usePointStyle = true;
        Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
    },

    /* ── Efficient Frontier Chart ───────────────────────────────────── */
    createFrontierChart(canvasId) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        const c = this.colors();

        if (this.instances.frontier) this.instances.frontier.destroy();

        this.instances.frontier = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Slumpmässiga Portföljer',
                        data: [],
                        backgroundColor: c.cloud,
                        pointRadius: 1.5,
                        pointHoverRadius: 3,
                        order: 10,
                    },
                    {
                        label: 'Effektiva Fronten',
                        data: [],
                        borderColor: c.frontierLine,
                        backgroundColor: c.frontierFill,
                        pointRadius: 0,
                        borderWidth: 2.5,
                        showLine: true,
                        fill: false,
                        tension: 0.4,
                        order: 5,
                    },
                    {
                        label: 'Kapitalmarknadslinjen',
                        data: [],
                        borderColor: c.cml,
                        borderDash: [6, 4],
                        pointRadius: 0,
                        borderWidth: 1.5,
                        showLine: true,
                        fill: false,
                        order: 6,
                    },
                    {
                        label: 'Tangentportfölj',
                        data: [],
                        backgroundColor: c.tangent,
                        borderColor: c.tangent,
                        pointRadius: 8,
                        pointStyle: 'star',
                        order: 2,
                    },
                    {
                        label: 'Min-Varians',
                        data: [],
                        backgroundColor: c.minVar,
                        borderColor: c.minVar,
                        pointRadius: 7,
                        pointStyle: 'triangle',
                        order: 2,
                    },
                    // Bank datasets added dynamically (indices 5+)
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'nearest',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'start',
                        labels: {
                            padding: 12,
                            font: { size: 10 },
                            filter: (item) => item.text !== 'Slumpmässiga Portföljer',
                        },
                    },
                    tooltip: {
                        backgroundColor: this.isDark ? '#1a1a2e' : '#ffffff',
                        titleColor: this.isDark ? '#e0e0e0' : '#1a1a1a',
                        bodyColor: this.isDark ? '#b0b0b0' : '#444444',
                        borderColor: this.isDark ? '#333' : '#ddd',
                        borderWidth: 1,
                        padding: 10,
                        titleFont: { family: "'JetBrains Mono', monospace", size: 11, weight: 'bold' },
                        bodyFont: { family: "'JetBrains Mono', monospace", size: 10 },
                        callbacks: {
                            title: (ctx) => ctx[0]?.dataset?.label || '',
                            label: (ctx) => {
                                const x = ctx.parsed.x;
                                const y = ctx.parsed.y;
                                return ` Risk: ${x.toFixed(1)}%  |  Avk: ${y.toFixed(1)}%`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'RISK (Standardavvikelse %)',
                            font: { size: 11, weight: 'bold' },
                            color: c.textMuted,
                        },
                        grid: { color: c.grid, lineWidth: 0.5 },
                        ticks: { font: { size: 10 } },
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'FÖRVÄNTAD AVKASTNING (%)',
                            font: { size: 11, weight: 'bold' },
                            color: c.textMuted,
                        },
                        grid: { color: c.grid, lineWidth: 0.5 },
                        ticks: { font: { size: 10 } },
                    },
                },
            },
        });

        return this.instances.frontier;
    },

    /**
     * Create a perfectly smooth display curve from noisy frontier points.
     * Fits: return = a*√risk + b*risk + c (captures the concave Markowitz shape)
     * Then ensures the curve is above all data points by using upper-envelope fitting.
     */
    smoothFrontierForDisplay(rawFrontier) {
        if (!rawFrontier || rawFrontier.length < 3) {
            return rawFrontier.map(p => ({ x: +(p.risk * 100).toFixed(2), y: +(p.return * 100).toFixed(2) }));
        }

        // Use percentage space
        const xs = rawFrontier.map(p => p.risk * 100);
        const ys = rawFrontier.map(p => p.return * 100);

        // Only use the TOP points (upper envelope) for fitting
        // For each risk bucket, keep only the highest return
        const bucketSize = 0.5; // 0.5% risk buckets
        const buckets = new Map();
        for (let i = 0; i < xs.length; i++) {
            const key = Math.round(xs[i] / bucketSize);
            if (!buckets.has(key) || ys[i] > buckets.get(key).y) {
                buckets.set(key, { x: xs[i], y: ys[i] });
            }
        }
        const topPoints = [...buckets.values()].sort((a, b) => a.x - b.x);
        const txs = topPoints.map(p => p.x);
        const tys = topPoints.map(p => p.y);
        const n = txs.length;

        // Fit: y = a*√x + b*x + c via least squares
        // Variables: u = √x, v = x
        let su = 0, sv = 0, su2 = 0, sv2 = 0, suv = 0;
        let sy = 0, suy = 0, svy = 0;
        for (let i = 0; i < n; i++) {
            const u = Math.sqrt(Math.max(txs[i], 0.01));
            const v = txs[i];
            const y = tys[i];
            su += u; sv += v; su2 += u*u; sv2 += v*v; suv += u*v;
            sy += y; suy += u*y; svy += v*y;
        }

        // Solve 3x3: [su2  suv  su ] [a]   [suy]
        //             [suv  sv2  sv ] [b] = [svy]
        //             [su   sv   n  ] [c]   [sy ]
        const M = [
            [su2, suv, su, suy],
            [suv, sv2, sv, svy],
            [su,  sv,  n,  sy]
        ];

        // Gaussian elimination with partial pivoting
        for (let col = 0; col < 3; col++) {
            let maxRow = col;
            for (let row = col + 1; row < 3; row++) {
                if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
            }
            [M[col], M[maxRow]] = [M[maxRow], M[col]];
            for (let row = col + 1; row < 3; row++) {
                const factor = M[row][col] / M[col][col];
                for (let j = col; j <= 3; j++) M[row][j] -= factor * M[col][j];
            }
        }

        const c = M[2][3] / M[2][2];
        const b = (M[1][3] - M[1][2] * c) / M[1][1];
        const a = (M[0][3] - M[0][2] * c - M[0][1] * b) / M[0][0];

        // Generate smooth curve across full risk range
        const minRisk = Math.min(...xs);
        const maxRisk = Math.max(...xs);
        const numSamples = 50;
        const curve = [];

        for (let i = 0; i < numSamples; i++) {
            const x = minRisk + (maxRisk - minRisk) * (i / (numSamples - 1));
            const y = a * Math.sqrt(Math.max(x, 0.01)) + b * x + c;
            curve.push({ x: +x.toFixed(2), y: +y.toFixed(2) });
        }

        // Lift the curve so it's always ABOVE all frontier data points
        // Find the max positive residual (data above curve)
        let maxLift = 0;
        for (let i = 0; i < xs.length; i++) {
            const fittedY = a * Math.sqrt(Math.max(xs[i], 0.01)) + b * xs[i] + c;
            const residual = ys[i] - fittedY;
            if (residual > maxLift) maxLift = residual;
        }
        // Shift entire curve up by this amount + small margin
        if (maxLift > 0) {
            const lift = maxLift + 0.15;
            for (const pt of curve) {
                pt.y = +(pt.y + lift).toFixed(2);
            }
        }

        // Ensure monotonicity
        for (let i = 1; i < curve.length; i++) {
            if (curve[i].y < curve[i - 1].y) {
                curve[i].y = curve[i - 1].y;
            }
        }

        return curve;
    },

    /**
     * Update the frontier chart with computed data
     */
    updateFrontierChart(data) {
        const chart = this.instances.frontier;
        if (!chart) return;
        const c = this.colors();

        const isMarkowitz = data.engine === 'markowitz';

        // Dataset 0: Random cloud
        if (isMarkowitz && data.randomPortfolios) {
            chart.data.datasets[0].data = data.randomPortfolios.map(p => ({
                x: +(p.risk * 100).toFixed(2),
                y: +(p.return * 100).toFixed(2),
            }));
            chart.data.datasets[0].backgroundColor = c.cloud;
        } else {
            chart.data.datasets[0].data = [];
        }

        // Dataset 1: Efficient frontier line — spline-smoothed for display
        if (isMarkowitz && data.frontier) {
            const rawFrontier = data.frontier.sort((a, b) => a.risk - b.risk);
            const frontierData = this.smoothFrontierForDisplay(rawFrontier);
            chart.data.datasets[1].data = frontierData;
            chart.data.datasets[1].borderColor = c.frontierLine;
            chart.data.datasets[1].backgroundColor = c.frontierFill;
            chart.data.datasets[1].cubicInterpolationMode = 'monotone';
        } else {
            chart.data.datasets[1].data = [];
        }

        // Dataset 2: Capital Market Line
        if (isMarkowitz && data.tangent) {
            const rf = RISK_FREE_RATE * 100;
            const tx = data.tangent.risk * 100;
            const ty = data.tangent.return * 100;
            const slope = (ty - rf) / tx;
            const maxRisk = Math.max(...(chart.data.datasets[1].data.length ? chart.data.datasets[1].data : [{x:20}]).map(p => p.x)) * 1.2;
            chart.data.datasets[2].data = [
                { x: 0, y: rf },
                { x: maxRisk, y: rf + slope * maxRisk },
            ];
            chart.data.datasets[2].borderColor = c.cml;
        } else {
            chart.data.datasets[2].data = [];
        }

        // Dataset 3: Tangent portfolio
        if (isMarkowitz && data.tangent) {
            chart.data.datasets[3].data = [{ x: +(data.tangent.risk * 100).toFixed(2), y: +(data.tangent.return * 100).toFixed(2) }];
            chart.data.datasets[3].backgroundColor = c.tangent;
            chart.data.datasets[3].borderColor = c.tangent;
        } else {
            chart.data.datasets[3].data = [];
        }

        // Dataset 4: Min variance
        if (isMarkowitz && data.minVar) {
            chart.data.datasets[4].data = [{ x: +(data.minVar.risk * 100).toFixed(2), y: +(data.minVar.return * 100).toFixed(2) }];
            chart.data.datasets[4].backgroundColor = c.minVar;
            chart.data.datasets[4].borderColor = c.minVar;
        } else {
             chart.data.datasets[4].data = [];
        }

        // Remove old bank datasets
        while (chart.data.datasets.length > 5) {
            chart.data.datasets.pop();
        }

        // Add bank portfolio datasets
        if (data.bankPoints) {
            for (const bp of data.bankPoints) {
                chart.data.datasets.push({
                    label: bp.label,
                    data: [{ x: +(bp.risk * 100).toFixed(2), y: +(bp.return * 100).toFixed(2) }],
                    backgroundColor: bp.color,
                    borderColor: bp.borderColor || bp.color,
                    borderWidth: 2,
                    pointRadius: 7,
                    pointHoverRadius: 9,
                    pointStyle: bp.style || 'rectRounded',
                    order: 3,
                });
            }
        }

        // Add user portfolio if present
        if (data.userPortfolio) {
            chart.data.datasets.push({
                label: 'Din Portfölj',
                data: [{ x: +(data.userPortfolio.risk * 100).toFixed(2), y: +(data.userPortfolio.return * 100).toFixed(2) }],
                backgroundColor: c.userDot,
                borderColor: '#ffffff',
                borderWidth: 2,
                pointRadius: 10,
                pointHoverRadius: 12,
                pointStyle: 'crossRot',
                order: 1,
            });
        }

        // Add target portfolio if present
        if (data.targetPortfolio) {
            chart.data.datasets.push({
                label: 'Optimalt Mål',
                data: [{ x: +(data.targetPortfolio.risk * 100).toFixed(2), y: +(data.targetPortfolio.return * 100).toFixed(2) }],
                backgroundColor: c.targetDot,
                borderColor: '#ffffff',
                borderWidth: 2,
                pointRadius: 10,
                pointHoverRadius: 12,
                pointStyle: 'rectRot',
                order: 1,
            });

            // Draw arrow line from user to target
            if (data.userPortfolio) {
                chart.data.datasets.push({
                    label: 'Rebalansering',
                    data: [
                        { x: +(data.userPortfolio.risk * 100).toFixed(2), y: +(data.userPortfolio.return * 100).toFixed(2) },
                        { x: +(data.targetPortfolio.risk * 100).toFixed(2), y: +(data.targetPortfolio.return * 100).toFixed(2) },
                    ],
                    borderColor: 'rgba(255,255,255,0.4)',
                    borderDash: [4, 4],
                    borderWidth: 1.5,
                    pointRadius: 0,
                    showLine: true,
                    fill: false,
                    order: 4,
                });
            }
        }

        // HRP Visualization: Add raw asset classes as "Clusters"
        if (!isMarkowitz && data.assetData) {
            const { expectedReturns, covMatrix } = data.assetData;
            // NOTE: ASSET_CLASSES is imported from data.js
            for (let i = 0; i < 10; i++) { 
                const r = expectedReturns[i];
                const vol = Math.sqrt(covMatrix[i][i]);
                const ac = ASSET_CLASSES && ASSET_CLASSES[i] ? ASSET_CLASSES[i] : {name: 'Asset ' + i, color: '#999'};
                
                chart.data.datasets.push({
                    label: `Kluster: ${ac.name}`,
                    data: [{ x: +(vol * 100).toFixed(2), y: +(r * 100).toFixed(2) }],
                    backgroundColor: ac.color + '60', // semi-transparent
                    borderColor: ac.color,
                    borderWidth: 2,
                    pointRadius: 24, // extra large bubble
                    pointHoverRadius: 26,
                    pointStyle: 'circle',
                    order: 8,
                });
            }
        }

        chart.update('none');
    },

    /* ── Allocation Bar Chart ───────────────────────────────────────── */
    createAllocationChart(canvasId) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        const c = this.colors();

        if (this.instances.allocation) this.instances.allocation.destroy();

        this.instances.allocation = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: { font: { size: 9 }, padding: 8 },
                    },
                    tooltip: {
                        backgroundColor: this.isDark ? '#1a1a2e' : '#ffffff',
                        titleColor: this.isDark ? '#e0e0e0' : '#1a1a1a',
                        bodyColor: this.isDark ? '#b0b0b0' : '#444',
                        borderColor: this.isDark ? '#333' : '#ddd',
                        borderWidth: 1,
                        callbacks: {
                            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%`,
                        },
                    },
                },
                scales: {
                    x: {
                        stacked: true,
                        max: 100,
                        grid: { color: c.grid, lineWidth: 0.5 },
                        ticks: { font: { size: 10 }, callback: v => v + '%' },
                    },
                    y: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { font: { size: 10 } },
                    },
                },
            },
        });

        return this.instances.allocation;
    },

    updateAllocationChart(portfolios) {
        const chart = this.instances.allocation;
        if (!chart) return;

        chart.data.labels = portfolios.map(p => p.label);
        chart.data.datasets = ASSET_CLASSES.map((ac, i) => ({
            label: ac.name,
            data: portfolios.map(p => +(p.weights[i] * 100).toFixed(1)),
            backgroundColor: ac.color + (this.isDark ? 'cc' : '99'),
            borderWidth: 0,
            barPercentage: 0.8,
        }));

        chart.update('none');
    },

    /* ── Tax Simulation Chart ───────────────────────────────────────── */
    createTaxChart(canvasId) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        const c = this.colors();

        if (this.instances.tax) this.instances.tax.destroy();

        this.instances.tax = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'ISK',
                        data: [],
                        borderColor: c.iskLine,
                        backgroundColor: c.iskLine + '15',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.0,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                    },
                    {
                        label: 'Depå (Normal)',
                        data: [],
                        borderColor: c.depaLine,
                        backgroundColor: c.depaLine + '15',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.0,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end',
                        labels: { font: { size: 10 }, padding: 12 },
                    },
                    tooltip: {
                        backgroundColor: this.isDark ? '#1a1a2e' : '#ffffff',
                        titleColor: this.isDark ? '#e0e0e0' : '#1a1a1a',
                        bodyColor: this.isDark ? '#b0b0b0' : '#444',
                        borderColor: this.isDark ? '#333' : '#ddd',
                        borderWidth: 1,
                        callbacks: {
                            label: (ctx) => ` ${ctx.dataset.label}: ${TaxEngine.formatSEK(ctx.raw)}`,
                        },
                    },
                },
                scales: {
                    x: {
                        title: { display: true, text: 'ÅR', font: { size: 10 }, color: c.textMuted },
                        grid: { color: c.grid, lineWidth: 0.5 },
                        ticks: { font: { size: 10 } },
                    },
                    y: {
                        title: { display: true, text: 'PORTFÖLJVÄRDE (SEK)', font: { size: 10 }, color: c.textMuted },
                        grid: { color: c.grid, lineWidth: 0.5 },
                        ticks: {
                            font: { size: 10 },
                            callback: v => {
                                if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
                                if (v >= 1e3) return (v / 1e3).toFixed(0) + 'k';
                                return v;
                            },
                        },
                    },
                },
            },
        });

        return this.instances.tax;
    },

    updateTaxChart(simData) {
        const chart = this.instances.tax;
        if (!chart) return;
        const c = this.colors();

        chart.data.labels = simData.years.map(y => `År ${y}`);
        chart.data.datasets[0].data = simData.isk.values;
        chart.data.datasets[0].borderColor = c.iskLine;
        chart.data.datasets[0].backgroundColor = c.iskLine + '15';
        chart.data.datasets[1].data = simData.depa.values;
        chart.data.datasets[1].borderColor = c.depaLine;
        chart.data.datasets[1].backgroundColor = c.depaLine + '15';

        chart.update('none');
    },

    /* ── Update theme on all charts ─────────────────────────────────── */
    updateTheme(dark) {
        this.isDark = dark;
        this.setDefaults();

        // Rebuild all charts with new theme
        for (const key of Object.keys(this.instances)) {
            if (this.instances[key]) {
                const c = this.colors();
                const chart = this.instances[key];

                if (chart.options.scales?.x) {
                    chart.options.scales.x.grid.color = c.grid;
                    if (chart.options.scales.x.title) chart.options.scales.x.title.color = c.textMuted;
                }
                if (chart.options.scales?.y) {
                    chart.options.scales.y.grid.color = c.grid;
                    if (chart.options.scales.y.title) chart.options.scales.y.title.color = c.textMuted;
                }

                chart.update('none');
            }
        }
    },
};
