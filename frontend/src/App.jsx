import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import RecruiterDashboard from './pages/RecruiterDashboard'
import JobSeekerDashboard from './pages/JobSeekerDashboard'
import ProtectedRoute from './components/ProtectedRoute'
import PortfolioPage from './pages/PortfolioPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/recruiter" element={<ProtectedRoute role="recruiter"><RecruiterDashboard /></ProtectedRoute>} />
      <Route path="/job-seeker" element={<ProtectedRoute role="job-seeker"><JobSeekerDashboard /></ProtectedRoute>} />
      <Route path="/portfolio" element={<ProtectedRoute role="job-seeker"><PortfolioPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
