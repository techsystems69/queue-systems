'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  MonitorCheck, PhoneCall, BellRing, CheckCircle2, PauseCircle, ArrowRightLeft, Plus,
} from 'lucide-react'
import {
  ConsoleFrame, ConsoleLoading, TaskSplit, ElapsedPill,
  ConfirmCancel, useNow, minutesSince,
} from '@/components/counter/console'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import {
  schoolCallNextAction, schoolCallCodeAction, schoolRecallAction,
  schoolDoneAction, schoolNoShowAction, schoolHoldAction, schoolTransferAction,
  schoolCounterHeartbeatAction, schoolToggleCounterOpenAction, schoolIssueAtCounterAction,
} from '@/lib/actions/school-tokens'
import { fetchSchoolCounterViewAction, type SchoolCounterView } from '@/lib/actions/school-read'

const MAX_CODE_LENGTH = 8
const POLL_MS = 15000
const HEARTBEAT_MS = 20000

/*
 * The calling station, running on any operator PC.
 *
 * Ordered by how often a clerk actually does it: press Next, tap the token you
 * want out of the lane, or hand a walk-in a new one. A token number can still
 * be typed, for a queue deeper than the lane shows and for whatever a USB
 * calling keypad sends — that hardware enumerates as a keyboard and lands in
 * the window keydown handler below, independent of anything on screen.
 */
