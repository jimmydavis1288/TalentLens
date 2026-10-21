import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { recommendedJobs } from '../controllers/jobController.js'
const router = Router()
router.get('/recommended', requireAuth, requireRole('job-seeker'), recommendedJobs)
router.post('/recommended', requireAuth, requireRole('job-seeker'), recommendedJobs)
export default router
