export function createRecruiterResumeFormData(files, includeOriginalFiles) {
  const data = new FormData()
  if (includeOriginalFiles) files.forEach((file) => data.append('resumes', file))
  return data
}

export async function postRecruiterResumeRetry(api, analysisId, files, includeOriginalFiles) {
  const body = createRecruiterResumeFormData(files, includeOriginalFiles)
  return api(`/analysis/recruiter/analyses/${analysisId}/resume`, { method: 'POST', body })
}

export async function restoreRecruiterAnalysis(api, storage) {
  const analysisId = storage.getItem('talentlens_recruitment_analysis_id')
  if (!analysisId) return null
  return api(`/analysis/recruiter/analyses/${analysisId}`)
}
