import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Download, ExternalLink, Plus, Upload } from 'lucide-react'
import DashboardShell from '../components/DashboardShell'
import { api } from '../lib/api'
import { aiErrorMessage } from '../lib/aiError.js'
import { formatScore, isValidScore } from '../lib/score.js'
import { normalizePortfolioDraft, portfolioStorageKey, savePortfolioDraft } from '../lib/portfolioDraft.js'

const meaningfulText = (value) => typeof value === 'string' && value.trim() && !/^\.+$/.test(value.trim())
const normalizeStringArray = (value) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;\n]/) : []).map((item) => typeof item === 'string' ? item.trim() : '').filter(meaningfulText)
const list = (value) => Array.isArray(value) ? value : []
const boundedProfileValue = (value, depth = 0) => {
  if (typeof value === 'string') return value.slice(0, 400)
  if (Array.isArray(value) && depth < 2) return value.slice(0, 5).map((item) => boundedProfileValue(item, depth + 1))
  if (value && typeof value === 'object' && depth < 2) return Object.fromEntries(Object.entries(value).filter(([key]) => !/email|phone|mobile|address|linkedin|portfolio|url|website/i.test(key)).slice(0, 8).map(([key, item]) => [key, boundedProfileValue(item, depth + 1)]))
  return ''
}
const normalizeNamedItems = (value, field, extras = []) => list(value).filter((item) => item && typeof item === 'object' && meaningfulText(item[field])).map((item) => Object.fromEntries([[field, item[field].trim()], ...extras.map((key) => [key, meaningfulText(item[key]) ? item[key].trim() : ''])]))

