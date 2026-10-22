import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { AGENT_STATES, classifyShortlist, createRecruitmentToolRegistry, matchUploadedCandidates, profileFingerprint, requirementsFromJob, rescoreCandidate, resumeFileFingerprint, scoreCandidate, sourceGroundedProfile, validateProfile, validateWeights } from '../src/services/recruitmentAgentService.js'
import { isRetryableGeminiError, redactContactInformation, resetGeminiClientFactory, setGeminiClientFactory } from '../src/services/resumePipelineService.js'
import { normalizeSkillName, skillMentionedInText, suggestJobRequirements, validateJobRequirements } from '../src/services/recruitmentAgentService.js'

test('recruitment workflow exposes a bounded, explicit sequence of states', () => {
  assert.deepEqual(AGENT_STATES, ['validate', 'extract', 'profile', 'match', 'persist', 'done'])
})

test('job requirement extraction uses an allowlisted skill vocabulary and validates input', () => {
  assert.deepEqual(requirementsFromJob('Build React applications with JavaScript and SQL for our team.'), ['javascript', 'react', 'sql'])
  assert.deepEqual(requirementsFromJob('Build NodeJS services with React.js for our team.'), ['react', 'node.js'])
  assert.throws(() => requirementsFromJob('too short'), { status: 400 })
  assert.throws(() => validateWeights({ skills: { python: 6 } }, ['python']), { status: 400 })
})

test('structured job requirements normalize names, require source mentions, and remain recruiter-confirmed', async () => {
  const previousKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'test-key'
  setGeminiClientFactory(() => ({ models: { generateContent: async ({ contents }) => {
    assert.doesNotMatch(contents, /recruiter@example\.com|555 123 4567/)
    return { text: JSON.stringify({ roleTitle: 'Data systems engineer', purpose: 'Build data systems', responsibilities: ['Build data systems with Go, Kafka, and NodeJS.'], domainContext: ['data systems'], requirements: [
      { name: 'Go', category: 'skill', importance: 'essential', sourceText: 'Go' },
      { name: 'Kafka', category: 'skill', importance: 'preferred', sourceText: 'Kafka' },
      { name: 'Node.js', category: 'skill', importance: 'essential', sourceText: 'NodeJS' },
      { name: 'COBOL', category: 'skill', importance: 'essential', sourceText: 'Go' },
    ] }) }
  } } }))
  try {
    const description = 'Build data systems with Go, Kafka, and NodeJS. Work with a collaborative engineering team. Contact recruiter@example.com at +1 555 123 4567.'
    const proposal = await suggestJobRequirements(description)
    assert.deepEqual(proposal.requirements, ['go', 'kafka', 'node.js'])
    assert.equal(proposal.jobProfile.requirements.length, 3, 'unsupported AI requirements without source evidence are rejected')
    assert.equal(proposal.method, 'structured')
    assert.deepEqual(validateJobRequirements(['Go', 'Node.js'], description), ['go', 'node.js'])
    assert.throws(() => validateJobRequirements(['COBOL'], description), { status: 400 })
    assert.throws(() => validateJobRequirements(['age'], `${description} Age 18+ required.`), /Protected personal characteristics/)
    assert.equal(normalizeSkillName('NodeJS'), 'node.js')
    assert.equal(skillMentionedInText('Built a Node.js service', 'nodejs'), true)
  } finally {
    resetGeminiClientFactory()
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previousKey
  }
})

test('candidate matches require both a parsed skill and traceable source text', () => {
  const profile = validateProfile({ name: 'Ada', skills: ['React', 'SQL', 'Java'] })
  const score = scoreCandidate(profile, 'Ada built a React interface.', ['react', 'sql', 'java'])
  assert.equal(score.score, 33)
  assert.deepEqual(score.matchedSkills, ['react'])
  assert.deepEqual(score.missingRequiredSkills, ['sql', 'java'])
  assert.match(score.evidence[0].excerpt, /React/)
})

test('candidate matching excludes explicitly negated skill claims from scores and evidence', () => {
  const result = scoreCandidate({ skills: ['Python', 'React'] }, 'No prior experience with Python. Built several React projects.', ['python', 'react'])
  assert.deepEqual(result.matchedSkills, ['react'])
  assert.deepEqual(result.missingRequiredSkills, ['python'])
  assert.equal(result.evidence[0].skill, 'react')
  assert.match(result.evidence[0].excerpt, /React/)
})

