import mongoose from 'mongoose'

const sourceSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  analysisId: { type: mongoose.Schema.Types.ObjectId, required: true },
  candidateId: { type: String, required: true },
  text: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true })

sourceSchema.index({ ownerId: 1, analysisId: 1, candidateId: 1 }, { unique: true })
export default mongoose.model('RecruitmentResumeSource', sourceSchema)
