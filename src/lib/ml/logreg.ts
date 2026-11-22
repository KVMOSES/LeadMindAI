/**
 * Logistic Regression trained with batch gradient descent and L2 regularization.
 * Feature standardization is learned on training data and stored with the model.
 */
export interface Standardizer {
  means: number[]
  stds: number[]
}

export interface LogRegModel {
  weights: number[]
  intercept: number
  standardizer: Standardizer
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))))

export function standardize(X: number[][]): Standardizer {
  const d = X[0].length
  const means = new Array<number>(d).fill(0)
  const stds = new Array<number>(d).fill(0)
  for (const row of X) for (let j = 0; j < d; j++) means[j] += row[j]
  for (let j = 0; j < d; j++) means[j] /= X.length
  for (const row of X) for (let j = 0; j < d; j++) stds[j] += (row[j] - means[j]) ** 2
  for (let j = 0; j < d; j++) stds[j] = Math.sqrt(stds[j] / X.length) || 1
  return { means, stds }
}

export function applyStandardizer(x: number[], s: Standardizer): number[] {
  return x.map((v, j) => (v - s.means[j]) / s.stds[j])
}

export function fitLogReg(
  X: number[][],
  y: number[],
  opts: { lr: number; epochs: number; l2: number },
): LogRegModel {
  const standardizer = standardize(X)
  const Z = X.map((row) => applyStandardizer(row, standardizer))
  const d = Z[0].length
  const weights = new Array<number>(d).fill(0)
  let intercept = 0
  const n = Z.length
  const lr = opts.lr
  for (let epoch = 0; epoch < opts.epochs; epoch++) {
    const grad = new Array<number>(d).fill(0)
    let gradB = 0
    for (let i = 0; i < n; i++) {
      const z = Z[i].reduce((acc, v, j) => acc + v * weights[j], intercept)
      const p = sigmoid(z)
      const err = p - y[i]
      for (let j = 0; j < d; j++) grad[j] += err * Z[i][j]
      gradB += err
    }
    for (let j = 0; j < d; j++) {
      weights[j] -= lr * (grad[j] / n + opts.l2 * weights[j])
    }
    intercept -= lr * (gradB / n)
    // Mild decay to stabilize convergence
    if (epoch % 100 === 99) {
      for (let j = 0; j < d; j++) weights[j] *= 0.999
    }
  }
  return { weights, intercept, standardizer }
}

export function predictLogReg(model: LogRegModel, x: number[]): number {
  const z = applyStandardizer(x, model.standardizer).reduce(
    (acc, v, j) => acc + v * model.weights[j],
    model.intercept,
  )
  return sigmoid(z)
}

/**
 * Exact per-feature contribution to probability (marginal in logit space):
 * dp/dx_j = p(1-p) * w_j * (x_j - mean_j) / std_j
 */
export function logRegContributions(
  model: LogRegModel,
  x: number[],
): { logitContributions: number[]; probContributions: number[] } {
  const z = applyStandardizer(x, model.standardizer)
  const logit = z.reduce((acc, v, j) => acc + v * model.weights[j], model.intercept)
  const p = sigmoid(logit)
  const logitContributions = z.map((v, j) => v * model.weights[j])
  const probContributions = logitContributions.map((c) => c * p * (1 - p))
  return { logitContributions, probContributions }
}