test('requirement scoring supports uncatalogued skills, essential versus preferred weights, and evidence statuses', () => {
  const profile = { skills: ['Kafka', 'React'] }
  const requirements = ['kafka', 'react', 'distributed systems']
  const definitions = [
    { name: 'kafka', category: 'skill', importance: 'essential' },
    { name: 'react', category: 'skill', importance: 'preferred' },
    { name: 'distributed systems', category: 'experience', importance: 'essential' },
  ]
  const result = scoreCandidate(profile, 'Built production services with Kafka. No React experience. Designed distributed systems for event processing.', requirements, { skills: { kafka: 3, react: 1, 'distributed systems': 3 } }, definitions)
  assert.deepEqual(result.requirementResults.map((item) => item.status), ['supported', 'contradicted', 'supported'])
  assert.equal(result.score, 86)
  assert.match(result.requirementResults[0].excerpt, /Kafka/)
  assert.match(result.requirementResults[2].excerpt, /distributed systems/i)
})

test('resume education, project, and experience facts are retained only when source-grounded', () => {
  const profile = sourceGroundedProfile(validateProfile({
    skills: ['React'],
    education: [{ degree: 'Bachelor of Science', school: 'North College', year: '2024' }, { degree: 'Invented degree', school: 'Fake University' }],
    experience: [{ title: 'Student Developer', description: 'Built a React scheduling app.' }, { title: 'Invented Manager', description: 'Led a 20-person group.' }],
    projects: [{ title: 'Course Planner', description: 'Created a planner with React.' }, { title: 'Secret Platform', description: 'Unstated project.' }],
  }), 'Bachelor of Science, North College, 2024. Student Developer built a React scheduling app. Course Planner: created a planner with React.')
  assert.deepEqual(profile.skills, ['react'])
  assert.equal(profile.education.length, 1)
  assert.equal(profile.experience.length, 1)
  assert.equal(profile.projects.length, 1)
  assert.equal(profile.education[0].degree, 'Bachelor of Science')
  assert.equal(profile.experience[0].title, 'Student Developer')
  assert.equal(profile.projects[0].title, 'Course Planner')
})

test('protected traits do not affect deterministic skill matching or score', () => {
  const text = 'React and SQL engineer'
  const requirements = ['react', 'sql']
  const ordinary = scoreCandidate({ skills: ['React', 'SQL'] }, text, requirements)
  const withProtectedFields = scoreCandidate({ skills: ['React', 'SQL'], age: 63, gender: 'female', religion: 'example' }, text, requirements)
  assert.equal(withProtectedFields.score, ordinary.score)
  assert.deepEqual(withProtectedFields.matchedSkills, ordinary.matchedSkills)
})

test('resume cache fingerprint is stable and changes with content', () => {
  assert.equal(profileFingerprint('same resume'), profileFingerprint('same resume'))
  assert.notEqual(profileFingerprint('resume one'), profileFingerprint('resume two'))
})

test('recruitment tool registry rejects unknown tools and extra arguments', async () => {
  const registry = createRecruitmentToolRegistry()
  await assert.rejects(registry.execute('runShell', {}), /not allowed/)
  await assert.rejects(registry.execute('getJobRequirements', { jobDescription: 'x', shell: true }), /schema/)
  assert.ok(registry.names.includes('saveCandidateResult'))
})

test('Gemini quota exhaustion is not classified as retryable', () => {
  assert.equal(isRetryableGeminiError(Object.assign(new Error('Quota exceeded for this project'), { status: 429 })), false)
  assert.equal(isRetryableGeminiError(Object.assign(new Error('Service temporarily unavailable'), { status: 503 })), true)
})

test('recruiter skill priorities deterministically rescore saved candidate matches', () => {
  const candidate = { matchedSkills: ['react'] }
  const requirements = ['react', 'python']
  const equal = rescoreCandidate(candidate, requirements, { skills: { react: 1, python: 1 } })
  const prioritized = rescoreCandidate(candidate, requirements, { skills: { react: 5, python: 1 } })
  assert.equal(equal.score, 50)
  assert.equal(prioritized.score, 83)
})

