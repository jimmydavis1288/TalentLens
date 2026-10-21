import mongoose from 'mongoose'

const skillSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 50 },
}, { timestamps: true })

export default mongoose.model('Skill', skillSchema)