function JobSeekerDashboard() {
  const navigate = useNavigate()
  const [resume, setResume] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobs, setJobs] = useState([])
  const [jobsError, setJobsError] = useState('')
  const [links, setLinks] = useState([])
  const [newSkills, setNewSkills] = useState([])
  const [skillMessage, setSkillMessage] = useState('')
  const [portfolio, setPortfolio] = useState(null)
  const [portfolioMessage, setPortfolioMessage] = useState('')
  const [portfolioLoading, setPortfolioLoading] = useState(false)
  const [portfolioError, setPortfolioError] = useState('')
  const [location, setLocation] = useState(() => sessionStorage.getItem('jobekaa_job_location') || 'india')
  const jobsSectionRef = useRef(null)

  async function loadJobs(data, scope = location) {
    setJobsLoading(true)
    setJobsError('')
    try {
      const profile = data.resume || {}
      const response = await api('/jobs/recommended', {
        method: 'POST',
        body: JSON.stringify({
          role: data.bestJobRole?.title || '',
          location: scope,
          resume: {
            professionalSummary: (profile.professionalSummary || profile.summary || '').slice(0, 3000),
            skills: normalizeStringArray(profile.skills).slice(0, 30).map((skill) => skill.slice(0, 120)),
            experience: boundedProfileValue(list(profile.experience)),
            projects: boundedProfileValue(list(profile.projects)),
            education: boundedProfileValue(list(profile.education)),
            certifications: normalizeStringArray(profile.certifications).slice(0, 20).map((item) => item.slice(0, 120)),
          },
        }),
      })
      setJobs(list(response.jobs)); setLinks(list(response.fallbackSearchLinks))
    } catch (requestError) { setJobs([]); setLinks([]); setJobsError(aiErrorMessage(requestError)); throw requestError } finally { setJobsLoading(false) }
  }

  async function submit(event) {
    event.preventDefault(); setError(''); setJobs([]); setJobsError(''); setLinks([]); setAnalysis(null); setPortfolio(null); setPortfolioMessage(''); setPortfolioError(''); setNewSkills([]); setSkillMessage('')
    const body = new FormData(); body.append('resume', resume)
    try {
      setLoading(true)
      const response = await api('/analysis/resume', { method: 'POST', body })
      if (!response.success || !response.data) throw new Error(response.message || 'The analysis response was incomplete.')
      await loadJobs(response.data); setAnalysis(response.data); setPortfolio(null)
      try {
        const catalog = await api('/skills')
        const knownSkills = new Set(normalizeStringArray(catalog.skills).map((skill) => skill.toLowerCase()))
        setNewSkills(normalizeStringArray(response.data.resume?.skills).filter((skill) => !knownSkills.has(skill.toLowerCase())))
      } catch (catalogError) { setSkillMessage(catalogError.message || 'The skill catalogue is unavailable.') }
    } catch (requestError) { setAnalysis(null); setJobs([]); setLinks([]); setError(aiErrorMessage(requestError)) } finally { setLoading(false) }
  }

  function changeLocation(event) { const next = event.target.value; setLocation(next); sessionStorage.setItem('jobekaa_job_location', next); if (analysis) loadJobs(analysis, next) }
  async function acceptSkill(skill) {
    setSkillMessage('')
    try {
      await api('/skills', { method: 'POST', body: JSON.stringify({ skill }) })
      setNewSkills((current) => current.filter((item) => item !== skill))
      setSkillMessage(`${skill} added to your skill catalogue.`)
    } catch (requestError) { setSkillMessage(requestError.message) }
  }
  async function generatePortfolio() {
    setPortfolioError('')
    setPortfolioMessage('')
    setPortfolioLoading(true)
    try {
      const response = await api('/portfolio', { method: 'POST', body: JSON.stringify({ resume: analysis.resume }) })
      const draft = normalizePortfolioDraft(response.portfolio && typeof response.portfolio === 'object' ? response.portfolio : {})
      const key = portfolioStorageKey(localStorage.getItem('jobekaa_user'))
      savePortfolioDraft(localStorage, key, draft)
      setPortfolio(draft)
      setPortfolioMessage(response.message || '')
      navigate('/portfolio')
    } catch (requestError) { setPortfolioError(requestError.message || 'Portfolio could not be generated.') } finally { setPortfolioLoading(false) }
  }
  function updatePortfolio(key, value) { setPortfolio((current) => ({ ...current, [key]: value })) }
  function updatePortfolioRecord(section, index, field, value) {
    setPortfolio((current) => ({ ...current, [section]: current[section].map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }))
  }
  function printPortfolio() {
    const root = document.createElement('main')
    root.id = 'portfolio-print-root'
    const heading = document.createElement('h1')
    heading.textContent = 'Professional Portfolio'
    root.append(heading)

    for (const [section, value] of Object.entries(portfolio || {})) {
      const sectionElement = document.createElement('section')
      const sectionHeading = document.createElement('h2')
      sectionHeading.textContent = section === 'summary' ? 'Professional Summary' : section[0].toUpperCase() + section.slice(1)
      sectionElement.append(sectionHeading)
      const entries = Array.isArray(value) ? value : [value]

      for (const entry of entries) {
        const item = document.createElement('article')
        if (entry && typeof entry === 'object') {
          for (const [field, fieldValue] of Object.entries(entry)) {
            const text = document.createElement('p')
            text.textContent = `${field[0].toUpperCase() + field.slice(1)}: ${String(fieldValue)}`
            item.append(text)
          }
        } else {
          const text = document.createElement('p')
          text.textContent = String(entry)
          item.append(text)
        }
        sectionElement.append(item)
      }
      root.append(sectionElement)
    }

    document.body.append(root)
    window.addEventListener('afterprint', () => root.remove(), { once: true })
    window.print()
  }
  const strengths = normalizeStringArray(analysis?.strengths); const gaps = normalizeNamedItems(analysis?.missingSkills, 'skill', ['reason']); const improvements = normalizeNamedItems(analysis?.improvementSuggestions, 'category', ['suggestion']).filter((item) => item.suggestion); const alternatives = list(analysis?.alternativeRoles).filter((item) => item && meaningfulText(item.title) && isValidScore(item.score)).map((item) => ({ title: item.title.trim(), score: item.score })); const missingSections = normalizeNamedItems(analysis?.missingSections, 'section', ['reason'])

  return <DashboardShell title={analysis ? 'Your career fit' : 'Make your resume work harder'} subtitle={analysis ? 'Resume review and India-focused job discovery.' : 'Upload your resume for a review of missing sections, role fit, and practical next steps.'}>
    <form onSubmit={submit} className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur sm:p-8"><label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 px-6 py-8 text-center"><Upload className="mb-3 h-8 w-8 text-blue-600" /><span className="font-semibold text-slate-800">Upload your resume</span><span className="mt-1 text-sm text-slate-500">PDF or DOCX. Maximum 10MB.</span><input required accept=".pdf,.docx" type="file" className="sr-only" onChange={(event) => setResume(event.target.files[0])} /><span className="mt-3 text-sm font-medium text-blue-700">{resume ? resume.name : 'Choose file'}</span></label>{error ? <div role="alert" className="mt-4 text-sm font-medium text-rose-600"><p>{error}</p><button type="button" disabled={loading || !resume} onClick={() => submit({ preventDefault() {} })} className="mt-2 rounded-lg border border-rose-300 px-3 py-2 font-semibold text-rose-700 disabled:opacity-50">Retry AI analysis</button></div> : null}<button disabled={loading || !resume} className="mt-5 w-full cursor-pointer rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-70">{loading ? 'Analyzing your resume...' : 'Review my resume'}</button></form>
    {analysis ? <section className="mt-8 space-y-5"><article className="rounded-[28px] bg-blue-600 p-6 text-white sm:p-8"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100">Suggested career role · role-fit estimate</p><h2 className="mt-2 text-3xl font-semibold">{analysis.bestJobRole?.title || 'No matching role found'}</h2><p className="mt-3 text-5xl font-semibold">{formatScore(analysis.bestJobRole?.score)} <span className="text-base font-medium">role fit</span></p><p className="mt-4 max-w-2xl text-sm text-blue-100">{analysis.bestJobRole?.reason}</p><p className="mt-3 max-w-2xl text-xs text-blue-100">Compared resume-supported skills with broad role profiles. This is not a match score for a specific vacancy. {analysis.analysisMethod === 'deterministic-fallback' || analysis.contextualAnalysisAvailable === false ? 'Gemini was unavailable; the result uses deterministic skill overlap only.' : 'The role estimate uses contextual analysis where available.'}</p><button type="button" onClick={() => jobsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="mt-5 cursor-pointer rounded-xl bg-white px-4 py-2 text-sm font-semibold text-blue-700">Find matching jobs</button></article>
      {strengths.length ? <article className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-semibold">Why this role?</h2><div className="mt-4 flex flex-wrap gap-2">{strengths.map((strength) => <span key={strength} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" />{strength}</span>)}</div></article> : null}
      {newSkills.length ? <article className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-semibold">Review unlisted skills</h2><p className="mt-1 text-sm text-slate-500">Approve only skills you recognize. Approved entries become available in future job explanations.</p><div className="mt-4 flex flex-wrap gap-2">{newSkills.map((skill) => <button key={skill} type="button" onClick={() => acceptSkill(skill)} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-blue-300 hover:text-blue-700"><Plus className="h-4 w-4" />Add {skill}</button>)}</div>{skillMessage ? <p role="status" className="mt-3 text-sm text-emerald-700">{skillMessage}</p> : null}</article> : null}
      <section ref={jobsSectionRef} className="rounded-[28px] border border-slate-200 bg-white p-6 sm:p-8"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">Recommended jobs</h2><p className="mt-1 text-sm text-slate-500">Latest available opportunities for Indian job seekers.</p></div><label className="text-sm font-medium text-slate-600">Location <select value={location} onChange={changeLocation} className="ml-2 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2"><option value="india">India</option><option value="remote-india">Remote India</option><option value="global">Global</option></select></label></div>{jobsLoading ? <p className="mt-5 text-sm text-slate-500">Finding matching opportunities...</p> : jobsError ? <p role="alert" className="mt-5 text-sm text-rose-600">{jobsError}</p> : jobs.length ? <div className="mt-5 grid items-start gap-3 lg:grid-cols-2">{jobs.slice(0, 6).map((job) => <article key={job.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{job.title}</h3><p className="text-sm text-slate-600">{job.company}</p></div><b className="text-blue-700">{formatScore(job.matchScore)}</b></div><p className="mt-3 text-sm text-slate-500">{job.originalLocation} · {list(job.type).join(', ')}</p>{job.domain ? <p className="mt-2 text-xs font-medium text-blue-700">Domain priority: {job.domain.replace('-', ' ')} · domain-weighted skill score {formatScore(job.scoreComponents?.domainWeightedScore ?? job.domainWeightedScore)}</p> : null}{normalizeStringArray(job.matchedSkills).length ? <p className="mt-2 text-xs text-emerald-700">Matched: {normalizeStringArray(job.matchedSkills).slice(0, 4).join(', ')}</p> : null}{normalizeStringArray(job.missingSkills).length ? <p className="mt-1 text-xs text-amber-700">Missing from resume: {normalizeStringArray(job.missingSkills).slice(0, 4).join(', ')}</p> : null}{job.scoreComponents ? <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">How this match was scored</summary><p className="mt-2">Method: {job.matchMethod === 'gemini-embedding' ? 'Gemini text embeddings' : job.matchMethod === 'deterministic-context' ? 'Deterministic resume/job text overlap' : 'Keyword baseline'} · Baseline {formatScore(job.scoreComponents.baselineScore)} · Context {formatScore(job.scoreComponents.contextualScore)} · Location {formatScore(job.scoreComponents.locationScore)} · Recency {formatScore(job.scoreComponents.recencyScore)}</p></details> : null}<div className="mt-4 flex items-center justify-between text-xs text-slate-500"><span>Source: Jobicy</span><a href={job.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-700">Apply <ExternalLink className="h-3.5 w-3.5" /></a></div></article>)}</div> : <p className="mt-5 text-sm text-slate-500">No India-eligible opportunities are available from the current source. Try the job boards below.</p>}</section>
      {gaps.length ? <article className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-semibold">Skills to improve</h2>{gaps.map((gap) => <p key={gap.skill} className="mt-3 text-sm text-slate-600"><b>{gap.skill}</b>{gap.reason ? ` · ${gap.reason}` : ''}</p>)}<p className="mt-4 text-xs text-slate-500">Only add skills after you genuinely acquire or demonstrate them.</p></article> : null}
      {improvements.length ? <article className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-semibold">Resume improvements</h2>{improvements.slice(0, 3).map((item, index) => <p key={`${item.category}-${index}`} className="mt-3 text-sm text-slate-600"><b className="text-blue-700">{item.category}</b><br />{item.suggestion}</p>)}</article> : null}
      {missingSections.length ? <article className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-semibold">Resume sections to consider</h2>{missingSections.map((item) => <p key={item.section} className="mt-3 text-sm text-slate-600"><b>{item.section}</b> · {item.reason}</p>)}</article> : null}
      {alternatives.length ? <article className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-semibold">Other roles worth exploring</h2><div className="mt-4 grid items-start gap-3 sm:grid-cols-3">{alternatives.map((role) => <p key={role.title} className="rounded-xl bg-slate-50 p-3 text-sm"><b>{role.title}</b><span className="float-right text-blue-700">{formatScore(role.score)}</span></p>)}</div></article> : null}
      {links.length ? <article className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-semibold">More places to apply</h2><div className="mt-3 flex flex-wrap gap-2">{links.map((link) => <a key={link.name} href={link.url} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-blue-100">{link.name}</a>)}</div></article> : null}
      <section className="no-print rounded-2xl border border-slate-200 bg-white p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Portfolio</h2><p className="mt-1 text-sm text-slate-500">Create a professional preview from sections found in your resume.</p></div><button type="button" disabled={portfolioLoading} onClick={generatePortfolio} className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{portfolioLoading ? 'Generating…' : 'Generate portfolio'}</button></div>{portfolioError ? <p role="alert" className="mt-3 text-sm text-rose-600">{portfolioError}</p> : null}</section>
      {portfolio ? <section id="portfolio-preview" className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-10"><div className="no-print mb-8 flex items-center justify-between gap-3 border-b border-slate-200 pb-5"><div><h2 className="font-semibold">Portfolio preview</h2><p className="text-sm text-slate-500">Edit the content before printing or saving as PDF.</p></div><button type="button" onClick={printPortfolio} title="Print or save portfolio as PDF" className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4" />Print / Save PDF</button></div>{Object.keys(portfolio).length === 0 ? <p className="text-sm text-amber-700">{portfolioMessage || 'No portfolio sections were extracted. Review the extracted resume details or upload a text-based PDF/DOCX with professional sections.'}</p> : <div className="mx-auto max-w-3xl space-y-8">{portfolio.summary ? <section><h2 className="text-2xl font-semibold text-slate-950">Professional summary</h2><textarea aria-label="Edit professional summary" rows="4" value={portfolio.summary} onChange={(event) => updatePortfolio('summary', event.target.value)} className="mt-3 w-full resize-y rounded-lg border border-slate-200 p-3 text-sm leading-6 text-slate-700" /></section> : null}{portfolio.skills ? <section><h2 className="text-xl font-semibold">Skills</h2><textarea aria-label="Edit portfolio skills" rows="3" value={portfolio.skills.join(', ')} onChange={(event) => updatePortfolio('skills', normalizeStringArray(event.target.value))} className="mt-3 w-full rounded-lg border border-slate-200 p-3 text-sm text-slate-700" /></section> : null}{['projects', 'experience', 'education'].map((section) => portfolio[section]?.length ? <section key={section}><h2 className="text-xl font-semibold capitalize">{section}</h2><div className="mt-3 space-y-4">{portfolio[section].map((item, index) => <article key={`${section}-${index}`} className="border-l-2 border-blue-600 pl-4">{Object.entries(item).map(([field, value]) => <label key={field} className="mt-2 block text-xs font-medium capitalize text-slate-500">{field}<textarea rows={field === 'description' ? 3 : 1} value={value} onChange={(event) => updatePortfolioRecord(section, index, field, event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 p-2 text-sm font-normal text-slate-800" /></label>)}</article>)}</div></section> : null)}{portfolio.certifications?.length ? <section><h2 className="text-xl font-semibold">Certifications</h2><textarea aria-label="Edit certifications" rows="3" value={portfolio.certifications.join('\n')} onChange={(event) => updatePortfolio('certifications', normalizeStringArray(event.target.value))} className="mt-3 w-full rounded-lg border border-slate-200 p-3 text-sm text-slate-700" /></section> : null}</div>}</section> : null}
      {normalizeStringArray(analysis.resume?.skills).length || list(analysis.resume?.projects).length || list(analysis.resume?.education).length || list(analysis.resume?.experience).length ? <details className="rounded-2xl border border-slate-200 bg-white p-6"><summary className="cursor-pointer font-semibold">View extracted resume details</summary><div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">{normalizeStringArray(analysis.resume?.skills).length ? <p><b>Skills:</b> {normalizeStringArray(analysis.resume.skills).join(', ')}</p> : null}{list(analysis.resume?.projects).length ? <p><b>Projects:</b> {analysis.resume.projects.length}</p> : null}{list(analysis.resume?.education).length ? <p><b>Education:</b> {analysis.resume.education.length}</p> : null}{list(analysis.resume?.experience).length ? <p><b>Experience:</b> {analysis.resume.experience.length}</p> : null}</div></details> : null}</section> : null}
  </DashboardShell>
}

export default JobSeekerDashboard