export function SchoolCounterConsole({ counterToken, initial }: {
  counterToken: string
  initial: SchoolCounterView
}) {
  const [view, setView] = useState(initial)
  const [code, setCode] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [issueOpen, setIssueOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const now = useNow()

  const refresh = useCallback(async () => {
    const next = await fetchSchoolCounterViewAction(counterToken)
    if (next.status === 'ok') setView(next)
  }, [counterToken])

  // These tables are service-role-only, so the console can't subscribe to
  // postgres_changes with the publishable key — it polls instead. Fifteen
  // seconds is well inside the time it takes to serve one visitor, and every
  // clerk action already calls refresh() straight away. Polling stops while the
  // tab is hidden — an unattended terminal shouldn't keep hitting the function
  // — and catches up on the way back.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined
    const start = () => {
      if (id === undefined) id = setInterval(refresh, POLL_MS)
    }
    const stop = () => {
      if (id !== undefined) { clearInterval(id); id = undefined }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { refresh(); start() }
      else stop()
    }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [refresh])

  useEffect(() => {
    schoolCounterHeartbeatAction(counterToken)
    const id = setInterval(() => schoolCounterHeartbeatAction(counterToken), HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [counterToken])

  const current = view.current
  const waiting = view.waiting ?? []
  const departments = view.departments ?? []
  const issuable = view.issuable ?? []
  const noShows = view.noShows ?? []
  const deptById = new Map(departments.map((d) => [d.id, d]))

  const run = useCallback((
    fn: () => Promise<{ error?: string }>,
    success?: (r: { error?: string }) => string | null
  ) => {
    startTransition(async () => {
      const result = await fn()
      if (result.error) toast.error(result.error)
      else {
        const message = success?.(result)
        if (message) toast.success(message)
      }
      await refresh()
    })
  }, [refresh])

  const callNext = useCallback(() => {
    run(
      () => schoolCallNextAction(counterToken),
      (r) => `Calling ${(r as { token?: { tokenCode: string } }).token?.tokenCode ?? ''}`
    )
  }, [counterToken, run])

  const callCode = useCallback((value: string) => {
    run(() => schoolCallCodeAction(counterToken, value), () => `Calling ${value.toUpperCase()}`)
  }, [counterToken, run])

  const callTyped = useCallback(() => {
    const value = code.trim()
    if (!value) return
    callCode(value)
    setCode('')
  }, [code, callCode])

  const recall = useCallback(() => {
    run(() => schoolRecallAction(counterToken), () => 'Called again')
  }, [counterToken, run])

  const markDone = useCallback(() => {
    run(() => schoolDoneAction(counterToken), () => 'Marked served')
  }, [counterToken, run])

  const markNoShow = useCallback(() => {
    run(() => schoolNoShowAction(counterToken), () => 'Marked no-show')
  }, [counterToken, run])

  const hold = useCallback(() => {
    run(() => schoolHoldAction(counterToken), () => 'Put on hold')
  }, [counterToken, run])

  /*
   * Hardware calling keypad. A USB keypad enumerates as a plain keyboard, so
   * no driver or endpoint is needed — the keystrokes land here. Two things
   * this has to get right:
   *   - the token field is focusable and handles its own typing, so events
   *     originating in an input are ignored here to avoid double-entry;
   *   - keys are read as a stream, not per-keystroke state, so a keypad that
   *     sends its digits in a burst behaves the same as a person typing.
   */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        setCode((prev) => (prev + e.key).slice(0, MAX_CODE_LENGTH))
        return
      }
      if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault()
        setCode((prev) => (prev + e.key.toUpperCase()).slice(0, MAX_CODE_LENGTH))
        return
      }
      switch (e.key) {
        case 'Enter':
          e.preventDefault()
          // Enter with nothing typed is the natural "just give me the next
          // one" gesture, and matches how the physical NEXT key behaves.
          if (code.trim()) callTyped()
          else callNext()
          break
        case 'Backspace':
          e.preventDefault()
          setCode((prev) => prev.slice(0, -1))
          break
        case 'Escape':
          e.preventDefault()
          setCode('')
          break
        case '+':
          e.preventDefault()
          callNext()
          break
        case '-':
          e.preventDefault()
          markNoShow()
          break
        case '*':
          e.preventDefault()
          recall()
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [code, callTyped, callNext, markNoShow, recall])

  if (view.status !== 'ok') return <ConsoleLoading icon={MonitorCheck} />

  return (
    <ConsoleFrame
      icon={MonitorCheck}
      name={view.counterName ?? 'Counter'}
      typeLabel="Calling Station"
      headerRight={
        <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
          {view.isOpen ? 'Open' : 'Closed'}
          <Switch
            checked={!!view.isOpen}
            disabled={pending}
            onCheckedChange={() => {
              startTransition(async () => {
                const r = await schoolToggleCounterOpenAction(counterToken)
                if (r.error) toast.error(r.error)
                else {
                  setView((prev) => ({ ...prev, isOpen: r.isOpen }))
                  toast.success(r.isOpen ? 'Counter open' : 'Counter closed')
                }
              })
            }}
          />
        </label>
      }
      banner={
        departments.length === 0 ? (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm font-medium text-amber-800">
            No departments are assigned to this counter yet, so Next has nothing to call.
          </div>
        ) : undefined
      }
    >
      <TaskSplit
        task={
          <div className="flex h-full flex-col gap-3">
            {/* Current token */}
            <div
              className={
                current
                  ? 'flex min-h-0 flex-1 flex-col rounded-2xl border border-accent-200 bg-accent-50 p-4'
                  : 'flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white p-4'
              }
            >
              {/* Takes the slack the Next tile no longer does. The number is
                  the one thing on this panel worth reading from a step back,
                  so it scales with the space instead of a button doing it. */}
              <div className="flex flex-1 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    Now serving
                  </p>
                  <p
                    dir="ltr"
                    className="font-mono font-black tabular-nums leading-none text-slate-800"
                    style={{ fontSize: 'clamp(2.75rem, 7vh, 5rem)' }}
                  >
                    {current?.tokenCode ?? '—'}
                  </p>
                  {current && (
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {deptById.get(current.departmentId)?.nameEn ?? ''}
                      {current.isPriority && ' · Priority'}
                      {current.recallCount > 0 && ` · Called again ×${current.recallCount}`}
                    </p>
                  )}
                </div>
                {current?.calledAt && (
                  <ElapsedPill mins={minutesSince(current.calledAt, now)} />
                )}
              </div>

              {current && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={markDone}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent-600 text-sm font-bold text-white shadow-sm transition active:translate-y-px disabled:opacity-40"
                  >
                    <CheckCircle2 className="size-4.5" />
                    Done
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={recall}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700 shadow-sm transition active:translate-y-px active:bg-slate-50 disabled:opacity-40"
                  >
                    <BellRing className="size-4.5" />
                    Call Again
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={hold}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700 shadow-sm transition active:translate-y-px active:bg-slate-50 disabled:opacity-40"
                  >
                    <PauseCircle className="size-4.5" />
                    Hold
                  </button>
                  <ConfirmCancel onConfirm={markNoShow} disabled={pending} label="No Show" />
                  {departments.length > 1 && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setTransferOpen(true)}
                      className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700 shadow-sm transition active:translate-y-px active:bg-slate-50 disabled:opacity-40"
                    >
                      <ArrowRightLeft className="size-4.5" />
                      Send to another department
                    </button>
                  )}
                </div>
              )}
            </div>

            {/*
             * NEXT is the whole job: it is what a clerk presses for all but a
             * handful of visitors, so it gets the largest target on the screen.
             * The 3x4 keypad that used to live here took ~60% of the console to
             * serve a case that is now one tap in the waiting lane — and it
             * could never type a letter, so it couldn't even reach F101 on a
             * touchscreen. The USB calling keypad is unaffected: it enumerates
             * as a keyboard and lands in the window keydown handler above,
             * which never went through these buttons.
             */}
            {/*
             * Bento: three tiles, sized by how often each is used rather than
             * stretched to fill. Next is the largest — three of five columns,
             * both rows — but capped, because a button the height of the screen
             * reads as an empty panel, not as emphasis. Spare vertical space
             * goes to the token number above, where it is information.
             */}
            <div className="grid h-44 shrink-0 grid-cols-5 grid-rows-2 gap-2.5">
              <button
                type="button"
                disabled={pending || departments.length === 0}
                onClick={callNext}
                className="col-span-3 row-span-2 flex flex-col items-center justify-center gap-1.5 rounded-3xl bg-accent-600 text-white shadow-sm transition active:translate-y-px active:bg-accent-700 disabled:opacity-40"
              >
                <BellRing className="size-8" />
                <span className="text-2xl font-black tracking-tight">Next</span>
                <span className="text-xs font-medium text-accent-50/80">
                  {waiting.length > 0 ? `${waiting.length} waiting` : 'Nobody is waiting'}
                </span>
              </button>

              <button
                type="button"
                disabled={pending || issuable.length === 0}
                onClick={() => setIssueOpen(true)}
                className="col-span-2 flex flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed border-slate-300 bg-white text-slate-700 transition active:translate-y-px hover:border-accent-400 hover:bg-accent-50/40 hover:text-accent-700 disabled:opacity-40"
              >
                <Plus className="size-6" />
                <span className="text-sm font-bold leading-tight">New token</span>
                <span className="text-[11px] font-medium text-slate-400">for a walk-in</span>
              </button>

              {/* The two cases the lane can't cover: a queue deeper than it
                  shows, and whatever a USB keypad types. inputMode="numeric"
                  raises the OS pad on demand rather than a grid sitting there
                  all day. */}
              <div
                dir="ltr"
                className="col-span-2 flex items-stretch gap-2 rounded-3xl border border-slate-200 bg-white p-1.5"
              >
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, MAX_CODE_LENGTH))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); callTyped() } }}
                  inputMode="numeric"
                  placeholder="Token no."
                  aria-label="Token number"
                  className="min-w-0 flex-1 rounded-2xl bg-slate-50 px-3 text-center font-mono text-xl font-black tabular-nums text-slate-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-accent-500/40 placeholder:font-sans placeholder:text-xs placeholder:font-medium placeholder:text-slate-400"
                />
                <button
                  type="button"
                  disabled={pending || !code.trim()}
                  onClick={callTyped}
                  className="flex w-20 shrink-0 items-center justify-center gap-1 rounded-2xl bg-slate-700 text-xs font-bold text-white transition active:translate-y-px active:bg-slate-800 disabled:opacity-25"
                >
                  <PhoneCall className="size-3.5" />
                  Call
                </button>
              </div>
            </div>
          </div>
        }
        list={
          <>
            <div className="mb-2 flex shrink-0 items-baseline gap-2 px-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                Waiting
              </p>
              <p className="text-xs font-semibold tabular-nums text-slate-500">{waiting.length}</p>
              <p className="ms-auto text-xs text-slate-400">
                <span className="tabular-nums">{view.servedToday ?? 0}</span> served today
              </p>

            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pe-1">
              {waiting.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60">
                  <p className="text-sm text-slate-400">Nobody is waiting</p>
                </div>
              ) : (
                waiting.map((token) => {
                  const dept = deptById.get(token.departmentId)
                  return (
                    // Tapping the token you want is the gesture staff reach for
                    // first, and on a touchscreen it is the only way to call a
                    // token out of order — the keypad has no letter keys.
                    <button
                      key={token.id}
                      type="button"
                      disabled={pending}
                      onClick={() => callCode(token.tokenCode)}
                      className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-2.5 text-start shadow-sm transition active:scale-[0.99] hover:border-accent-400 hover:bg-accent-50 disabled:opacity-60"
                    >
                      <span
                        dir="ltr"
                        className="flex size-12 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-black tabular-nums text-white"
                        style={{ backgroundColor: dept?.color ?? '#475569' }}
                      >
                        {token.tokenCode}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {dept?.nameEn ?? 'Department'}
                        </p>
                        <p className="truncate text-xs text-slate-400">
                          {token.isPriority && 'Priority · '}
                          {token.status === 'held' ? 'On hold' : 'Waiting'}
                        </p>
                      </div>
                      <ElapsedPill mins={minutesSince(token.joinedAt, now)} />
                    </button>
                  )
                })
              )}

              {/* Called, nobody came. They come back — a queue ticket is not a
                  cancellation — and this is the only place the console admits
                  they exist. One tap calls them again. */}
              {noShows.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3">
                  <p className="px-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    No shows · {noShows.length}
                  </p>
                  {noShows.map((token) => {
                    const dept = deptById.get(token.departmentId)
                    return (
                      <button
                        key={token.id}
                        type="button"
                        disabled={pending}
                        onClick={() => callCode(token.tokenCode)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-2 text-start transition active:scale-[0.99] hover:border-accent-400 hover:bg-accent-50 disabled:opacity-60"
                      >
                        <span
                          dir="ltr"
                          className="flex size-10 shrink-0 items-center justify-center rounded-xl font-mono text-xs font-black tabular-nums text-white opacity-60"
                          style={{ backgroundColor: dept?.color ?? '#475569' }}
                        >
                          {token.tokenCode}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-slate-600">
                            {dept?.nameEn ?? 'Department'}
                          </p>
                          <p className="truncate text-[11px] text-slate-400">Didn&apos;t come · tap to call again</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        }
      />

      <IssueDialog
        open={issueOpen}
        departments={issuable}
        counterDepartmentIds={departments.map((d) => d.id)}
        pending={pending}
        onClose={() => setIssueOpen(false)}
        onPick={(departmentId, isPriority) => {
          setIssueOpen(false)
          run(
            () => schoolIssueAtCounterAction(counterToken, departmentId, isPriority),
            (r) => `Issued ${(r as { token?: { tokenCode: string } }).token?.tokenCode ?? ''}`
          )
        }}
      />

      <TransferDialog
        open={transferOpen}
        departments={departments.filter((d) => d.id !== current?.departmentId)}
        pending={pending}
        onClose={() => setTransferOpen(false)}
        onPick={(departmentId) => {
          setTransferOpen(false)
          run(() => schoolTransferAction(counterToken, departmentId), () => 'Sent to the other department')
        }}
      />
    </ConsoleFrame>
  )
}

function TransferDialog({ open, departments, pending, onClose, onPick }: {
  open: boolean
  departments: { id: string; nameEn: string; prefix: string; color: string }[]
  pending: boolean
  onClose: () => void
  onPick: (departmentId: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send to another department</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          The visitor keeps the same token number and rejoins the queue for the department you
          pick.
        </p>
        <div className="space-y-1.5">
          {departments.map((d) => (
            <button
              key={d.id}
              type="button"
              disabled={pending}
              onClick={() => onPick(d.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-start active:bg-slate-50 disabled:opacity-40"
            >
              <span
                dir="ltr"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-black text-white"
                style={{ backgroundColor: d.color }}
              >
                {d.prefix}
              </span>
              <span className="flex-1 truncate text-sm font-medium text-slate-800">{d.nameEn}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function IssueDialog({ open, departments, counterDepartmentIds, pending, onClose, onPick }: {
  open: boolean
  departments: { id: string; nameEn: string; prefix: string; color: string }[]
  counterDepartmentIds: string[]
  pending: boolean
  onClose: () => void
  onPick: (departmentId: string, isPriority: boolean) => void
}) {
  const [priority, setPriority] = useState(false)

  // The window's own departments first: handing a token to the person standing
  // in front of you is the common case, and a Fees clerk should not have to
  // hunt past seven others to find Fees.
  const own = new Set(counterDepartmentIds)
  const ordered = [
    ...departments.filter((d) => own.has(d.id)),
    ...departments.filter((d) => !own.has(d.id)),
  ]

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue a token</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Gives the visitor the next number in that department&apos;s series, exactly as the
          kiosk would. They join the queue and can be called from here.
        </p>

        <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <span className="text-sm font-medium text-slate-800">Priority</span>
          <Switch checked={priority} onCheckedChange={setPriority} disabled={pending} />
        </label>

        <div className="space-y-1.5">
          {ordered.map((d) => (
            <button
              key={d.id}
              type="button"
              disabled={pending}
              onClick={() => { onPick(d.id, priority); setPriority(false) }}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-start active:bg-slate-50 disabled:opacity-40"
            >
              <span
                dir="ltr"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-black text-white"
                style={{ backgroundColor: d.color }}
              >
                {d.prefix}
              </span>
              <span className="flex-1 truncate text-sm font-medium text-slate-800">{d.nameEn}</span>
              {own.has(d.id) && (
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  This window
                </span>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
