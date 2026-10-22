import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'
import DashboardShell from '../components/DashboardShell'
import { api } from '../lib/api'
import { postRecruiterResumeRetry, restoreRecruiterAnalysis } from '../lib/recruiterRetry.js'
import { aiErrorMessage } from '../lib/aiError.js'
import RecruitmentResults from '../components/RecruitmentResults.jsx'

function RecruiterDashboard() {
  const [resumes, setResumes] = useState([])
  const [jobDescription, setJobDescription] = useState('')
  const [jobDescriptionFile, setJobDescriptionFile] = useState(null)
  const [jobTitle, setJobTitle] = useState('')
  const [jobDomain, setJobDomain] = useState('')
  const [seniority, setSeniority] = useState('')
  const [experienceRequirement, setExperienceRequirement] = useState('')
  const [jobProfile, setJobProfile] = useState(null)
  const [requirements, setRequirements] = useState([])
  const [requirementSuggestions, setRequirementSuggestions] = useState([])
  const [reviewSkillDraft, setReviewSkillDraft] = useState('')
  const [requirementsReviewed, setRequirementsReviewed] = useState(false)
  const [requirementsMessage, setRequirementsMessage] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingWeights, setSavingWeights] = useState(false)
  const candidateIssue = (category) => ({
    quota_exhausted: 'Gemini quota reached. This candidate is saved; retry after quota availability returns.',
    rate_limited: 'Gemini is rate limiting requests. Retry this candidate shortly.',
    service_unavailable: 'The resume service is temporarily unavailable. Retry with the same files later.',
    invalid_api_key: 'Gemini credentials are invalid. Contact the administrator to update the backend API key.',
    missing_api_key: 'Gemini is not configured. Contact the administrator. A deterministic result is available only when resume evidence is sufficient.',
    database_unavailable: 'The database is temporarily unavailable. Completed candidate results are preserved; retry when the database is available.',
    unreadable_resume: 'No usable text was extracted. Scanned PDFs need OCR, which is not configured.',
    docx_extraction_failed: 'This DOCX could not be read. Save it again as a valid DOCX and retry.',
    source_not_persisted: 'Extracted resume text was not saved before interruption. Reupload this original resume to retry.',
    processing_error: 'The resume could not be processed. Retry with the same file.',
  }[category] || 'This candidate is waiting for processing.')
  const shouldPoll = result?.status === 'processing' || result?.candidates?.some((candidate) => ['pending', 'processing'].includes(candidate.status))

  useEffect(() => {
    let active = true
    restoreRecruiterAnalysis(api, sessionStorage).then((saved) => {
      if (!saved) return
      if (active) setResult({ ...saved, message: 'Restored the latest saved analysis. Completed candidate results are preserved.' })
    }).catch((requestError) => { if (active) setError(aiErrorMessage(requestError)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!result?.id || !shouldPoll) return undefined
    let active = true
    let timer
    const refresh = async () => {
      try {
        const latest = await api(`/analysis/recruiter/analyses/${result.id}`)
        if (active) setResult({ ...latest, message: latest.status === 'completed' ? 'Analysis complete. Review the evidence before making hiring decisions.' : 'Analysis progress updated. Review completed results and any candidates needing attention.' })
        if (active && (latest.status === 'processing' || latest.candidates?.some((candidate) => ['pending', 'processing'].includes(candidate.status)))) timer = setTimeout(refresh, 2000)
      } catch (requestError) { if (active) setError(requestError.message) }
    }
    timer = setTimeout(refresh, 1000)
    return () => { active = false; clearTimeout(timer) }
  }, [result?.id, shouldPoll])

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!requirementsReviewed) {
      if (!jobDescription.trim() && !jobDescriptionFile) { setError('Paste a job description or upload a readable PDF/DOCX.'); return }
      try {
        setLoading(true)
        const form = new FormData()
        if (jobDescription.trim()) form.append('jobDescription', jobDescription)
        if (jobDescriptionFile) form.append('jobDescriptionFile', jobDescriptionFile)
        const proposal = await api('/analysis/recruiter/requirements', { method: 'POST', body: form })
        setJobDescription(proposal.jobDescription || jobDescription)
        setJobProfile(proposal.jobProfile || null)
        const proposedNames = proposal.jobProfile?.requirements?.map((item) => item.name) || proposal.requirements
        setRequirementSuggestions(proposedNames)
        setRequirements([])
        setRequirementsMessage(proposal.message)
        setRequirementsReviewed(true)
      } catch (requestError) { setError(requestError.message) } finally { setLoading(false) }
      return
    }
    if (!requirements.length) { setError('Select at least one explicitly mentioned skill before starting analysis.'); return }
    const data = new FormData()
    data.append('jobDescription', jobDescription)
    data.append('jobTitle', jobTitle)
    data.append('domain', jobDomain)
    data.append('seniority', seniority)
    data.append('experienceRequirement', experienceRequirement)
    data.append('requirements', JSON.stringify(requirements))
    if (jobProfile) data.append('jobProfile', JSON.stringify({ ...jobProfile, requirements: jobProfile.requirements.filter((item) => requirements.includes(item.name)) }))
    data.append('shortlistCriteria', JSON.stringify(result?.shortlistCriteria || { minimumFitScore: 70, minimumEvidenceCoverage: 50 }))
    data.append('requestKey', crypto.randomUUID())
    resumes.forEach((file) => data.append('resumes', file))
    try {
      setLoading(true)
      const created = await api('/analysis/recruiter/match', { method: 'POST', body: data })
      sessionStorage.setItem('talentlens_recruitment_analysis_id', created.id)
      setResult(created)
    } catch (requestError) { setError(requestError.message) } finally { setLoading(false) }
  }

  function addReviewedSkill() {
    const skill = reviewSkillDraft.trim()
    if (!skill || requirementSuggestions.some((suggestion) => suggestion.toLowerCase() === skill.toLowerCase())) return
    setRequirementSuggestions((current) => [...current, skill])
    setRequirements((current) => [...current, skill])
    setJobProfile((current) => current ? { ...current, requirements: [...current.requirements, { name: skill, category: 'skill', importance: 'preferred', sourceText: skill, confirmed: true }] } : current)
    setReviewSkillDraft('')
  }

  async function resume(event, includeSelectedFiles = false) {
    event.preventDefault()
    if (!result?.id) return
    setError('')
    try {
      setLoading(true)
      const updated = await postRecruiterResumeRetry(api, result.id, resumes, includeSelectedFiles)
      sessionStorage.setItem('talentlens_recruitment_analysis_id', updated.id)
      setResult(updated)
    } catch (requestError) { setError(requestError.message) } finally { setLoading(false) }
  }

  async function saveWeights(event) {
    event.preventDefault()
    if (!result?.id) return
    setError('')
    try {
      setSavingWeights(true)
      const updated = await api(`/analysis/recruiter/analyses/${result.id}/weights`, { method: 'PATCH', body: JSON.stringify({ weights: result.weights, shortlistCriteria: result.shortlistCriteria }) })
      setResult({ ...updated, message: updated.message })
    } catch (requestError) { setError(requestError.message) } finally { setSavingWeights(false) }
  }

  function changeWeight(skill, weight) {
    setResult((current) => ({ ...current, weights: { ...current.weights, skills: { ...current.weights?.skills, [skill]: weight } } }))
  }

  function changeCriteria(key, value) {
    setResult((current) => ({ ...current, shortlistCriteria: { ...current.shortlistCriteria, [key]: value } }))
  }

  return <DashboardShell title="Build an evidence-backed shortlist" subtitle="Review the job requirements, upload student resumes, then compare source-backed evidence. Scores support recruiter review; they do not make hiring decisions.">
    <ol className="mb-5 grid gap-3 text-sm sm:grid-cols-3" aria-label="Shortlisting workflow"><li className="rounded-xl border border-blue-200 bg-blue-50 p-3 font-semibold text-blue-900">1. Understand the role</li><li className="rounded-xl border border-slate-200 bg-white p-3 text-slate-700">2. Add student resumes</li><li className="rounded-xl border border-slate-200 bg-white p-3 text-slate-700">3. Review the shortlist</li></ol>
    <form onSubmit={submit} className="grid gap-6 rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur sm:p-8">
      <section aria-labelledby="job-description-heading" className="grid gap-4">
        <h2 id="job-description-heading" className="text-lg font-semibold text-slate-900">Step 1 · Job description</h2>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Role title<input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="e.g. Backend Engineer" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="text-sm font-medium text-slate-700">Domain<input value={jobDomain} onChange={(event) => setJobDomain(event.target.value)} placeholder="e.g. fintech, healthcare" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="text-sm font-medium text-slate-700">Seniority<input value={seniority} onChange={(event) => setSeniority(event.target.value)} placeholder="e.g. entry, mid-level, senior" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="text-sm font-medium text-slate-700">Experience requirement<input value={experienceRequirement} onChange={(event) => setExperienceRequirement(event.target.value)} placeholder="e.g. 3+ years" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label></div>
        <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-700">Paste the role description</span><textarea value={jobDescription} onChange={(event) => { setJobDescription(event.target.value); setJobDescriptionFile(null); setJobProfile(null); setRequirements([]); setRequirementSuggestions([]); setRequirementsReviewed(false); setRequirementsMessage('') }} rows="7" placeholder="Include responsibilities, essential and preferred qualifications, skills, and eligibility requirements..." className="w-full cursor-text rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100" /></label>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 px-6 py-5 text-center transition hover:border-blue-300 hover:bg-blue-50/40"><Upload className="mb-2 h-6 w-6 text-blue-600" /><span className="font-semibold text-slate-800">Or upload a job description PDF/DOCX</span><span className="mt-1 text-sm text-slate-500">Text-based files only, maximum 10MB.</span><input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(event) => { setJobDescriptionFile(event.target.files?.[0] || null); setJobDescription(''); setJobProfile(null); setRequirements([]); setRequirementSuggestions([]); setRequirementsReviewed(false) }} /><span className="mt-2 text-sm font-medium text-blue-700">{jobDescriptionFile?.name || 'Choose a job-description file'}</span></label>
      </section>
      {requirementsReviewed && jobProfile ? <section className="grid gap-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4" aria-labelledby="profile-heading"><div><h2 id="profile-heading" className="text-lg font-semibold text-slate-900">Step 1 · Review the extracted job profile</h2><p className="mt-1 text-sm text-slate-600">{requirementsMessage} Only confirmed requirements affect the score. Each must cite the source description.</p></div><div className="rounded-xl bg-white p-4"><p className="font-semibold text-slate-800">{jobProfile.roleTitle || 'Role profile'}</p>{jobProfile.purpose ? <p className="mt-1 text-sm text-slate-600">{jobProfile.purpose}</p> : null}{jobProfile.responsibilities?.length ? <><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Responsibilities</p><ul className="mt-1 list-disc pl-5 text-sm text-slate-700">{jobProfile.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul></> : null}{jobProfile.domainContext?.length ? <p className="mt-3 text-sm text-slate-600"><strong>Domain context:</strong> {jobProfile.domainContext.join(' · ')}</p> : null}</div>
        <fieldset><legend className="mb-2 text-sm font-semibold text-slate-800">Suggested requirements · select up to 30</legend><div className="grid gap-2">{jobProfile.requirements.map((item) => <div key={item.name} className="grid gap-2 rounded-xl bg-white p-3 sm:grid-cols-[auto_1fr_auto_auto_auto]"><input aria-label={`Include ${item.name}`} type="checkbox" checked={requirements.includes(item.name)} disabled={requirements.length >= 30 && !requirements.includes(item.name)} onChange={(event) => setRequirements((current) => event.target.checked ? [...current, item.name] : current.filter((entry) => entry !== item.name))} /><div><input aria-label={`Edit requirement ${item.name}`} value={item.name} onChange={(event) => { const next = event.target.value; setJobProfile((current) => ({ ...current, requirements: current.requirements.map((requirement) => requirement.name === item.name ? { ...requirement, name: next } : requirement) })); setRequirementSuggestions((current) => current.map((entry) => entry === item.name ? next : entry)); setRequirements((current) => current.map((entry) => entry === item.name ? next : entry)) }} className="w-full rounded border border-transparent px-1 font-medium text-slate-800 focus:border-slate-300" /><p className="mt-1 text-xs text-slate-500">Evidence in job description: “{item.sourceText}”</p></div><select aria-label={`${item.name} category`} value={item.category} onChange={(event) => setJobProfile((current) => ({ ...current, requirements: current.requirements.map((requirement) => requirement.name === item.name ? { ...requirement, category: event.target.value } : requirement) }))} className="rounded-lg border border-slate-300 px-2 py-1 text-sm"><option value="skill">Skill</option><option value="experience">Experience</option><option value="education">Education</option><option value="eligibility">Eligibility</option><option value="project">Project</option><option value="other">Other</option></select><select aria-label={`${item.name} importance`} value={item.importance} onChange={(event) => setJobProfile((current) => ({ ...current, requirements: current.requirements.map((requirement) => requirement.name === item.name ? { ...requirement, importance: event.target.value } : requirement) }))} className="rounded-lg border border-slate-300 px-2 py-1 text-sm"><option value="essential">Essential</option><option value="preferred">Preferred</option></select><button type="button" aria-label={`Remove ${item.name}`} onClick={() => { setJobProfile((current) => ({ ...current, requirements: current.requirements.filter((requirement) => requirement.name !== item.name) })); setRequirementSuggestions((current) => current.filter((entry) => entry !== item.name)); setRequirements((current) => current.filter((entry) => entry !== item.name)) }} className="rounded-lg px-2 text-sm text-rose-700 hover:bg-rose-50">Remove</button></div>)}</div></fieldset>
        <div className="flex flex-col gap-2 sm:flex-row"><input value={reviewSkillDraft} onChange={(event) => setReviewSkillDraft(event.target.value)} placeholder="Add a requirement explicitly named in the description" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="button" onClick={addReviewedSkill} disabled={!reviewSkillDraft.trim() || requirements.length >= 30} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50">Add requirement</button></div>
        {requirements.length === 0 ? <p className="text-sm text-rose-700">Select at least one source-supported requirement to continue.</p> : null}</section> : null}
      <section aria-labelledby="resumes-heading" className="grid gap-4"><h2 id="resumes-heading" className="text-lg font-semibold text-slate-900">Step 2 · Student resumes</h2><label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 px-6 py-8 text-center transition hover:border-blue-300 hover:bg-blue-50/40"><Upload className="mb-3 h-7 w-7 text-blue-600" /><span className="font-semibold text-slate-800">Upload student resumes</span><span className="mt-1 text-sm text-slate-500">Text-based PDF or DOCX. Maximum 50 files, 10MB each.</span><input required={requirementsReviewed} multiple accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" type="file" className="sr-only" onChange={(event) => setResumes([...event.target.files])} /><span className="mt-3 text-sm font-medium text-blue-700">{resumes.length ? resumes.map((file) => file.name).join(', ') : 'Choose files'}</span></label></section>
      {error ? <p role="alert" className="text-sm font-medium text-rose-600">{error}</p> : null}
      <button disabled={loading || (requirementsReviewed && !requirements.length)} className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70">{loading ? requirementsReviewed ? 'Starting analysis…' : 'Extracting and structuring job requirements…' : requirementsReviewed ? 'Analyze resumes against this job' : 'Analyze job description'}</button>
    </form>
    {error ? <p role="alert" className="mt-4 text-sm font-medium text-rose-600">{error}</p> : null}
    <RecruitmentResults result={result} onSave={saveWeights} onChangeWeight={changeWeight} onChangeCriteria={changeCriteria} saving={savingWeights} files={resumes} loading={loading} candidateIssue={candidateIssue} onRetry={(includeFiles) => resume({ preventDefault() {} }, includeFiles)} />
  </DashboardShell>
}
export default RecruiterDashboard
