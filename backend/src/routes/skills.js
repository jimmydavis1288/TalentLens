import { Router } from 'express'
import { acceptSkill, listSkills } from '../controllers/skillController.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()
router.get('/', requireAuth, requireRole('job-seeker'), listSkills)
router.post('/', requireAuth, requireRole('job-seeker'), acceptSkill)

export default router