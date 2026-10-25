'use client'

import { useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRealtimeQueue } from '@/lib/hooks/useRealtimeQueue'
import { useCounterHeartbeat } from '@/lib/hooks/useCounterPresence'
import { useCounterNotifications } from '@/lib/hooks/useCounterNotifications'
import {
  counterCallNextAction,
  counterCallEntryAction,
  counterCompleteEntryAction,
  counterCancelEntryAction,
} from '@/lib/actions/counters'
import { Receipt, SkipForward, CheckCircle2, ChefHat, BellRing, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { CounterPresenceAlert } from '@/components/counter/CounterPresenceAlert'
import { CounterAlertBar } from '@/components/counter/CounterAlertBar'
import { AlertToggle } from '@/components/counter/AlertToggle'
import { ConsoleFrame, ConsoleLoading, TaskSplit, ElapsedPill, ConfirmCancel, useNow, minutesSince } from '@/components/counter/console'
import type { QueueEntryDTO } from '@/lib/db/types'

interface Props {
  branchId: string
  counterId: string
  counterName: string
  counterToken: string
  presenceEnabled?: boolean
}

/*
 * Billing is a single-focus task (design system v5, §5.2): one order is
 * being acted on at a time, so there's no FIFO lane here — the ready queue
 * only ever has one actionable item (the hero); the list below it is
 * informational, not a stack of equal-weight actions.
 */
export function BillingCounter({ branchId, counterId, counterName, counterToken, presenceEnabled = false }: Props) {
  const { entries, isPaused, isLoading } = useRealtimeQueue(branchId)
  const [pending, startTransition] = useTransition()
  useCounterHeartbeat(counterToken, presenceEnabled)
  const alerts = useCounterNotifications({ counterType: 'billing', counterToken, counterName, entries, isLoading })
  const now = useNow()

  const readyForBilling = entries
    .filter(e => e.status === 'waiting' && e.kitchenStatus === 'ready')
    .sort((a, b) => a.queueNumber - b.queueNumber)

  const atCounter = entries.find(e => e.status === 'in-progress')
  const next = readyForBilling[0]

  const inKitchen = entries.filter(
    e => e.status === 'waiting' && (e.kitchenStatus === 'pending' || e.kitchenStatus === 'preparing')
  ).length

  const focus = atCounter ?? next
  const queueList = atCounter ? readyForBilling : readyForBilling.slice(1)

  function handleCallNext() {
    startTransition(async () => {
      const result = await counterCallNextAction(branchId, counterToken)
      if (result.error) toast.error(result.error)
    })
  }

  function handleRecall(entry: QueueEntryDTO) {
    startTransition(async () => {
      const result = await counterCallEntryAction(entry.id, branchId, counterToken)
      if (result.error) toast.error(result.error)
      else toast.success(`#${entry.queueNumber} recalled`)
    })
  }

  function handleComplete(entry: QueueEntryDTO) {
    startTransition(async () => {
      const result = await counterCompleteEntryAction(entry.id, branchId, counterToken)
      if (result.error) toast.error(result.error)
      else toast.success(`#${entry.queueNumber} billing done`)
    })
  }

  function handleCancel(entry: QueueEntryDTO) {
    startTransition(async () => {
      const result = await counterCancelEntryAction(entry.id, branchId, counterToken)
      if (result.error) toast.error(result.error)
      else toast.success(`#${entry.queueNumber} cancelled`)
    })
  }

  return (
    <ConsoleFrame
      icon={Receipt}
      name={counterName}
      typeLabel="Billing · Cashier Station"
      headerRight={<AlertToggle toggle={alerts.toggle} />}
      banner={
        <>
          <CounterAlertBar unseenCount={alerts.unseenCount} onAcknowledge={alerts.acknowledge} />
          <CounterPresenceAlert branchId={branchId} selfCounterId={counterId} enabled={presenceEnabled} />
        </>
      }
    >
      {isLoading ? (
        <ConsoleLoading icon={Receipt} />
      ) : (
        <TaskSplit
          task={
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={focus ? `${focus.id}-${atCounter ? 'serving' : 'next'}` : 'empty'}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="h-full"
              >
                {atCounter ? (
                  <ServingHero
                    entry={atCounter}
                    now={now}
                    pending={pending}
                    onDone={() => handleComplete(atCounter)}
                    onRecall={() => handleRecall(atCounter)}
                    onCancel={() => handleCancel(atCounter)}
                  />
                ) : next ? (
                  <UpNextHero entry={next} pending={pending} paused={isPaused} onCall={handleCallNext} />
                ) : (
                  <EmptyHero inKitchen={inKitchen} />
                )}
              </motion.div>
            </AnimatePresence>
          }
          list={
            <>
              <div className="flex items-center gap-2 px-1.5 pb-2 shrink-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Ready Queue</p>
                <span className="ms-auto min-w-6 h-6 px-1.5 rounded-full bg-white border border-slate-200 text-slate-500 text-xs font-bold flex items-center justify-center tabular-nums shadow-sm">
                  {queueList.length}
                </span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin space-y-2 px-0.5 pb-1">
                {queueList.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 px-4">
                    <div className="size-14 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center mb-3">
                      <Receipt className="size-6 text-slate-300" />
                    </div>
                    <p className="text-sm font-semibold text-slate-500">{focus ? 'Nothing else waiting' : 'Nothing ready'}</p>
                    <p className="text-xs mt-1 max-w-52">Kitchen-ready orders queue up here</p>
                  </div>
                ) : (
                  <AnimatePresence initial={false}>
                    {queueList.map((entry, idx) => (
                      <motion.div
                        key={entry.id}
                        layout
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                      >
                        <QueueRow entry={entry} now={now} highlight={!!atCounter && idx === 0} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
                {inKitchen > 0 && (
                  <div className="flex items-center gap-1.5 px-1 pt-2 text-xs text-slate-400">
                    <ChefHat className="size-3.5" />
                    {inKitchen} still in kitchen
                  </div>
                )}
              </div>
            </>
          }
        />
      )}
    </ConsoleFrame>
  )
}

/* Serving: flat white hero card, one accent CTA, guarded cancel. */
function ServingHero({ entry, now, pending, onDone, onRecall, onCancel }: {
  entry: QueueEntryDTO
  now: number
  pending: boolean
  onDone: () => void
  onRecall: () => void
  onCancel: () => void
}) {
  const mins = minutesSince(entry.startedAt ?? entry.joinedAt, now)
  return (
    <div className="h-full min-h-0 rounded-3xl bg-white border border-slate-200 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.25)] flex flex-col p-5">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-accent-600 animate-pulse" />
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Now Serving</span>
        <span className="ms-auto"><ElapsedPill mins={mins} /></span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col justify-center">
        <p className="font-mono font-black tabular-nums text-slate-900 leading-[0.82] text-[clamp(4.5rem,20vh,9rem)]" dir="ltr">
          {entry.queueNumber}
        </p>
        <p className="text-2xl font-bold text-slate-800 mt-2">{entry.billNumber ? `Bill #${entry.billNumber}` : 'No bill #'}</p>
        <p className="text-slate-500 truncate">
          {[entry.customerName, entry.phone].filter(Boolean).join(' · ') || 'Walk-in'}
        </p>
        {((entry.callCount ?? 0) > 1 || (entry.recallCount ?? 0) > 0) && (
          <p className="text-slate-400 text-xs mt-1">
            Called {entry.callCount ?? 0}×{(entry.recallCount ?? 0) > 0 && ` · Recalled ${entry.recallCount}×`}
          </p>
        )}
        {entry.notes && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            <span className="shrink-0">⚠</span>
            <span className="leading-5">{entry.notes}</span>
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={pending}
            onClick={onRecall}
            className="h-12 rounded-2xl bg-white border border-slate-200 text-slate-700 text-sm font-bold flex items-center justify-center gap-2 select-none transition-all duration-[250ms] ease-out active:translate-y-px disabled:opacity-40 disabled:active:translate-y-0 shadow-sm active:bg-slate-50"
          >
            <BellRing className="size-4.5" />
            Recall
          </button>
          <ConfirmCancel disabled={pending} onConfirm={onCancel} />
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={onDone}
          className="w-full h-14 rounded-2xl bg-accent-600 text-white text-base font-bold flex items-center justify-center gap-2 select-none transition-all duration-[250ms] ease-out active:translate-y-px disabled:opacity-40 disabled:active:translate-y-0 shadow-[0_6px_16px_-6px_rgba(5,150,105,0.5)] active:bg-accent-700"
        >
          <CheckCircle2 className="size-5" />
          Billing Done
        </button>
      </div>
    </div>
  )
}

/* Up next: flat white hero, single primary CTA to call. */
function UpNextHero({ entry, pending, paused, onCall }: {
  entry: QueueEntryDTO
  pending: boolean
  paused: boolean
  onCall: () => void
}) {
  return (
    <div className="h-full min-h-0 rounded-3xl bg-white border border-slate-200 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.25)] flex flex-col p-5">
      <div className="flex items-center">
        <span className="inline-flex items-center h-7 rounded-full bg-accent-50 text-accent-700 border border-accent-200 px-2.5 text-xs font-bold">
          Up Next
        </span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col justify-center">
        <p className="font-mono font-black tabular-nums text-slate-900 leading-[0.82] text-[clamp(4.5rem,20vh,9rem)]" dir="ltr">
          {entry.queueNumber}
        </p>
        <p className="text-2xl font-bold text-slate-800 mt-2">{entry.billNumber ? `Bill #${entry.billNumber}` : 'No bill #'}</p>
        <p className="text-slate-500 truncate">
          {[entry.customerName, entry.phone].filter(Boolean).join(' · ') || 'Walk-in'}
        </p>
        {entry.notes && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            <span className="shrink-0">⚠</span>
            <span className="leading-5">{entry.notes}</span>
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          disabled={pending || paused}
          onClick={onCall}
          className="w-full h-14 rounded-2xl bg-accent-600 text-white text-base font-bold flex items-center justify-center gap-2 select-none transition-all duration-[250ms] ease-out active:translate-y-px disabled:opacity-40 disabled:active:translate-y-0 shadow-[0_6px_16px_-6px_rgba(5,150,105,0.5)] active:bg-accent-700"
        >
          <SkipForward className="size-5" />
          Call #{entry.queueNumber}
        </button>
        {paused && <p className="text-center text-xs font-semibold text-amber-600 mt-2">Queue is paused</p>}
      </div>
    </div>
  )
}

/* Nothing to serve: calm empty card. */
function EmptyHero({ inKitchen }: { inKitchen: number }) {
  const kitchen = inKitchen > 0
  return (
    <div className="h-full min-h-0 rounded-3xl bg-white border border-slate-200 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.25)] flex flex-col items-center justify-center text-center p-6">
      <div className={`size-16 rounded-2xl flex items-center justify-center mb-3 ${kitchen ? 'bg-amber-50 text-amber-600' : 'bg-accent-50 text-accent-700'}`}>
        {kitchen ? <ChefHat className="size-7" /> : <CheckCircle2 className="size-7" />}
      </div>
      <p className="text-lg font-bold text-slate-700">
        {kitchen ? `${inKitchen} order${inKitchen > 1 ? 's' : ''} in kitchen` : 'All clear'}
      </p>
      <p className="text-sm text-slate-400 mt-1 max-w-64">
        {kitchen ? 'They appear here once the kitchen marks them ready' : 'Ready orders show up here automatically'}
      </p>
    </div>
  )
}

/* A ready order in the queue list: mono number tile, bill/name, wait pill. */
function QueueRow({ entry, now, highlight = false }: {
  entry: QueueEntryDTO
  now: number
  highlight?: boolean
}) {
  return (
    <div className={`rounded-2xl border p-2.5 flex items-center gap-3 ${
      highlight ? 'bg-accent-50 border-accent-300' : 'bg-white border-slate-200 shadow-sm'
    }`}>
      <span className="size-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center font-mono font-black text-xl tabular-nums shrink-0" dir="ltr">
        {entry.queueNumber}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-slate-800 truncate">
          {entry.billNumber ? `Bill #${entry.billNumber}` : '—'}
        </p>
        <p className="text-sm text-slate-400 truncate">
          {entry.customerName || 'Walk-in'}
          {entry.notes && <span className="text-amber-600"> · ⚠ {entry.notes}</span>}
        </p>
      </div>
      <ElapsedPill mins={minutesSince(entry.joinedAt, now)} />
    </div>
  )
}
