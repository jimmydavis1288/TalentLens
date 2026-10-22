function RecruitmentRetryActions({ candidates, files, loading, onRetry }) {
  const canResumeFromSavedText = candidates.some((candidate) => candidate.canResume)
  const hasIncompleteCandidates = candidates.some((candidate) => candidate.status !== 'completed')
  if (!hasIncompleteCandidates) return null

  return <div className="mt-5 flex flex-wrap gap-3">
    <button type="button" onClick={() => onRetry(false)} disabled={loading || !canResumeFromSavedText} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">{loading ? 'Retrying saved text…' : 'Resume from saved extracted text'}</button>
    {files.length ? <button type="button" onClick={() => onRetry(true)} disabled={loading} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">{loading ? 'Retrying with selected files…' : 'Retry with selected original files'}</button> : null}
  </div>
}

export default RecruitmentRetryActions
