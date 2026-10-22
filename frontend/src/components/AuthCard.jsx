import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Eye, EyeOff, Mail } from 'lucide-react'
import InputField from './InputField'
import RoleToggle from './RoleToggle'
import SocialButtons from './SocialButtons'

function AuthCard({ selectedRole, onRoleChange, mode, onModeChange, onSubmit, loading, message }) {
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const isForgotPassword = mode === 'forgot'

  function updateField(event) {
    setForm({ ...form, [event.target.name]: event.target.value })
  }

  function handleSubmit(event) {
    event.preventDefault()
    onSubmit(form)
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 42 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.21, 1, 0.29, 1] }}
      className="glass-panel w-full max-w-[420px] rounded-[28px] border border-white/70 bg-white/88 p-7 shadow-[0_32px_80px_rgba(15,23,42,0.12)] sm:p-6"
      aria-labelledby="auth-title"
    >
      <div className="mb-4">
        <h2
          id="auth-title"
          className="text-3xl font-semibold tracking-[-0.05em] text-slate-950"
        >
          {isForgotPassword ? 'Reset your password' : mode === 'register' ? 'Create your account' : 'Welcome to TalentLens'}
        </h2>
      </div>

      <div className="space-y-4">
        {!isForgotPassword ? <div>
          <p className="mb-3 text-sm font-medium text-slate-700">Continue As</p>
          <RoleToggle selectedRole={selectedRole} onChange={onRoleChange} />
        </div> : null}

        <form className="space-y-3" onSubmit={handleSubmit}>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-[44px] right-4 h-4 w-4 text-slate-400" />
            <InputField
              id="email"
              label="Email Address"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={updateField}
            />
          </div>

          <div className="relative">
            <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)} className="absolute top-[39px] right-3 z-10 cursor-pointer rounded-lg p-1 text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
            <InputField
              id="password"
              label={isForgotPassword ? 'New Password' : 'Password'}
              type={showPassword ? 'text' : 'password'}
              placeholder={isForgotPassword ? 'Choose a new password' : 'Enter your password'}
              value={form.password}
              onChange={updateField}
            />
          </div>

          {!isForgotPassword ? <div className="flex items-center justify-between gap-4 text-sm">
            <label className="inline-flex cursor-pointer items-center gap-3 text-slate-500">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Remember Me
            </label>
            <a
              href="/"
              onClick={(event) => {
                event.preventDefault()
                onModeChange('forgot')
              }}
              className="cursor-pointer font-medium text-slate-600 transition duration-300 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              Forgot Password?
            </a>
          </div> : null}

          <button
            type="submit"
            className="button-ripple inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3.5 text-sm font-medium text-white shadow-[0_22px_45px_rgba(15,23,42,0.22)] transition duration-300 hover:-translate-y-0.5 hover:scale-[1.01] hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            {loading ? 'Please wait...' : isForgotPassword ? 'Reset Password' : mode === 'register' ? 'Create Account' : 'Sign In'}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>

        {!isForgotPassword ? <div className="flex items-center gap-4 text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          OR
          <span className="h-px flex-1 bg-slate-200" />
        </div> : null}

        {!isForgotPassword ? <SocialButtons onUnavailable={(provider) => window.alert(`${provider} authentication will be available once its OAuth credentials are added to .env.`)} /> : null}
      </div>

      {message ? <p className="mt-4 text-center text-xs font-medium text-rose-600" role="alert">{message}</p> : null}
      <p className="mt-4 text-center text-sm text-slate-500">
        {isForgotPassword ? 'Remembered your password? ' : mode === 'register' ? 'Already have an account? ' : "Don't have an account? "}
        <button
          type="button"
          onClick={() => onModeChange(isForgotPassword || mode === 'register' ? 'login' : 'register')}
          className="inline-flex cursor-pointer font-semibold text-slate-950 transition duration-300 hover:translate-x-0.5 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          {isForgotPassword || mode === 'register' ? 'Sign In' : 'Create Account'}
        </button>
      </p>
    </motion.section>
  )
}

export default AuthCard
