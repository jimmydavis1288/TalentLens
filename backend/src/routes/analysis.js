import { Router } from 'express'
import multer from 'multer'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { analyzeResume, getRecruitmentAnalysis, matchCandidates, resumeRecruitmentAnalysis, reviewRecruitmentRequirements, updateRecruitmentWeights } from '../controllers/analysisController.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 50 } })
const recruiterUpload = upload.fields([{ name: 'resumes', maxCount: 50 }, { name: 'jobDescriptionFile', maxCount: 1 }])
function enforceRecruiterAggregateLimit(req, res, next) {
  const files = Object.values(req.files || {}).flat()
  const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0)
  if (totalBytes > 100 * 1024 * 1024) return res.status(413).json({ success: false, code: 'UPLOAD_BATCH_TOO_LARGE', message: 'The complete upload batch must be 100MB or smaller. Split it into smaller batches and retry.' })
  return next()
}
router.post('/recruiter/match', requireAuth, requireRole('recruiter'), recruiterUpload, enforceRecruiterAggregateLimit, matchCandidates)
router.post('/recruiter/analyses', requireAuth, requireRole('recruiter'), recruiterUpload, enforceRecruiterAggregateLimit, matchCandidates)
router.post('/recruiter/requirements', requireAuth, requireRole('recruiter'), upload.fields([{ name: 'jobDescriptionFile', maxCount: 1 }]), reviewRecruitmentRequirements)
router.get('/recruiter/analyses/:id', requireAuth, requireRole('recruiter'), getRecruitmentAnalysis)
router.get('/recruiter/analyses/:id/status', requireAuth, requireRole('recruiter'), getRecruitmentAnalysis)
router.get('/recruiter/analyses/:id/rankings', requireAuth, requireRole('recruiter'), getRecruitmentAnalysis)
router.patch('/recruiter/analyses/:id/weights', requireAuth, requireRole('recruiter'), updateRecruitmentWeights)
router.patch('/recruiter/analyses/:id/shortlist', requireAuth, requireRole('recruiter'), updateRecruitmentWeights)
router.post('/recruiter/analyses/:id/resume', requireAuth, requireRole('recruiter'), upload.array('resumes', 50), resumeRecruitmentAnalysis)
router.post('/job-seeker/analyze', requireAuth, requireRole('job-seeker'), upload.single('resume'), analyzeResume)
router.post('/resume', requireAuth, requireRole('job-seeker'), upload.single('resume'), analyzeResume)

export default router
