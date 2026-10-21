import Skill from '../models/Skill.js'
import { canonicalSkillName, getSkillCatalog, normalizeSkillKey, validateSkillName } from '../services/skillCatalogService.js'

export async function listSkills(_req, res, next) {
  try {
    const persisted = await Skill.find({}, { name: 1, _id: 0 }).lean()
    return res.json({ skills: [...new Set([...getSkillCatalog(), ...persisted.map(({ name }) => name)])].sort() })
  } catch (error) { return next(error) }
}

export async function acceptSkill(req, res, next) {
  try {
    const skill = typeof req.body?.skill === 'string' ? req.body.skill.trim() : ''
    if (!validateSkillName(skill)) return res.status(400).json({ message: 'Enter a valid skill name.' })
    const key = canonicalSkillName(skill)
    const builtIn = getSkillCatalog().find((knownSkill) => normalizeSkillKey(knownSkill) === key)
    if (builtIn) return res.status(409).json({ message: 'That skill is already in the catalogue.', skill: builtIn })
    const existing = await Skill.findOne({ key }).lean()
    if (existing) return res.status(409).json({ message: 'That skill is already in the catalogue.', skill: existing.name })
    const saved = await Skill.create({ key, name: skill.replace(/\s+/g, ' ') })
    return res.status(201).json({ success: true, skill: saved.name })
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'That skill is already in the catalogue.' })
    return next(error)
  }
}