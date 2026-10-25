'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRealtimeQueue } from '@/lib/hooks/useRealtimeQueue'
import { useCounterHeartbeat } from '@/lib/hooks/useCounterPresence'
import { useCounterNotifications } from '@/lib/hooks/useCounterNotifications'
import {
  counterCallEntryAction,
  counterCompleteEntryAction,
  counterCancelEntryAction,
  counterCreateEntryAction,
} from '@/lib/actions/counters'
import { Truck, Phone, CheckCircle2, PackageCheck, ChefHat, SkipForward, BellRing, Search, X, Delete, XCircle, Ticket } from 'lucide-react'
import { toast } from 'sonner'
import { formatTime } from '@/lib/queueUtils'
import { CounterPresenceAlert } from '@/components/counter/CounterPresenceAlert'
import { CounterAlertBar } from '@/components/counter/CounterAlertBar'
import { AlertToggle } from '@/components/counter/AlertToggle'
import { ConsoleFrame, ConsoleLoading, TaskSplit, ElapsedPill, useNow, minutesSince, useTapGuard } from '@/components/counter/console'
import type { QueueEntryDTO } from '@/lib/db/types'

const MAX_SEARCH_LENGTH = 20

interface Props {
  branchId: string
  counterId: string
  counterName: string
  counterToken: string
  presenceEnabled?: boolean
}

/*
 * Delivery mirrors Billing's single-focus task shape (design system v5,
 * §5.2): one order out for delivery (or up next) at a time — no FIFO lane,
 * the list below the hero is informational.
 */
