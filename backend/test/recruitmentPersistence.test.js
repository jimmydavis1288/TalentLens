import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import mongoose from 'mongoose'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { once } from 'node:events'
import { getRecruitmentAnalysis, resumeRecruitmentAnalysis, updateRecruitmentWeights } from '../src/controllers/analysisController.js'
import RecruitmentAnalysis from '../src/models/RecruitmentAnalysis.js'
import RecruitmentResumeSource from '../src/models/RecruitmentResumeSource.js'
import { blockPendingRecruitmentCandidates, claimRecruitmentCandidate, compareAndSetRecruiterScoring, findOwnedRecruitmentAnalysis } from '../src/services/recruitmentRepository.js'
import { resetGeminiClientFactory, setGeminiClientFactory, withGeminiRetry } from '../src/services/resumePipelineService.js'

function locateMongod() {
  if (process.env.MONGOD_BIN) return process.env.MONGOD_BIN
  if (process.platform === 'win32') {
    const known = 'C:\\Program Files\\MongoDB\\Server\\8.3\\bin\\mongod.exe'
    if (existsSync(known)) return known
    const found = spawnSync('where.exe', ['mongod'], { encoding: 'utf8' })
    return found.status === 0 ? found.stdout.split(/\r?\n/)[0] : null
  }
  const found = spawnSync('which', ['mongod'], { encoding: 'utf8' })
  return found.status === 0 ? found.stdout.trim() : null
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

test('MongoDB recruitment recovery, ownership, idempotency, leases, and optimistic score updates', { skip: !locateMongod() && 'mongod is unavailable; set MONGOD_BIN to run persistence integration tests' }, async (t) => {
  const executable = locateMongod()
  const directory = await mkdtemp(path.join(os.tmpdir(), 'talentlens-mongodb-'))
  const port = await freePort()
  const child = spawn(executable, ['--dbpath', directory, '--port', String(port), '--bind_ip', '127.0.0.1', '--quiet'], { stdio: ['ignore', 'ignore', 'ignore'] })
  const uri = `mongodb://127.0.0.1:${port}/talentlens_test_${process.pid}`

  t.after(async () => {
    await mongoose.disconnect().catch(() => {})
    if (child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))])
    }
    await rm(directory, { recursive: true, force: true })
  })

  let connected = false
  for (let attempt = 0; attempt < 40 && !connected; attempt += 1) {
    try { await mongoose.connect(uri, { serverSelectionTimeoutMS: 400 }); connected = true }
    catch { await new Promise((resolve) => setTimeout(resolve, 150)) }
  }
  assert.equal(connected, true, 'temporary mongod should become available')
  await Promise.all([RecruitmentAnalysis.init(), RecruitmentResumeSource.init()])

  const ownerA = new mongoose.Types.ObjectId()
  const ownerB = new mongoose.Types.ObjectId()
  const candidateId = 'candidate-stable-01'
  const analysis = await RecruitmentAnalysis.create({
    ownerId: ownerA, requestKey: 'request-once', jobDescription: 'React and Python role requirements',
    requirements: ['react', 'python'], weights: { skills: { react: 1, python: 1 } },
    candidates: [{ candidateId, fileName: 'ada.pdf', status: 'processing', updatedAt: new Date(Date.now() - 10 * 60_000) }, { candidateId: 'candidate-lost-source', fileName: 'lost.pdf', status: 'processing', updatedAt: new Date(Date.now() - 10 * 60_000) }],
  })

  const responseFor = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } })
  const next = (error) => { throw error }
  const ownerView = responseFor()
  await getRecruitmentAnalysis({ params: { id: analysis._id }, user: { id: ownerA } }, ownerView, next)
  assert.equal(ownerView.statusCode, 200)
  const foreignView = responseFor()
  await getRecruitmentAnalysis({ params: { id: analysis._id }, user: { id: ownerB } }, foreignView, next)
  assert.equal(foreignView.statusCode, 404, 'the API controller denies cross-recruiter reads')
  const foreignUpdate = responseFor()
  await updateRecruitmentWeights({ params: { id: analysis._id }, user: { id: ownerB }, body: { weights: {} } }, foreignUpdate, next)
  assert.equal(foreignUpdate.statusCode, 404, 'the API controller denies cross-recruiter score updates')

  assert.equal(String((await findOwnedRecruitmentAnalysis(RecruitmentAnalysis, analysis._id, ownerA))._id), String(analysis._id))
  assert.equal(await findOwnedRecruitmentAnalysis(RecruitmentAnalysis, analysis._id, ownerB), null, 'another recruiter must not read the analysis')

  await RecruitmentResumeSource.create({ ownerId: ownerA, analysisId: analysis._id, candidateId, text: 'Ada built React apps with Python.', expiresAt: new Date(Date.now() + 86400_000) })
  const savedText = await RecruitmentResumeSource.findOne({ ownerId: ownerA, analysisId: analysis._id, candidateId }).select('+text').lean()
  assert.equal(savedText.text, 'Ada built React apps with Python.')
  assert.equal(await RecruitmentResumeSource.findOne({ ownerId: ownerB, analysisId: analysis._id, candidateId }).select('+text'), null)
  assert.equal(await RecruitmentResumeSource.findOne({ ownerId: ownerA, analysisId: analysis._id, candidateId: 'candidate-lost-source' }).select('+text'), null, 'recovery must not claim unavailable source text exists')
  const resumableView = responseFor()
  await getRecruitmentAnalysis({ params: { id: analysis._id }, user: { id: ownerA } }, resumableView, next)
  assert.equal(resumableView.body.candidates.find((candidate) => candidate.candidateId === candidateId).canResume, true)
  await RecruitmentResumeSource.updateOne({ ownerId: ownerA, analysisId: analysis._id, candidateId }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
  const expiredView = responseFor()
  await getRecruitmentAnalysis({ params: { id: analysis._id }, user: { id: ownerA } }, expiredView, next)
  assert.equal(expiredView.body.candidates.find((candidate) => candidate.candidateId === candidateId).canResume, false, 'expired source text is not advertised as resumable')
  await RecruitmentResumeSource.updateOne({ ownerId: ownerA, analysisId: analysis._id, candidateId }, { $set: { expiresAt: new Date(Date.now() + 86400_000) } })

  const originalApiKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'test-key'
  setGeminiClientFactory(() => ({ models: { generateContent: async () => ({ text: JSON.stringify({ name: 'Ada', skills: ['React', 'Python'] }) }) } }))
  try {
    const mismatchedFile = responseFor()
    const handleMappedFileError = (error) => mismatchedFile.status(error.status || 500).json({ message: error.message })
    await resumeRecruitmentAnalysis({ params: { id: analysis._id }, user: { id: ownerA }, files: [{ originalname: 'wrong.pdf', buffer: Buffer.from('%PDF- not the original candidate file') }] }, mismatchedFile, handleMappedFileError)
    assert.equal(mismatchedFile.statusCode, 400, 'a mismatched original file is reported before candidate processing')
    assert.match(mismatchedFile.body.message, /do not match/)

    const resumeResponse = responseFor()
    await resumeRecruitmentAnalysis({ params: { id: analysis._id }, user: { id: ownerA }, files: [] }, resumeResponse, next)
    assert.equal(resumeResponse.statusCode, 202, 'persisted source is accepted without an upload')
    let resumed
    for (let attempt = 0; attempt < 50; attempt += 1) {
      resumed = await RecruitmentAnalysis.findById(analysis._id)
      if (resumed.candidates[0].status === 'completed') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(resumed.candidates[0].status, 'completed', 'the interrupted candidate resumes from persisted extracted text')
    assert.deepEqual(resumed.candidates[0].matchedSkills, ['react', 'python'])
    assert.equal(await RecruitmentResumeSource.findOne({ ownerId: ownerA, analysisId: analysis._id, candidateId }), null, 'source text is removed after successful completion')
    assert.equal(resumed.candidates[1].errorCategory, 'source_not_persisted', 'recovery reports when extraction never made it to durable storage')
  } finally {
    resetGeminiClientFactory()
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalApiKey
  }

  const duplicate = await Promise.allSettled([
    RecruitmentAnalysis.create({ ownerId: ownerA, requestKey: 'duplicate-key', jobDescription: 'React and Python role requirements' }),
    RecruitmentAnalysis.create({ ownerId: ownerA, requestKey: 'duplicate-key', jobDescription: 'React and Python role requirements' }),
  ])
  assert.equal(duplicate.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(duplicate.filter((result) => result.status === 'rejected' && result.reason.code === 11000).length, 1)

  const leaseResults = await Promise.all([
    claimRecruitmentCandidate(RecruitmentAnalysis, { analysisId: analysis._id, ownerId: ownerA, candidateId: 'candidate-lost-source', leaseId: 'lease-a' }),
    claimRecruitmentCandidate(RecruitmentAnalysis, { analysisId: analysis._id, ownerId: ownerA, candidateId: 'candidate-lost-source', leaseId: 'lease-b' }),
  ])
  assert.equal(leaseResults.reduce((sum, result) => sum + result.modifiedCount, 0), 1, 'only one retry request may claim a candidate')
  await RecruitmentAnalysis.updateOne({ _id: analysis._id, 'candidates.candidateId': 'candidate-lost-source' }, { $set: { 'candidates.$.leaseExpiresAt': new Date(Date.now() - 1000), 'candidates.$.updatedAt': new Date() } })
  const expiredLease = await claimRecruitmentCandidate(RecruitmentAnalysis, { analysisId: analysis._id, ownerId: ownerA, candidateId: 'candidate-lost-source', leaseId: 'lease-after-expiry' })
  assert.equal(expiredLease.modifiedCount, 1, 'a candidate can be reclaimed when its lease expires even if updatedAt is recent')

  const busyVersion = (await RecruitmentAnalysis.findById(analysis._id)).__v
  const busyCandidates = (await RecruitmentAnalysis.findById(analysis._id)).candidates
  assert.equal((await compareAndSetRecruiterScoring(RecruitmentAnalysis, { analysisId: analysis._id, ownerId: ownerA, version: busyVersion, weights: {}, candidates: busyCandidates })).modifiedCount, 0, 'scoring updates cannot replace an active candidate lease')
  await RecruitmentAnalysis.updateOne({ _id: analysis._id }, { $set: { 'candidates.0.status': 'completed', 'candidates.1.status': 'failed' } })
  const scoreVersion = (await RecruitmentAnalysis.findById(analysis._id)).__v
  const currentCandidates = (await RecruitmentAnalysis.findById(analysis._id)).candidates
  const scoreWrites = await Promise.all([
    compareAndSetRecruiterScoring(RecruitmentAnalysis, { analysisId: analysis._id, ownerId: ownerA, version: scoreVersion, weights: { skills: { react: 5, python: 1 } }, candidates: currentCandidates }),
    compareAndSetRecruiterScoring(RecruitmentAnalysis, { analysisId: analysis._id, ownerId: ownerA, version: scoreVersion, weights: { skills: { react: 1, python: 5 } }, candidates: currentCandidates }),
  ])
  assert.equal(scoreWrites.reduce((sum, result) => sum + result.modifiedCount, 0), 1, 'concurrent scoring changes must not silently overwrite each other')
  assert.equal((await compareAndSetRecruiterScoring(RecruitmentAnalysis, { analysisId: analysis._id, ownerId: ownerB, version: scoreVersion + 1, weights: {}, candidates: [] })).modifiedCount, 0, 'a different owner cannot update scores')

  await RecruitmentAnalysis.updateOne({ _id: analysis._id }, { $set: { 'candidates.1.status': 'failed', 'candidates.1.errorCategory': 'source_not_persisted', 'candidates.0.status': 'completed' } })
  const partial = await RecruitmentAnalysis.findById(analysis._id).lean()
  assert.equal(partial.candidates[0].status, 'completed', 'finished candidates survive partial failure')
  assert.equal(partial.candidates[1].errorCategory, 'source_not_persisted')

  await RecruitmentAnalysis.updateOne({ _id: analysis._id }, { $set: { 'candidates.1.status': 'pending' } })
  await blockPendingRecruitmentCandidates(RecruitmentAnalysis, { analysisId: analysis._id, ownerId: ownerB })
  assert.equal((await RecruitmentAnalysis.findById(analysis._id)).candidates[1].status, 'pending', 'quota handling cannot alter another recruiter’s analysis')
  await blockPendingRecruitmentCandidates(RecruitmentAnalysis, { analysisId: analysis._id, ownerId: ownerA })
  const afterQuota = await RecruitmentAnalysis.findById(analysis._id).lean()
  assert.equal(afterQuota.candidates[0].status, 'completed', 'quota exhaustion preserves completed candidate results')
  assert.equal(afterQuota.candidates[1].status, 'blocked')
  assert.equal(afterQuota.candidates[1].errorCategory, 'quota_exhausted')
})

test('quota exhaustion does not cause repeated Gemini requests', async () => {
  let attempts = 0
  await assert.rejects(withGeminiRetry('quota test', async () => {
    attempts += 1
    throw Object.assign(new Error('Quota exceeded'), { status: 429 })
  }, { maxAttempts: 3 }))
  assert.equal(attempts, 1)
})
