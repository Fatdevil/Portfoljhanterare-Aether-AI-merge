/**
 * matrix.js — Lightweight linear-algebra utilities for portfolio optimization
 * All matrices stored as 2D arrays: matrix[row][col]
 */

const Matrix = {
    /* ── Creation ──────────────────────────────────────────────────────── */
    zeros(r, c) {
        return Array.from({ length: r }, () => new Array(c).fill(0));
    },

    identity(n) {
        const I = this.zeros(n, n);
        for (let i = 0; i < n; i++) I[i][i] = 1;
        return I;
    },

    /* ── Basic ops ─────────────────────────────────────────────────────── */
    transpose(A) {
        const r = A.length, c = A[0].length;
        const T = this.zeros(c, r);
        for (let i = 0; i < r; i++)
            for (let j = 0; j < c; j++)
                T[j][i] = A[i][j];
        return T;
    },

    multiply(A, B) {
        const rA = A.length, cA = A[0].length;
        const cB = B[0].length;
        const C = this.zeros(rA, cB);
        for (let i = 0; i < rA; i++)
            for (let j = 0; j < cB; j++)
                for (let k = 0; k < cA; k++)
                    C[i][j] += A[i][k] * B[k][j];
        return C;
    },

    /** Multiply matrix A by column-vector v → returns column-vector */
    multiplyVec(A, v) {
        const n = A.length;
        const res = new Array(n).fill(0);
        for (let i = 0; i < n; i++)
            for (let j = 0; j < v.length; j++)
                res[i] += A[i][j] * v[j];
        return res;
    },

    add(A, B) {
        return A.map((row, i) => row.map((val, j) => val + B[i][j]));
    },

    scale(A, s) {
        return A.map(row => row.map(v => v * s));
    },

    /* ── Vector ops ────────────────────────────────────────────────────── */
    dot(a, b) {
        let s = 0;
        for (let i = 0; i < a.length; i++) s += a[i] * b[i];
        return s;
    },

    vecAdd(a, b) {
        return a.map((v, i) => v + b[i]);
    },

    vecSub(a, b) {
        return a.map((v, i) => v - b[i]);
    },

    vecScale(a, s) {
        return a.map(v => v * s);
    },

    /* ── Matrix inverse (Gauss-Jordan elimination) ─────────────────── */
    inverse(M) {
        const n = M.length;
        // Build augmented matrix [M | I]
        const aug = M.map((row, i) => {
            const ext = new Array(n).fill(0);
            ext[i] = 1;
            return [...row.map(v => v), ...ext];
        });

        for (let col = 0; col < n; col++) {
            // Partial pivoting
            let maxRow = col;
            for (let row = col + 1; row < n; row++) {
                if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col]))
                    maxRow = row;
            }
            [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

            const pivot = aug[col][col];
            if (Math.abs(pivot) < 1e-12) {
                // Singular — add small regularization and retry
                return this.inverse(M.map((row, i) =>
                    row.map((v, j) => v + (i === j ? 1e-8 : 0))
                ));
            }

            // Scale pivot row
            for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;

            // Eliminate column
            for (let row = 0; row < n; row++) {
                if (row === col) continue;
                const factor = aug[row][col];
                for (let j = 0; j < 2 * n; j++)
                    aug[row][j] -= factor * aug[col][j];
            }
        }

        // Extract inverse
        return aug.map(row => row.slice(n));
    },

    /* ── Covariance matrix from return series ──────────────────────── */
    /**
     * @param {number[][]} returns  — each row: asset, each col: time period
     * returns annualized cov-matrix (multiply by 12 for monthly data)
     */
    covarianceMatrix(returns, annualize = 12) {
        const n = returns.length;       // number of assets
        const T = returns[0].length;    // number of periods

        // Means
        const means = returns.map(r => r.reduce((s, v) => s + v, 0) / T);

        const cov = this.zeros(n, n);
        for (let i = 0; i < n; i++) {
            for (let j = i; j < n; j++) {
                let s = 0;
                for (let t = 0; t < T; t++)
                    s += (returns[i][t] - means[i]) * (returns[j][t] - means[j]);
                cov[i][j] = cov[j][i] = (s / (T - 1)) * annualize;
            }
        }
        return cov;
    },

    /** Convert correlation matrix + volatility vector → covariance matrix */
    corrToCov(corrMatrix, vols) {
        const n = vols.length;
        const cov = this.zeros(n, n);
        for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++)
                cov[i][j] = corrMatrix[i][j] * vols[i] * vols[j];
        return cov;
    },
};
