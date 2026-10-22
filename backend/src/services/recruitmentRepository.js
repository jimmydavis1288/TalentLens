export async function findOwnedRecruitmentAnalysis(Analysis, analysisId, ownerId) {
  return Analysis.findOne({ _id: analysisId, ownerId })
}

export async function claimRecruitmentCandidate(Analysis, { analysisId, ownerId, candidateId, leaseId, now = new Date(), staleMs = 5 * 60 * 1000 }) {
  const staleBefore = new Date(now.getTime() - staleMs)
  return Analysis.updateOne({
    _id: analysisId,
    ownerId,
    candidates: { $elemMatch: { candidateId, $or: [
      { status: { $in: ['pending', 'failed', 'blocked'] } },
      { status: 'processing', leaseExpiresAt: { $lte: now } },
      { status: 'processing', leaseExpiresAt: null, updatedAt: { $lte: staleBefore } },
    ] } },
  }, { $set: {
    'candidates.$.status': 'processing',
    'candidates.$.leaseId': leaseId,
    'candidates.$.leaseExpiresAt': new Date(now.getTime() + staleMs),
    'candidates.$.updatedAt': now,
    status: 'processing',
  } })
}

export async function compareAndSetRecruiterScoring(Analysis, { analysisId, ownerId, version, weights, candidates, shortlistCriteria }) {
  const set = { weights, candidates }
  if (shortlistCriteria) set.shortlistCriteria = shortlistCriteria
  return Analysis.updateOne(
    { _id: analysisId, ownerId, __v: version, candidates: { $not: { $elemMatch: { status: { $in: ['pending', 'processing'] } } } } },
    { $set: set, $inc: { __v: 1 } },
  )
}

export async function blockPendingRecruitmentCandidates(Analysis, { analysisId, ownerId, updatedAt = new Date() }) {
  return Analysis.updateMany(
    { _id: analysisId, ownerId, 'candidates.status': 'pending' },
    { $set: { 'candidates.$[candidate].status': 'blocked', 'candidates.$[candidate].errorCategory': 'quota_exhausted', 'candidates.$[candidate].updatedAt': updatedAt } },
    { arrayFilters: [{ 'candidate.status': 'pending' }] },
  )
}
