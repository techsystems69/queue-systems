'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, RefreshCw } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * Mints a short-lived 6-digit code the installer types into the Flutter app's
 * setup wizard (Pair step). The app swaps it at POST /api/pair for the real
 * branch/screen token. Built for the kiosk tablet and the waiting-area TV,
 * which have no keyboard and no camera — see
 * `mobile/kiosk/lib/src/api/pair_api.dart`.
 *
 * Vertical-agnostic: the parent passes its own `createCode` server action
 * (`createDevicePairingCodeAction` for school, `createHospitalDevicePairingCodeAction`
 * for hospital) so this file never imports either vertical's action module.
 */
export interface CreatePairingCodeInput {
  branchId: string
  role: 'kiosk' | 'display'
  screenId?: string
  // School only: pair one of the branch's scoped kiosks instead of the
  // branch-wide kiosk.
  kioskId?: string
}
export type CreatePairingCodeAction = (
  input: CreatePairingCodeInput,
) => Promise<{ code?: string; expiresAt?: string; error?: string }>

export function DevicePairingDialog({
  branchId,
  role,
  screenId,
  kioskId,
  label,
  createCode,
}: {
  branchId: string
  role: 'kiosk' | 'display'
  screenId?: string
  kioskId?: string
  label: string
  createCode: CreatePairingCodeAction
}) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await createCode({ branchId, role, screenId, kioskId })
    setLoading(false)
    if (res.error || !res.code) {
      setError(res.error ?? 'Could not create a code')
      setCode(null)
      return
    }
    setCode(res.code)
    setExpiresAt(res.expiresAt ? new Date(res.expiresAt).getTime() : null)
  }, [branchId, role, screenId, kioskId, createCode])

  // Fresh code each time the dialog opens; clear it on close so a stale number
  // is never left on screen.
  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      generate()
    } else {
      setCode(null)
      setExpiresAt(null)
      setError(null)
    }
  }

  useEffect(() => {
    if (!expiresAt) return
    const tick = () => setRemaining(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  const expired = expiresAt != null && remaining === 0
  const mmss = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound className="size-3.5" />
          Pairing code
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {error ? (
            <p className="text-sm text-red-600 text-center">{error}</p>
          ) : code ? (
            <>
              <div
                className={`font-mono text-4xl font-bold tabular-nums tracking-[0.25em] ${
                  expired ? 'text-slate-300 line-through' : 'text-slate-900'
                }`}
              >
                {code}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                In the app&apos;s setup wizard — Pair step — type this code.{' '}
                {expired ? 'It has now expired.' : `Expires in ${mmss}.`}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Generating…</p>
          )}
          <Button variant="outline" size="sm" onClick={generate} disabled={loading}>
            <RefreshCw className="size-3.5" />
            New code
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
