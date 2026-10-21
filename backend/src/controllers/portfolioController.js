import { buildPortfolio } from '../services/portfolioService.js'

export function generatePortfolio(req, res, next) {
  try {
    const portfolio = buildPortfolio(req.body?.resume)
    return res.json({ success: true, portfolio, message: Object.keys(portfolio).length ? '' : 'No summary, skills, projects, education, experience, or certifications were available in the extracted resume data. Try analyzing the resume again or verify its extracted sections.' })
  } catch (error) { return error.status ? res.status(error.status).json({ message: error.message }) : next(error) }
}