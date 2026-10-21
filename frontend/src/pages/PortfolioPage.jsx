import { useEffect, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUpRight, Download, ExternalLink, GitBranch, Pencil, Save, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { portfolioStorageKey, readPortfolioDraft, savePortfolioDraft } from '../lib/portfolioDraft.js'
import './PortfolioPage.css'

const categories = [
  { name: 'Languages', match: /javascript|typescript|python|java|c\+\+|c#|go|rust|php|ruby|sql/i },
  { name: 'Frontend', match: /react|vue|angular|html|css|tailwind|redux|vite|next/i },
  { name: 'Backend', match: /node|express|django|flask|spring|\.net|api|graphql/i },
  { name: 'Data', match: /mongo|postgres|mysql|sqlite|redis|database|oracle/i },
  { name: 'Tools & Cloud', match: /git|github|docker|aws|azure|gcp|postman|linux|cmake|kubernetes/i },
]

function groupSkills(skills) {
  const groups = new Map()
  for (const skill of skills) {
    const category = categories.find(({ match }) => match.test(skill))?.name || 'Other'
    groups.set(category, [...(groups.get(category) || []), skill])
  }
  return [...groups.entries()]
}

function safeUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
}

function hasPortfolioContent(portfolio) {
  if (!portfolio) return false
  return Boolean(portfolio.name || portfolio.headline || portfolio.summary || portfolio.skills?.length || portfolio.projects?.length || portfolio.experience?.length || portfolio.education?.length || portfolio.certifications?.length || Object.keys(portfolio.links || {}).length)
}

function PortfolioPage() {
  const user = localStorage.getItem('jobekaa_user')
  const draftKey = portfolioStorageKey(user)
  const [portfolio, setPortfolio] = useState(() => readPortfolioDraft(localStorage, draftKey))
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (portfolio) savePortfolioDraft(localStorage, draftKey, portfolio)
  }, [draftKey, portfolio])

  function changeField(field, value) {
    setPortfolio((current) => ({ ...current, [field]: value }))
    setSaved(false)
  }

  function changeRecord(section, index, field, value) {
    setPortfolio((current) => ({ ...current, [section]: current[section].map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }))
    setSaved(false)
  }

  function finishEditing() {
    savePortfolioDraft(localStorage, draftKey, portfolio)
    setEditing(false)
    setSaved(true)
  }

  function printPortfolio() {
    const root = document.createElement('main')
    root.id = 'portfolio-print-root'
    const title = document.createElement('h1')
    title.textContent = portfolio.name || 'Professional Portfolio'
    root.append(title)
    if (headline) {
      const subtitle = document.createElement('p')
      subtitle.textContent = headline
      root.append(subtitle)
    }

    const addSection = (heading, entries) => {
      if (!entries.length) return
      const section = document.createElement('section')
      const label = document.createElement('h2')
      label.textContent = heading
      section.append(label)
      for (const entry of entries) {
        const article = document.createElement('article')
        const values = entry && typeof entry === 'object' ? Object.entries(entry) : [['', entry]]
        for (const [field, value] of values) {
          if (!value) continue
          const paragraph = document.createElement('p')
          paragraph.textContent = field ? `${field}: ${String(value)}` : String(value)
          article.append(paragraph)
        }
        section.append(article)
      }
      root.append(section)
    }

    addSection('Professional summary', portfolio.summary ? [portfolio.summary] : [])
    addSection('Technical skills', portfolio.skills || [])
    addSection('Projects', portfolio.projects || [])
    addSection('Experience', portfolio.experience || [])
    addSection('Education', portfolio.education || [])
    addSection('Certifications', portfolio.certifications || [])
    addSection('Professional links', Object.entries(portfolio.links || {}).map(([label, url]) => `${label}: ${url}`))
    if (portfolio.publishEmail && portfolio.contactEmail) addSection('Contact', [portfolio.contactEmail])
    document.body.append(root)
    window.addEventListener('afterprint', () => root.remove(), { once: true })
    window.print()
  }

  if (!hasPortfolioContent(portfolio)) {
    return <main className="portfolio-empty">
      <div className="portfolio-empty__mark">TL</div>
      <p className="portfolio-eyebrow">TalentLens portfolio</p>
      <h1>Your portfolio is not ready yet.</h1>
      <p>Analyze a resume first, then generate a portfolio from the sections that were actually extracted.</p>
      <Link className="portfolio-button portfolio-button--dark" to="/job-seeker"><ArrowLeft size={17} /> Back to resume analysis</Link>
    </main>
  }

  const headline = portfolio.headline || portfolio.experience?.[0]?.title || ''
  const skills = groupSkills(portfolio.skills || [])
  const hasContact = portfolio.publishEmail && portfolio.contactEmail || Object.keys(portfolio.links || {}).length > 0

  return <main className="portfolio-site" id="top">
    <div className="portfolio-topline">
      <Link className="portfolio-brand" to="/job-seeker" aria-label="Back to TalentLens"><span>TL</span><b>TalentLens</b></Link>
      <nav aria-label="Portfolio navigation" className="portfolio-nav">
        {portfolio.projects?.length ? <a href="#projects">Projects</a> : null}
        {portfolio.skills?.length ? <a href="#skills">Skills</a> : null}
        {hasContact ? <a href="#contact">Contact</a> : null}
      </nav>
      <Link className="portfolio-back" to="/job-seeker"><ArrowLeft size={15} /> Back to TalentLens</Link>
    </div>

    <section className="portfolio-hero" aria-labelledby="portfolio-name">
      <div className="portfolio-hero__copy">
        <p className="portfolio-eyebrow"><span /> Personal portfolio</p>
        <h1 id="portfolio-name">{portfolio.name || 'Professional Portfolio'}<span className="portfolio-period">.</span></h1>
        {headline ? <p className="portfolio-headline">{headline}</p> : null}
        {portfolio.summary ? <p className="portfolio-intro">{portfolio.summary}</p> : <p className="portfolio-intro">A professional profile built from the experience and skills shared here.</p>}
        <div className="portfolio-actions">
          {portfolio.projects?.length ? <a className="portfolio-button portfolio-button--dark" href="#projects">View my projects <ArrowDown size={16} /></a> : null}
          <a className="portfolio-button portfolio-button--line" href="#contact">Contact me <ArrowUpRight size={16} /></a>
        </div>
      </div>
      <div className="portfolio-hero__art" aria-hidden="true">
        <div className="portfolio-art-grid" />
        <div className="portfolio-art-card"><span>PROFILE / 01</span><strong>{(portfolio.name || 'P').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</strong><i>Available portfolio</i></div>
        <div className="portfolio-art-index">{String((portfolio.projects || []).length).padStart(2, '0')} <span>selected work</span></div>
      </div>
      <span className="portfolio-hero__number" aria-hidden="true">01</span>
    </section>

    <div className="portfolio-content">
      {portfolio.summary ? <section className="portfolio-about portfolio-section" id="about">
        <div className="portfolio-section__label"><span>01</span><p>About</p></div>
        <div className="portfolio-about__body"><h2>A little about my work.</h2>{editing ? <textarea aria-label="Edit about introduction" value={portfolio.summary} onChange={(event) => changeField('summary', event.target.value)} rows={5} /> : <p>{portfolio.summary}</p>}</div>
      </section> : null}

      {skills.length ? <section className="portfolio-skills portfolio-section" id="skills">
        <div className="portfolio-section__label"><span>02</span><p>Toolkit</p></div>
        <div className="portfolio-section__body"><div className="portfolio-section__heading"><h2>Tools I work with.</h2><p>Only skills listed in the source resume.</p></div><div className="portfolio-skill-grid">{skills.map(([category, items]) => <article className="portfolio-skill-group" key={category}><h3>{category}</h3><div>{items.map((skill) => <span key={skill}>{skill}</span>)}</div></article>)}</div></div>
      </section> : null}

      {portfolio.projects?.length ? <section className="portfolio-projects portfolio-section" id="projects">
        <div className="portfolio-section__label"><span>03</span><p>Selected work</p></div>
        <div className="portfolio-section__body"><div className="portfolio-section__heading"><h2>Projects with purpose.</h2><p>Ideas turned into working software.</p></div><div className="portfolio-project-grid">{portfolio.projects.map((project, index) => <article className="portfolio-project" key={`${project.title}-${index}`}>
          <div className="portfolio-project__top"><span>PROJECT / {String(index + 1).padStart(2, '0')}</span><span className="portfolio-project__spark" aria-hidden="true">↗</span></div>
          <h3>{editing ? <input aria-label={`Edit project ${index + 1} title`} value={project.title} onChange={(event) => changeRecord('projects', index, 'title', event.target.value)} /> : project.title}</h3>
          {editing ? <textarea aria-label={`Edit project ${index + 1} description`} value={project.description} onChange={(event) => changeRecord('projects', index, 'description', event.target.value)} rows={4} /> : project.description ? <p>{project.description}</p> : null}
          {project.technologies ? <p className="portfolio-project__tech">{project.technologies}</p> : null}
          <div className="portfolio-project__links">{safeUrl(project.github) ? <a href={safeUrl(project.github)} target="_blank" rel="noreferrer"><GitBranch size={15} /> Code <ArrowUpRight size={14} /></a> : null}{safeUrl(project.demo || project.url) ? <a href={safeUrl(project.demo || project.url)} target="_blank" rel="noreferrer">Live project <ArrowUpRight size={14} /></a> : null}</div>
        </article>)}</div></div>
      </section> : null}

      {portfolio.experience?.length ? <section className="portfolio-experience portfolio-section" id="experience">
        <div className="portfolio-section__label"><span>04</span><p>Experience</p></div>
        <div className="portfolio-section__body"><div className="portfolio-section__heading"><h2>Where I’ve contributed.</h2></div><div className="portfolio-timeline">{portfolio.experience.map((item, index) => <article key={`${item.company}-${index}`}><span className="portfolio-timeline__dot" /><div><h3>{item.title || item.company}</h3>{item.company && item.title ? <p className="portfolio-timeline__company">{item.company}</p> : null}{item.duration ? <p className="portfolio-timeline__date">{item.duration}</p> : null}{item.description ? <p>{item.description}</p> : null}</div></article>)}</div></div>
      </section> : null}

      {portfolio.education?.length || portfolio.certifications?.length ? <section className="portfolio-education portfolio-section" id="education">
        <div className="portfolio-section__label"><span>05</span><p>Learning</p></div>
        <div className="portfolio-section__body"><div className="portfolio-section__heading"><h2>Education & credentials.</h2></div><div className="portfolio-learning-grid">{portfolio.education?.map((item, index) => <article key={`education-${index}`}><span>EDUCATION</span><h3>{item.degree || item.institution}</h3>{item.institution && item.degree ? <p>{item.institution}</p> : null}{item.year ? <small>{item.year}</small> : null}{item.description ? <p>{item.description}</p> : null}</article>)}{portfolio.certifications?.map((item, index) => <article key={`certification-${index}`}><span>CERTIFICATION</span><h3>{item}</h3></article>)}</div></div>
      </section> : null}

      <section className="portfolio-contact" id="contact"><div><p className="portfolio-eyebrow">Have a good project in mind?</p><h2>Let’s make something useful.</h2><p>Reach out through a professional link below.</p></div><div className="portfolio-contact__links">{portfolio.publishEmail && portfolio.contactEmail ? <a href={`mailto:${portfolio.contactEmail}`}>Email me <ArrowUpRight size={16} /></a> : null}{safeUrl(portfolio.links?.github) ? <a href={safeUrl(portfolio.links.github)} target="_blank" rel="noreferrer"><GitBranch size={16} />GitHub <ArrowUpRight size={15} /></a> : null}{safeUrl(portfolio.links?.linkedin) ? <a href={safeUrl(portfolio.links.linkedin)} target="_blank" rel="noreferrer"><ExternalLink size={16} />LinkedIn <ArrowUpRight size={15} /></a> : null}{safeUrl(portfolio.links?.website) ? <a href={safeUrl(portfolio.links.website)} target="_blank" rel="noreferrer">Website <ArrowUpRight size={15} /></a> : null}{!hasContact && <p className="portfolio-contact__private">No public contact links were included. Edit the portfolio to add an email only if you choose to publish it.</p>}</div></section>
    </div>

    <footer className="portfolio-footer"><Link to="/job-seeker">TalentLens</Link><span>Portfolio generated from user-provided resume information.</span><a href="#top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Back to top ↑</a></footer>

    <div className="portfolio-editbar" aria-label="Portfolio actions"><span aria-live="polite">{saved ? 'Changes saved on this device' : editing ? 'Editing portfolio draft' : 'Your resume, thoughtfully presented'}</span>{editing ? <><label className="portfolio-publish-toggle"><input type="checkbox" checked={Boolean(portfolio.publishEmail)} onChange={(event) => changeField('publishEmail', event.target.checked)} /> Publish email</label>{portfolio.publishEmail ? <input className="portfolio-email-input" type="email" aria-label="Email to publish" placeholder="you@example.com" value={portfolio.contactEmail || ''} onChange={(event) => changeField('contactEmail', event.target.value)} /> : null}<button type="button" onClick={finishEditing}><Save size={16} />Save changes</button><button className="portfolio-editbar__cancel" type="button" onClick={() => setEditing(false)} aria-label="Cancel editing"><X size={17} /></button></> : <><button type="button" onClick={() => setEditing(true)}><Pencil size={16} />Edit portfolio</button><button type="button" onClick={printPortfolio}><Download size={16} />Download / Print</button></>}</div>
  </main>
}

export default PortfolioPage
