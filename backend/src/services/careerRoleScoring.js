import { boundedScore } from './scoreContract.js'

export function scoreCareerRoles(matches = [], analysis = {}) {
  return matches.flatMap((match, index) => {
    const structuredScore = boundedScore(match?.score)
    if (structuredScore === null) return []
    const semanticScore = analysis.semanticScores?.[index]
    const hasContext = typeof semanticScore === 'number' && Number.isFinite(semanticScore) && semanticScore >= 0 && semanticScore <= 100
    const score = boundedScore(structuredScore + (hasContext ? semanticScore * 0.3 : 0))
    if (score === null) return []
    return [{
      title: match.role.title,
      score,
      matchingMethod: hasContext ? 'structured-plus-contextual' : 'structured-skills',
      reason: hasContext ? 'Structured skill overlap combined with contextual relevance.' : 'Based on structured skill overlap only.',
    }]
  })
}