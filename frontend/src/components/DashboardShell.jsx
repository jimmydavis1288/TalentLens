import { LogOut } from 'lucide-react'
import Logo from './Logo'

function DashboardShell({ title, subtitle, children }) {
  function logout() {
    localStorage.removeItem('jobekaa_token')
    localStorage.removeItem('jobekaa_user')
    window.location.assign('/')
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-12 flex items-center justify-between gap-4">
          <Logo />
          <button type="button" onClick={logout} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-950">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </header>
        <section className="mb-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">TalentLens workspace</p>
          <h1 className="text-4xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-5xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-slate-600">{subtitle}</p>
        </section>
        {children}
      </div>
    </main>
  )
}

export default DashboardShell
