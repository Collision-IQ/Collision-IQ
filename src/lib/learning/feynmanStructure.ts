/**
 * Collision Learning Engine — pure Feynman-structure check (no server
 * imports). feynmanEvaluator.ts applies it to remediation attempts.
 */

export type FeynmanStructureCheck = {
  hasOwnerLevel: boolean;
  hasEstimatorLevel: boolean;
  hasExpertLevel: boolean;
  hasFalsifiability: boolean;
  complete: boolean;
};

export function checkFeynmanStructure(text: string): FeynmanStructureCheck {
  const hasOwnerLevel = /##\s*vehicle owner/i.test(text);
  const hasEstimatorLevel = /##\s*estimator (?:or|\/)\s*technician/i.test(text);
  const hasExpertLevel = /##\s*expert reviewer/i.test(text);
  const hasFalsifiability = /prove (?:this|the) (?:explanation|answer) wrong|would prove .* wrong/i.test(text);
  return {
    hasOwnerLevel,
    hasEstimatorLevel,
    hasExpertLevel,
    hasFalsifiability,
    complete: hasOwnerLevel && hasEstimatorLevel && hasExpertLevel,
  };
}
