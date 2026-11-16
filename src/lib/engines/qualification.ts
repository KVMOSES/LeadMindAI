import type {
  PredictionResult,
  QualificationCategory,
  QualificationResult,
  QualificationThresholds,
} from '@/lib/types'

export interface QualificationInput {
  fit: number | null
  intent: number | null
  prediction: PredictionResult | null
  dataCompleteness: number // 0..1
  thresholds: QualificationThresholds
}

/**
 * Lead qualification engine. Combines four independent inputs:
 * customer fit, buying intent, conversion prediction availability and
 * data quality. Every classification returns explicit reasons.
 */
export function computeQualification(input: QualificationInput): QualificationResult {
  const { fit, intent, prediction, dataCompleteness, thresholds: t } = input
  const reasons: string[] = []
  let category: QualificationCategory

  const fitKnown = fit !== null
  const intentKnown = intent !== null

  if (dataCompleteness < t.lowQualityFloor) {
    category = 'MANUAL_REVIEW'
    reasons.push(
      `Data quality below floor: ${(dataCompleteness * 100).toFixed(0)}% of required fields present ` +
        `(threshold ${(t.lowQualityFloor * 100).toFixed(0)}%). Automated classification is unreliable.`,
    )
    if (!fitKnown) reasons.push('Customer fit not yet calculated.')
    return { category, reasons, version: 'rules-v1' }
  }

  const fitV = fit ?? 0
  const intentV = intent ?? 0

  if (!fitKnown) {
    reasons.push('Customer fit has not been calculated yet — run the assessment first.')
    category = 'MANUAL_REVIEW'
    return { category, reasons, version: 'rules-v1' }
  }

  if (!intentKnown) {
    reasons.push(
      `Buying intent is unknown (no engagement events). Intent is treated as unknown, not zero.`,
    )
    if (fitV >= t.nurtureFit) {
      category = 'NURTURE_TRACK'
      reasons.push(
        `Fit ${fitV.toFixed(0)} ≥ nurture floor ${t.nurtureFit}, so the lead is placed on the nurture track pending engagement data.`,
      )
    } else if (fitV >= t.keepWarmFit) {
      category = 'KEEP_WARM'
      reasons.push(`Fit ${fitV.toFixed(0)} is moderate (${t.keepWarmFit}-${t.nurtureFit}); kept warm with unknown intent.`)
    } else {
      category = 'MANUAL_REVIEW'
      reasons.push(`Fit ${fitV.toFixed(0)} below keep-warm floor ${t.keepWarmFit}; review manually.`)
    }
    return { category, reasons, version: 'rules-v1' }
  }

  const prob = prediction ? prediction.probability : null

  if (fitV >= t.salesReadyFit && intentV >= t.salesReadyIntent) {
    if (prob === null) {
      category = 'SALES_READY'
      reasons.push(
        `Fit ${fitV.toFixed(0)} ≥ sales-ready fit threshold ${t.salesReadyFit} and intent ${intentV.toFixed(0)} ≥ ${t.salesReadyIntent}.`,
      )
      reasons.push('No valid conversion model is available, so classification relies on fit and intent thresholds only.')
    } else if (prob >= t.salesReadyProbability) {
      category = 'SALES_READY'
      reasons.push(
        `Fit ${fitV.toFixed(0)} ≥ ${t.salesReadyFit}; intent ${intentV.toFixed(0)} ≥ ${t.salesReadyIntent}; ` +
          `model conversion probability ${(prob * 100).toFixed(0)}% ≥ ${(t.salesReadyProbability * 100).toFixed(0)}%.`,
      )
    } else {
      category = 'MANUAL_REVIEW'
      reasons.push(
        `Conflict: fit and intent exceed sales-ready thresholds but the model predicts only ${(prob * 100).toFixed(0)}% ` +
          `conversion probability (< ${(t.salesReadyProbability * 100).toFixed(0)}%). A human should arbitrate.`,
      )
    }
  } else if (fitV >= t.nurtureFit) {
    category = 'NURTURE_TRACK'
    reasons.push(
      `Fit ${fitV.toFixed(0)} ≥ nurture floor ${t.nurtureFit} but intent ${intentV.toFixed(0)} < sales-ready intent ${t.salesReadyIntent}.`,
    )
    if (prob !== null) {
      reasons.push(`Model conversion probability: ${(prob * 100).toFixed(0)}%.`)
    }
  } else if (fitV >= t.keepWarmFit) {
    category = 'KEEP_WARM'
    reasons.push(
      `Fit ${fitV.toFixed(0)} is moderate (${t.keepWarmFit}-${t.nurtureFit}) with intent ${intentV.toFixed(0)}; keep warm and monitor.`,
    )
  } else {
    category = 'MANUAL_REVIEW'
    reasons.push(
      `Fit ${fitV.toFixed(0)} below keep-warm floor ${t.keepWarmFit}; the lead does not match the ICP closely enough for automated handling.`,
    )
  }

  return { category, reasons, version: 'rules-v1' }
}