export function DeliveryCounter({ branchId, counterId, counterName, counterToken, presenceEnabled = false }: Props) {
  const { entries, isPaused, isLoading } = useRealtimeQueue(branchId)
  const [pending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const searchBarRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  useCounterHeartbeat(counterToken, presenceEnabled)
  const alerts = useCounterNotifications({ counterType: 'delivery', counterToken, counterName, entries, isLoading })
  const now = useNow()

  // Bottom sheet dismisses on outside tap via a plain document listener
  // (not an intercepting overlay div) so it never blocks or dims the
  // search results sitting behind/above it.
  useEffect(() => {
    if (!searchFocused) return
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (searchBarRef.current?.contains(target)) return
      if (sheetRef.current?.contains(target)) return
      setSearchFocused(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [searchFocused])

  const atCounter = entries.find(e => e.status === 'in-progress')

  const readyForDelivery = entries
    .filter(e => e.status === 'waiting' && e.kitchenStatus === 'ready')
    .sort((a, b) => a.queueNumber - b.queueNumber)

  const next = readyForDelivery[0]

  const inKitchen = entries.filter(
    e => e.status === 'waiting' && (e.kitchenStatus === 'pending' || e.kitchenStatus === 'preparing')
  ).length

  const focus = atCounter ?? next
  const queueList = atCounter ? readyForDelivery : readyForDelivery.slice(1)

  const recentlyDelivered = entries
    .filter(e => e.status === 'completed')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, 5)

  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []
    return entries
      .filter(e => e.status === 'waiting' || e.status === 'in-progress')
      .filter(e =>
        String(e.queueNumber).includes(query) ||
        e.billNumber?.toLowerCase().includes(query) ||
        e.customerName?.toLowerCase().includes(query)
      )
      .sort((a, b) => a.queueNumber - b.queueNumber)
  }, [entries, search])

  // Call/recall works off whatever the entry's current status is — waiting+ready
  // becomes a call, already in-progress becomes a recall — so one button always
  // applies regardless of where the order sits in the queue.
  function handleCallOrRecall(entry: QueueEntryDTO) {
    const wasInProgress = entry.status === 'in-progress'
    startTransition(async () => {
      const result = await counterCallEntryAction(entry.id, branchId, counterToken)
      if (result.error) toast.error(result.error)
      else toast.success(`#${entry.queueNumber} ${wasInProgress ? 'recalled' : 'called'}`)
    })
  }

  function handleDeliver(entry: QueueEntryDTO) {
    startTransition(async () => {
      const result = await counterCompleteEntryAction(entry.id, branchId, counterToken)
      if (result.error) toast.error(result.error)
      else toast.success(`#${entry.queueNumber} delivered`)
    })
  }

  function handleCancel(entry: QueueEntryDTO) {
    startTransition(async () => {
      const result = await counterCancelEntryAction(entry.id, branchId, counterToken)
      if (result.error) toast.error(result.error)
      else toast.success(`#${entry.queueNumber} cancelled`)
    })
  }

  // No matching order for the searched bill — register it here (skipping
  // the kitchen stage) and call it immediately, so it shows up active in
  // the left panel exactly like tapping Call on an existing entry.
  function handleCreateToken() {
    const trimmed = search.trim()
    if (!trimmed) return
    startTransition(async () => {
      const result = await counterCreateEntryAction(branchId, counterToken, trimmed)
      if (result.error || !result.entry) {
        toast.error(result.error ?? 'Failed to create token')
        return
      }
      const callResult = await counterCallEntryAction(result.entry.id, branchId, counterToken)
      if (callResult.error) toast.error(callResult.error)
      toast.success(`Queue #${result.entry.queueNumber} — Bill ${result.entry.billNumber} created`)
      setSearch('')
      setSearchFocused(false)
    })
  }

  return (
    <ConsoleFrame
      icon={Truck}
      name={counterName}
      typeLabel="Delivery · Dispatch Station"
      headerRight={<AlertToggle toggle={alerts.toggle} />}
      banner={
        <>
          <CounterAlertBar unseenCount={alerts.unseenCount} onAcknowledge={alerts.acknowledge} />
          <CounterPresenceAlert branchId={branchId} selfCounterId={counterId} enabled={presenceEnabled} />
        </>
      }
    >
      {isLoading ? (
        <ConsoleLoading icon={Truck} />
      ) : (
        <TaskSplit
          task={
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={focus ? `${focus.id}-${atCounter ? 'out' : 'next'}` : 'empty'}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="h-full"
              >
                {atCounter ? (
                  <OutForDeliveryHero
                    entry={atCounter}
                    now={now}
                    pending={pending}
                    onDeliver={() => handleDeliver(atCounter)}
                    onCall={() => handleCallOrRecall(atCounter)}
                    onRecall={() => handleCallOrRecall(atCounter)}
                    onCancel={() => handleCancel(atCounter)}
                  />
                ) : next ? (
                  <UpNextHero
                    entry={next}
                    pending={pending}
                    paused={isPaused}
                    onCall={() => handleCallOrRecall(next)}
                    onRecall={() => handleCallOrRecall(next)}
                    onCancel={() => handleCancel(next)}
                  />
                ) : (
                  <EmptyHero inKitchen={inKitchen} />
                )}
              </motion.div>
            </AnimatePresence>
          }
          list={
            <div className="relative flex-1 min-h-0 flex flex-col">
              <div ref={searchBarRef} className="relative shrink-0 mb-2 rounded-xl border border-slate-200 bg-white focus-within:border-accent-400 focus-within:ring-4 focus-within:ring-accent-600/10 transition-colors">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <input
                  type="text"
                  inputMode="none"
                  placeholder="Search queue #, bill #, or name…"
                  value={search}
                  onFocus={() => setSearchFocused(true)}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-10 bg-transparent pl-9 pr-9 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 size-6 rounded-full flex items-center justify-center text-slate-400 active:bg-slate-100"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              {search ? (
                <>
                  <div className="flex items-center gap-2 px-1.5 pb-2 shrink-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Search Results</p>
                    <span className="ms-auto min-w-6 h-6 px-1.5 rounded-full bg-white border border-slate-200 text-slate-500 text-xs font-bold flex items-center justify-center tabular-nums shadow-sm">
                      {searchResults.length}
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin space-y-2 px-0.5 pb-1">
                    {searchResults.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-accent-300 bg-accent-50/40 p-3 flex flex-col gap-3">
                        <div className="flex items-center gap-3">
                          <span className="size-12 rounded-xl bg-white border border-accent-200 text-accent-700 flex items-center justify-center shrink-0">
                            <Ticket className="size-5" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-slate-800 truncate">Bill #{search}</p>
                            <p className="text-sm text-slate-400">No matching order — create a new token</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={handleCreateToken}
                          className="w-full h-12 rounded-xl bg-accent-600 text-white text-sm font-bold flex items-center justify-center gap-2 select-none transition-all duration-[250ms] ease-out active:translate-y-px disabled:opacity-40 disabled:active:translate-y-0 shadow-[0_6px_16px_-6px_rgba(5,150,105,0.5)] active:bg-accent-700"
                        >
                          <Ticket className="size-4.5" />
                          Create Token
                        </button>
                      </div>
                    ) : (
                      <AnimatePresence initial={false}>
                        {searchResults.map((entry) => (
                          <motion.div
                            key={entry.id}
                            layout
                            initial={{ opacity: 0, y: -8, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            transition={{ duration: 0.25, ease: 'easeOut' }}
                          >
                            <QueueRow
                              entry={entry}
                              now={now}
                              pending={pending}
                              onCall={() => handleCallOrRecall(entry)}
                              onCancel={() => handleCancel(entry)}
                            />
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 px-1.5 pb-2 shrink-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Ready for Delivery</p>
                    <span className="ms-auto min-w-6 h-6 px-1.5 rounded-full bg-white border border-slate-200 text-slate-500 text-xs font-bold flex items-center justify-center tabular-nums shadow-sm">
                      {queueList.length}
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin space-y-2 px-0.5 pb-1">
                    {queueList.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 px-4">
                        <div className="size-14 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center mb-3">
                          <Truck className="size-6 text-slate-300" />
                        </div>
                        <p className="text-sm font-semibold text-slate-500">{focus ? 'Nothing else waiting' : 'Nothing waiting'}</p>
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
                            <QueueRow
                              entry={entry}
                              now={now}
                              highlight={!!atCounter && idx === 0}
                              pending={pending}
                              onCall={() => handleCallOrRecall(entry)}
                              onCancel={() => handleCancel(entry)}
                            />
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

                    {recentlyDelivered.length > 0 && (
                      <>
                        <div className="flex items-center gap-2 px-1 pt-3 pb-1">
                          <PackageCheck className="size-3.5 text-slate-400" />
                          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Recently Delivered</p>
                        </div>
                        {recentlyDelivered.map(entry => (
                          <div key={entry.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-center gap-3 opacity-70">
                            <span className="w-12 text-center font-mono font-black text-xl tabular-nums text-slate-300 shrink-0" dir="ltr">
                              {entry.queueNumber}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-slate-500 truncate">
                                {entry.billNumber ? `Bill #${entry.billNumber}` : '—'}
                                {entry.customerName && <span className="text-slate-400"> · {entry.customerName}</span>}
                              </p>
                              {entry.completedAt && (
                                <p className="text-xs text-slate-400 tabular-nums">Delivered {formatTime(entry.completedAt)}</p>
                              )}
                            </div>
                            <CheckCircle2 className="size-4 text-accent-600 shrink-0" />
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}

              <AnimatePresence>
                {searchFocused && (
                  <motion.div
                    ref={sheetRef}
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="absolute inset-x-0 bottom-0 z-30 rounded-t-3xl border border-slate-200 bg-white shadow-2xl p-3.5"
                  >
                    <SearchNumpad
                      onDigit={(d) => setSearch((prev) => (prev + d).slice(0, MAX_SEARCH_LENGTH))}
                      onBackspace={() => setSearch((prev) => prev.slice(0, -1))}
                      onClear={() => setSearch('')}
                      onClose={() => setSearchFocused(false)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          }
        />
      )}
    </ConsoleFrame>
  )
}

/* Out for delivery: bill card (60% info / 40% Call+Recall split, design
   spec §2) stacked above the Delivered CTA. Dismiss sits pinned to the
   card's top-right corner so it survives the info section scrolling. */
function OutForDeliveryHero({ entry, now, pending, onDeliver, onCall, onRecall, onCancel }: {
  entry: QueueEntryDTO
  now: number
  pending: boolean
  onDeliver: () => void
  onCall: () => void
  onRecall: () => void
  onCancel: () => void
}) {
  const mins = minutesSince(entry.startedAt ?? entry.joinedAt, now)
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      {/* Bill card: 60% of the split */}
      <div className="flex-3 min-h-0 relative rounded-3xl bg-white border border-slate-200 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.25)] overflow-hidden">
        <DismissCorner disabled={pending} onConfirm={onCancel} />
        <div className="h-full overflow-y-auto p-5 pr-32 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-accent-600 animate-pulse" />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Out for Delivery</span>
            <span className="ms-auto"><ElapsedPill mins={mins} /></span>
          </div>

          <div className="min-h-0">
            <p className="font-mono font-black tabular-nums text-slate-900 leading-[0.82] text-[clamp(3rem,13vh,6rem)]" dir="ltr">
              {entry.queueNumber}
            </p>
            <p className="text-2xl font-bold text-slate-800 mt-2">{entry.billNumber ? `Bill #${entry.billNumber}` : 'No bill #'}</p>
            <p className="text-slate-500 truncate">{entry.customerName || 'No name'}</p>
            {((entry.callCount ?? 0) > 1 || (entry.recallCount ?? 0) > 0) && (
              <p className="text-slate-400 text-xs mt-1">
                Called {entry.callCount ?? 0}×{(entry.recallCount ?? 0) > 0 && ` · Recalled ${entry.recallCount}×`}
              </p>
            )}
          </div>

          {entry.phone ? (
            <a
              href={`tel:${entry.phone}`}
              className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 active:bg-slate-100 active:scale-[0.98] transition-all"
            >
              <div className="size-10 rounded-lg bg-slate-700 flex items-center justify-center shrink-0">
                <Phone className="size-4.5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Tap to Call</p>
                <p className="text-lg font-bold text-slate-800 leading-tight tabular-nums" dir="ltr">{entry.phone}</p>
              </div>
            </a>
          ) : (
            <div className="flex items-center gap-2 text-sm text-slate-400 px-1">
              <Phone className="size-4" />
              No phone number
            </div>
          )}

          {entry.notes && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
              <span className="shrink-0">⚠</span>
              <span className="leading-5">{entry.notes}</span>
            </div>
          )}
        </div>
      </div>

      {/* Call / Recall: 40% of the split, two separate button cards */}
      <div className="flex-2 min-h-0 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={onCall}
          className="h-full min-h-0 rounded-2xl bg-slate-700 text-white flex flex-col items-center justify-center gap-1.5 select-none transition-all active:scale-[0.97] active:bg-slate-800 disabled:opacity-40 shadow-[0_4px_10px_-4px_rgba(15,23,42,0.35)]"
        >
          <Phone className="size-6" />
          <span className="text-sm font-bold">Call</span>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onRecall}
          className="h-full min-h-0 rounded-2xl bg-slate-700 text-white flex flex-col items-center justify-center gap-1.5 select-none transition-all active:scale-[0.97] active:bg-slate-800 disabled:opacity-40 shadow-[0_4px_10px_-4px_rgba(15,23,42,0.35)]"
        >
          <BellRing className="size-6" />
          <span className="text-sm font-bold">Recall</span>
        </button>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={onDeliver}
        className="w-full h-14 rounded-2xl bg-accent-600 text-white text-base font-bold flex items-center justify-center gap-2 select-none shrink-0 transition-all duration-[250ms] ease-out active:translate-y-px disabled:opacity-40 disabled:active:translate-y-0 shadow-[0_6px_16px_-6px_rgba(5,150,105,0.5)] active:bg-accent-700"
      >
        <CheckCircle2 className="size-5" />
        Delivered
      </button>
    </div>
  )
}

/* Two-tap-guarded Dismiss folded into the bill card's own top-right
   corner (design spec §2) — a ribbon clipped by the card's rounded-3xl
   edge, not a floating circle badge, so it reads as part of the card. */
function DismissCorner({ onConfirm, disabled }: { onConfirm: () => void; disabled?: boolean }) {
  const { armed, tap } = useTapGuard(onConfirm)
  return (
    <button
      type="button"
      onClick={tap}
      disabled={disabled}
      className={`absolute top-0 right-0 z-10 h-11 px-4 rounded-bl-2xl flex items-center justify-center gap-1.5 text-xs font-bold select-none transition-all active:scale-[0.97] disabled:opacity-40 ${
        armed ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600 active:bg-red-100'
      }`}
    >
      {armed ? 'Confirm' : <><X className="size-4" /> Cancel</>}
    </button>
  )
}

/* Up next: same bill-card shape as OutForDeliveryHero (design spec §2)
   for a consistent left panel whether or not the order has been called
   yet — 60% info incl. Dismiss corner, 40% Call/Recall split. */
function UpNextHero({ entry, pending, paused, onCall, onRecall, onCancel }: {
  entry: QueueEntryDTO
  pending: boolean
  paused: boolean
  onCall: () => void
  onRecall: () => void
  onCancel: () => void
}) {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      {/* Bill card: 60% of the split */}
      <div className="flex-3 min-h-0 relative rounded-3xl bg-white border border-slate-200 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.25)] overflow-hidden">
        <DismissCorner disabled={pending || paused} onConfirm={onCancel} />
        <div className="h-full overflow-y-auto p-5 pr-32 flex flex-col justify-center">
          <span className="inline-flex items-center self-start h-7 rounded-full bg-accent-50 text-accent-700 border border-accent-200 px-2.5 text-xs font-bold">
            Up Next
          </span>

          <p className="font-mono font-black tabular-nums text-slate-900 leading-[0.82] text-[clamp(3.5rem,16vh,7rem)] mt-3" dir="ltr">
            {entry.queueNumber}
          </p>
          <p className="text-2xl font-bold text-slate-800 mt-2">{entry.billNumber ? `Bill #${entry.billNumber}` : 'No bill #'}</p>
          <p className="text-slate-500 truncate">{entry.customerName || 'No name'}</p>
          {entry.notes && (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
              <span className="shrink-0">⚠</span>
              <span className="leading-5">{entry.notes}</span>
            </div>
          )}
        </div>
      </div>

      {/* Call / Recall: 40% of the split, two separate button cards */}
      <div className="flex-2 min-h-0 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={pending || paused}
          onClick={onCall}
          className="h-full min-h-0 rounded-2xl bg-slate-700 text-white flex flex-col items-center justify-center gap-1.5 select-none transition-all active:scale-[0.97] active:bg-slate-800 disabled:opacity-40 shadow-[0_4px_10px_-4px_rgba(15,23,42,0.35)]"
        >
          <SkipForward className="size-6" />
          <span className="text-sm font-bold">Call</span>
        </button>
        <button
          type="button"
          disabled={pending || paused}
          onClick={onRecall}
          className="h-full min-h-0 rounded-2xl bg-slate-700 text-white flex flex-col items-center justify-center gap-1.5 select-none transition-all active:scale-[0.97] active:bg-slate-800 disabled:opacity-40 shadow-[0_4px_10px_-4px_rgba(15,23,42,0.35)]"
        >
          <BellRing className="size-6" />
          <span className="text-sm font-bold">Recall</span>
        </button>
      </div>
      {paused && (
        <p className="text-center text-xs font-semibold text-amber-600 shrink-0">Queue is paused</p>
      )}
    </div>
  )
}

/* Nothing to deliver: calm empty card. */
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
        {kitchen ? 'They appear here once the kitchen marks them ready' : 'Kitchen-ready orders show up here automatically'}
      </p>
    </div>
  )
}

/* Numpad bottom sheet — same compact key layout as before, now docked to
   the bottom of the list panel instead of dropping below the search bar.
   No Done button: the freed row goes to slightly taller keys, and the
   sheet only closes via the corner Close button or an outside tap
   (handled by the pointerdown listener in the parent). Suppresses the OS
   keyboard, matching Order's bill-entry pad. */
function SearchNumpad({ onDigit, onBackspace, onClear, onClose }: {
  onDigit: (d: string) => void
  onBackspace: () => void
  onClear: () => void
  onClose: () => void
}) {
  return (
    <div className="w-full max-w-64 mx-auto">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Search</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="size-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center active:bg-slate-200 active:scale-95 transition"
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDigit(d)}
            className="h-12 rounded-lg bg-slate-700 text-white text-lg font-bold flex items-center justify-center select-none active:bg-slate-800 active:scale-95 transition"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={onClear}
          className="h-12 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs font-bold flex items-center justify-center select-none active:bg-red-100 active:scale-95 transition"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => onDigit('0')}
          className="h-12 rounded-lg bg-slate-700 text-white text-lg font-bold flex items-center justify-center select-none active:bg-slate-800 active:scale-95 transition"
        >
          0
        </button>
        <button
          type="button"
          onClick={onBackspace}
          aria-label="Backspace"
          className="h-12 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center select-none active:bg-slate-300 active:scale-95 transition"
        >
          <Delete className="size-5" />
        </button>
      </div>
    </div>
  )
}

/* A queue-list or search-result row: mono number, bill/name, wait pill, and
   always-present quick Call, Recall, and Cancel actions as three equal-width
   horizontal pills spanning the full card — sized for a tablet, not a
   cramped side column, so a busy thumb doesn't mis-tap. Both Call and Recall
   stay visible regardless of the entry's state (up next, already on call,
   whatever), so staff decide which to tap; the backend applies the right
   one (call vs. recall) based on the entry's actual status. */
function QueueRow({ entry, now, highlight = false, pending, onCall, onCancel }: {
  entry: QueueEntryDTO
  now: number
  highlight?: boolean
  pending: boolean
  onCall: () => void
  onCancel: () => void
}) {
  const notReady = entry.status === 'waiting' && entry.kitchenStatus !== 'ready'
  const { armed, tap: tapCancel } = useTapGuard(onCancel)
  return (
    <div className={`rounded-2xl border p-3 flex flex-col gap-3 ${
      highlight ? 'bg-accent-50 border-accent-300' : 'bg-white border-slate-200 shadow-sm'
    }`}>
      <div className="flex items-center gap-3">
        <span className="size-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center font-mono font-black text-xl tabular-nums shrink-0" dir="ltr">
          {entry.queueNumber}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-800 truncate">
            {entry.billNumber ? `Bill #${entry.billNumber}` : '—'}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-sm text-slate-400 truncate">{entry.customerName || 'No name'}</span>
            <ElapsedPill mins={minutesSince(entry.joinedAt, now)} />
          </div>
          {entry.notes && <p className="text-xs text-amber-600 truncate">⚠ {entry.notes}</p>}
          {notReady && <p className="text-xs text-slate-400">Still in kitchen</p>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={pending || notReady}
          onClick={onCall}
          title={notReady ? 'Not ready in kitchen yet' : 'Call this order'}
          className="h-12 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm active:bg-slate-50 active:scale-[0.97] transition disabled:opacity-40"
        >
          <Phone className="size-4" />
          Call
        </button>
        <button
          type="button"
          disabled={pending || notReady}
          onClick={onCall}
          title={notReady ? 'Not ready in kitchen yet' : 'Recall this order'}
          className="h-12 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm active:bg-slate-50 active:scale-[0.97] transition disabled:opacity-40"
        >
          <BellRing className="size-4" />
          Recall
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={tapCancel}
          className={`h-12 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 select-none transition-all active:scale-[0.97] disabled:opacity-40 ${
            armed ? 'bg-red-500 text-white shadow-sm' : 'bg-white border border-red-200 text-red-600 shadow-sm active:bg-red-50'
          }`}
        >
          {armed ? 'Confirm' : <><XCircle className="size-4" /> Cancel</>}
        </button>
      </div>
    </div>
  )
}