test('original-file retries map by stable content fingerprint even when selected in a different order', () => {
  const file = (name, body) => ({ originalname: name, buffer: Buffer.from(body) })
  const ada = file('ada.pdf', 'ada resume')
  const grace = file('grace.pdf', 'grace resume')
  const stored = [
    { candidateId: 'candidate-ada', fileName: ada.originalname, fileFingerprint: resumeFileFingerprint(ada) },
    { candidateId: 'candidate-grace', fileName: grace.originalname, fileFingerprint: resumeFileFingerprint(grace) },
  ]
  const mapped = matchUploadedCandidates([
    { candidateId: 'positional-grace', legacyCandidateId: 'positional-grace', fileName: grace.originalname, fileFingerprint: resumeFileFingerprint(grace), file: grace },
    { candidateId: 'positional-ada', legacyCandidateId: 'positional-ada', fileName: ada.originalname, fileFingerprint: resumeFileFingerprint(ada), file: ada },
  ], stored)
  assert.deepEqual(mapped.map(({ candidateId }) => candidateId), ['candidate-grace', 'candidate-ada'])
})

test('original-file retries reject unknown and ambiguous candidate mappings', () => {
  const upload = { legacyCandidateId: 'legacy-id', fileName: 'wrong.pdf', fileFingerprint: 'fingerprint-x' }
  assert.throws(() => matchUploadedCandidates([upload], [{ candidateId: 'known', fileName: 'known.pdf', fileFingerprint: 'fingerprint-y' }]), { status: 400, message: /do not match/ })
  assert.throws(() => matchUploadedCandidates([upload], [
    { candidateId: 'one', fileFingerprint: 'fingerprint-x' },
    { candidateId: 'two', fileFingerprint: 'fingerprint-x' },
  ]), { status: 409, message: /multiple candidates/ })
  assert.throws(() => matchUploadedCandidates([upload, upload], [{ candidateId: 'one', fileFingerprint: 'fingerprint-x' }]), { status: 400, message: /duplicated/ })
})

test('file content fingerprints survive renames while legacy rows require an exact old candidate id', () => {
  const firstName = { originalname: 'original.pdf', buffer: Buffer.from('same bytes') }
  const renamed = { originalname: 'renamed.pdf', buffer: Buffer.from('same bytes') }
  assert.equal(resumeFileFingerprint(firstName), resumeFileFingerprint(renamed))
  const legacyUpload = { candidateId: 'old-id', legacyCandidateId: 'old-id', fileName: renamed.originalname, fileFingerprint: resumeFileFingerprint(renamed) }
  const exactLegacy = matchUploadedCandidates([legacyUpload], [{ candidateId: 'old-id', fileName: firstName.originalname, fileFingerprint: '' }])
  assert.equal(exactLegacy[0].candidateId, 'old-id')
  assert.throws(() => matchUploadedCandidates([{ ...legacyUpload, legacyCandidateId: 'wrong-id' }], [{ candidateId: 'old-id', fileFingerprint: '' }]), { status: 400, message: /do not match/ })
})

test('persisted resume source removes contact details before it can be used for recovery', () => {
  const safe = redactContactInformation('Email ada@example.com phone +1 555 123 4567\nReact engineer')
  assert.doesNotMatch(safe, /ada@example\.com|555 123 4567/)
  assert.match(safe, /React engineer/)
})

test('shortlist fixture ranks source-supported evidence and flags explicit mandatory gaps', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/recruiter-shortlist-evaluation.json', import.meta.url), 'utf8'))
  const weights = { skills: { 'node.js': 3, kafka: 3, postgresql: 2, kubernetes: 1, 'event-driven project': 3 } }
  const scored = fixture.candidates.map((candidate) => ({ ...candidate, ...scoreCandidate({ skills: candidate.skills }, candidate.resume, fixture.job.requirements, weights, fixture.job.definitions) }))
  const scoreById = Object.fromEntries(scored.map((candidate) => [candidate.id, candidate.score]))
  assert.ok(scoreById.strong > scoreById['keyword-overlap'])
  assert.ok(scoreById.strong > scoreById['mandatory-missing'])
  assert.ok(scoreById['project-first'] > scoreById.negative)
  assert.ok(scored.find((candidate) => candidate.id === 'negative').reviewFlags.some((flag) => /contrary evidence/.test(flag.reason)))
  assert.equal(classifyShortlist(scored.find((candidate) => candidate.id === 'mandatory-missing')).status, 'manual_review')
  assert.ok(fixture.additionalJob.requirements.includes('nats'), 'unfamiliar technologies are retained as job-specific requirements')
})
