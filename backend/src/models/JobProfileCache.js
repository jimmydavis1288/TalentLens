import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  fingerprint: { type: String, required: true, unique: true },
  profile: { type: mongoose.Schema.Types.Mixed, required: true },
  schemaVersion: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true })

export default mongoose.model('JobProfileCache', schema)
