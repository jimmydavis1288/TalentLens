import mongoose from 'mongoose'

const candidateSchema = new mongoose.Schema({
  candidateId: { type: String, required: true },
  fileName: { type: String, required: true },
  fileFingerprint: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'blocked'], default: 'pending' },
  profile: { type: mongoose.Schema.Types.Mixed, default: null },
  score: { type: Number, min: 0, max: 100, default: null },
  scoreBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
  matchedSkills: [{ type: String }],
  missingRequiredSkills: [{ type: String }],
  evidence: [{ skill: String, excerpt: String }],
  requirementResults: [{ type: mongoose.Schema.Types.Mixed }],
  evidenceCoverage: { type: Number, min: 0, max: 100, default: 0 },
  evidenceConfidence: { type: String, enum: ['high', 'moderate', 'limited', ''], default: '' },
  reviewFlags: [{ type: mongoose.Schema.Types.Mixed }],
  shortlistStatus: { type: String, enum: ['shortlisted', 'manual_review', 'not_shortlisted', ''], default: '' },
  shortlistReasons: [{ type: String }],
  jobSpecificExplanation: { type: String, default: '' },
  errorCategory: { type: String, default: '' },
  analysisMethod: { type: String, enum: ['gemini', 'deterministic-fallback', ''], default: '' },
  retryCount: { type: Number, default: 0 },
  leaseId: { type: String, default: '' },
  leaseExpiresAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false })

const analysisSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  requestKey: { type: String, required: true },
  requestFingerprint: { type: String, default: '' },
  jobTitle: { type: String, default: '' },
  jobDescription: { type: String, required: true },
  jobProfile: { type: mongoose.Schema.Types.Mixed, default: null },
  requirements: [{ type: String }],
  weights: { type: mongoose.Schema.Types.Mixed, default: { skills: {} } },
  shortlistCriteria: { type: mongoose.Schema.Types.Mixed, default: { minimumFitScore: 70, minimumEvidenceCoverage: 50 } },
  status: { type: String, enum: ['processing', 'completed', 'partial', 'blocked'], default: 'processing' },
  candidates: [candidateSchema],
}, { timestamps: true, optimisticConcurrency: true })

analysisSchema.index({ ownerId: 1, requestKey: 1 }, { unique: true })
export default mongoose.model('RecruitmentAnalysis', analysisSchema)
