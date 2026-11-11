import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import {
  activateCompatibleAppShellUpdate,
  watchCompatibleAppShellUpdates,
} from './lib/app-shell'
import type { AppShellUpdateNotice } from './lib/app-shell'

function AppShellUpdatePrompt() {
  const [notice, setNotice] = useState<AppShellUpdateNotice | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => watchCompatibleAppShellUpdates(setNotice), [])
  useEffect(() => {
    if (notice?.multipleTabs) setApplying(false)
  }, [notice?.multipleTabs])

  if (!notice) return null
  return (
    <aside
      aria-label="Application update"
      className="fixed bottom-4 left-4 right-4 z-[100] mx-auto flex max-w-xl flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl sm:flex-row sm:items-center sm:justify-between"
      role={notice.compatible ? 'status' : 'alert'}
    >
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{notice.compatible ? 'KodiGo update ready' : 'KodiGo update paused'}</p>
        <p className="mt-1 text-slate-600">
          {notice.multipleTabs
            ? 'Close other KodiGo tabs, then retry the update.'
            : notice.compatible
              ? 'Saved offline work is compatible with this version.'
              : notice.reason}
        </p>
      </div>
      {notice.compatible && (
        <button
          className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          disabled={applying}
          onClick={async () => {
            setApplying(true)
            const started = await activateCompatibleAppShellUpdate(notice.registration)
            if (!started) {
              setNotice({
                registration: notice.registration,
                compatible: false,
                reason: 'Offline data changed while the update was checked. Reopen the app and resolve saved work before updating.',
              })
              setApplying(false)
            }
          }}
          type="button"
        >
          {applying ? 'Updating…' : 'Update KodiGo'}
        </button>
      )}
    </aside>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <>
      <App />
      <AppShellUpdatePrompt />
    </>
  </StrictMode>,
)
