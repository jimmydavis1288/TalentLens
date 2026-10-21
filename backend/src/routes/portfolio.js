import { Router } from 'express'
import { generatePortfolio } from '../controllers/portfolioController.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()
router.post('/', requireAuth, requireRole('job-seeker'), generatePortfolio)

export default router