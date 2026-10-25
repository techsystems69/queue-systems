'use client'

import { useState, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRealtimeQueue } from '@/lib/hooks/useRealtimeQueue'
import { useCounterHeartbeat } from '@/lib/hooks/useCounterPresence'
import { useCounterNotifications } from '@/lib/hooks/useCounterNotifications'
import { counterUpdateKitchenStatusAction, counterToggleAcceptingOrdersAction } from '@/lib/actions/counters'
import { ChefHat, Flame, CheckCircle2, Inbox, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { CounterPresenceAlert } from '@/components/counter/CounterPresenceAlert'
import { CounterAlertBar } from '@/components/counter/CounterAlertBar'
import { ConsoleFrame, ConsoleLoading, ElapsedPill, useNow, minutesSince, useTapGuard } from '@/components/counter/console'
import type { QueueEntryDTO } from '@/lib/db/types'
import type { LucideIcon } from 'lucide-react'

interface Props {
  branchId: string
  counterId: string
  counterName: string
  counterToken: string
  acceptingOrders: boolean
  presenceEnabled?: boolean
}

/*
 * Kitchen isn't "one focus + a queue" — it's two prep lanes worked in
 * parallel, so it keeps the console foundations (flat slate canvas,
 * white cards, one accent, mono numbers) but not the keypad layout.
 * New orders always sit on the left (top in portrait), cooking always
 * on the right (bottom), so spatial memory holds across a shift.
 *
 * Design system v5, §5.3 (FIFO emphasis rule): within a lane, only the
 * first (oldest) card's action renders as the solid accent CTA — every
 * card below renders the same action in the quiet skin. The accent
 * means "do this one next," not "this class of action."
 */
export function KitchenCounter({ branchId, counterId, counterName, counterToken, acceptingOrders: initialAcceptingOrders, presenceEnabled = false }: Props) {
  const { entries, isLoading } = useRealtimeQueue(branchId)
  const [pending, startTransition] = useTransition()
  const [acceptingOrders, setAcceptingOrders] = useState(initialAcceptingOrders)
  const [togglePending, startToggle] = useTransition()
  useCounterHeartbeat(counterToken, presenceEnabled)
  const alerts = useCounterNotifications({ counterType: 'kitchen', counterToken, counterName, entries, isLoading })
  const now = useNow(60000)

  function handleToggleAccepting() {
    startToggle(async () => {
      const result = await counterToggleAcceptingOrdersAction(counterToken)
      if (result.error) {
        toast.error(result.error)
        return
      }
      setAcceptingOrders(result.acceptingOrders ?? acceptingOrders)
      if (result.acceptingOrders) {
        toast.success('Kitchen back online')
      } else {
        toast('Kitchen offline — new orders will skip prep')
      }
    })
  }

  const newOrders = entries
    .filter(e => e.status === 'waiting' && e.kitchenStatus === 'pending')
    .sort((a, b) => a.queueNumber - b.queueNumber)

  const inPrep = entries
    .filter(e => e.status === 'waiting' && e.kitchenStatus === 'preparing')
    .sort((a, b) => a.queueNumber - b.queueNumber)

  function handleStatus(entry: QueueEntryDTO, newStatus: 'preparing' | 'ready') {
    startTransition(async () => {
      const result = await counterUpdateKitchenStatusAction(entry.id, branchId, newStatus, counterToken)
      if (result.error) toast.error(result.error)
      else if (newStatus === 'ready') toast.success(`#${entry.queueNumber} sent to billing`)
    })
  }

  return (
    <ConsoleFrame
      icon={ChefHat}
      name={counterName}
      typeLabel="Kitchen · Prep Station"
      headerRight={<AcceptingOrdersToggle acceptingOrders={acceptingOrders} pending={togglePending} onToggle={handleToggleAccepting} />}
      banner={
        <>
          <CounterAlertBar unseenCount={alerts.unseenCount} needsSetup={alerts.needsSetup} onEnable={alerts.enableAlerts} onAcknowledge={alerts.acknowledge} />
          {!acceptingOrders && (
            <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-3 py-1.5 flex items-center gap-2">
              <WifiOff className="size-3.5 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-800">
                <span className="font-bold">Kitchen offline</span> — new orders skip prep and go straight to billing/delivery.
              </p>
            </div>
          )}
          <CounterPresenceAlert branchId={branchId} selfCounterId={counterId} enabled={presenceEnabled} />
        </>
      }
    >
      {isLoading ? (
        <ConsoleLoading icon={ChefHat} />
      ) : (
        <div className="h-full grid gap-3 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] portrait:grid-rows-2 landscape:grid-cols-2">
          {/* Lane 1 — New orders waiting to be started. */}
          <Lane
            label="New Orders"
            count={newOrders.length}
            pulse={newOrders.length > 0}
            empty={<LaneEmpty icon={Inbox} title="No new orders" sub="Incoming orders appear here automatically" />}
          >
            {newOrders.map((entry, index) => {
              const isNext = index === 0
              return (
                <Ticket key={entry.id} entry={entry} now={now}>
                  {/* Start Prep is the dominant next step only on the oldest
                      card; Ready is always the quiet skip-ahead shortcut. */}
                  <div className={isNext ? 'grid grid-cols-[1.4fr_1fr] gap-2' : 'grid grid-cols-2 gap-2'}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => handleStatus(entry, 'preparing')}
                      className={isNext ? PRIMARY_BTN : SECONDARY_BTN}
                    >
                      <Flame className="size-5" />
                      Start Prep
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => handleStatus(entry, 'ready')}
                      className={SECONDARY_BTN}
                    >
                      <CheckCircle2 className="size-5" />
                      Ready
                    </button>
                  </div>
                </Ticket>
              )
            })}
          </Lane>

          {/* Lane 2 — Orders on the stove, one tap from billing. */}
          <Lane
            label="Cooking"
            count={inPrep.length}
            empty={<LaneEmpty icon={Flame} title="Nothing cooking" sub="Tap Start Prep to move orders here" />}
          >
            {inPrep.map((entry, index) => {
              const isNext = index === 0
              return (
                <Ticket key={entry.id} entry={entry} now={now}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleStatus(entry, 'ready')}
                    className={`w-full ${isNext ? PRIMARY_BTN : SECONDARY_BTN}`}
                  >
                    <CheckCircle2 className="size-5" />
                    Order Ready
                  </button>
                </Ticket>
              )
            })}
          </Lane>
        </div>
      )}
    </ConsoleFrame>
  )
}

/* Shift-level online/offline toggle, next to the header clock. Going
   offline is disruptive (skips prep for every new order), so the first tap
   only "arms" it — track flips amber and pulses, thumb stays put — and a
   second tap confirms (thumb only ever moves on the real, committed change).
   Coming back online is instant. */
function AcceptingOrdersToggle({ acceptingOrders, pending, onToggle }: {
  acceptingOrders: boolean
  pending: boolean
  onToggle: () => void
}) {
  const { armed, tap } = useTapGuard(onToggle)
  const isOn = acceptingOrders
  const previewOff = isOn && armed
  const label = previewOff ? 'Tap again to go offline' : isOn ? 'Kitchen online' : 'Kitchen offline'
  const labelColor = previewOff ? 'text-amber-600' : isOn ? 'text-accent-700' : 'text-slate-400'

  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-slate-50 border border-slate-200 pl-3 pr-1.5 py-1.5">
      <span className={`text-[11px] font-bold uppercase tracking-wide whitespace-nowrap ${labelColor}`}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label="Kitchen accepting orders"
        onClick={isOn ? tap : onToggle}
        disabled={pending}
        className={`h-10 w-20 rounded-full p-1 flex items-center select-none transition-colors duration-300 ease-out disabled:opacity-40 shrink-0 ${
          !isOn ? 'bg-slate-300 justify-start'
          : previewOff ? 'bg-amber-500 justify-end animate-pulse'
          : 'bg-accent-600 justify-end'
        }`}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          className="size-8 rounded-full bg-white shadow-[0_2px_8px_-2px_rgba(15,23,42,0.35)] flex items-center justify-center"
        >
          <ChefHat className={`size-4 ${!isOn ? 'text-slate-400' : previewOff ? 'text-amber-600' : 'text-accent-600'}`} />
        </motion.span>
      </button>
    </div>
  )
}

/* Card action base — 48px+ target, physical press feedback, 0.25s ease-out
   so the FIFO promotion swap (quiet → accent) reads as a deliberate change. */
const BTN_BASE =
  'rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 select-none transition-all duration-[250ms] ease-out active:translate-y-px disabled:opacity-40 disabled:active:translate-y-0'

/* Primary — the one solid accent CTA per lane, on the next-to-act card. */
const PRIMARY_BTN = `${BTN_BASE} h-14 bg-accent-600 text-white shadow-[0_6px_16px_-6px_rgba(5,150,105,0.5)] active:bg-accent-700`

/* Secondary — every repeated lane action below the first card, and every shortcut. */
const SECONDARY_BTN = `${BTN_BASE} h-12 bg-white border border-slate-200 text-slate-700 shadow-sm active:bg-slate-50`

/* A prep lane: caps header + count, then a scrolling column of flat tickets. */
function Lane({ label, count, pulse = false, empty, children }: {
  label: string
  count: number
  pulse?: boolean
  empty: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-1.5 pb-2 shrink-0">
        {pulse && <span className="size-2 rounded-full bg-amber-500 animate-pulse" />}
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <span className="ms-auto min-w-6 h-6 px-1.5 rounded-full bg-white border border-slate-200 text-slate-500 text-xs font-bold flex items-center justify-center tabular-nums shadow-sm">
          {count}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin space-y-2 px-0.5 pb-1">
        {count === 0 ? empty : (
          <AnimatePresence initial={false}>{children}</AnimatePresence>
        )}
      </div>
    </section>
  )
}

/* A single order as a flat white card: mono number tile · bill/name ·
   escalating wait pill, optional notes strip, then the lane's action(s). */
function Ticket({ entry, now, children }: {
  entry: QueueEntryDTO
  now: number
  children: React.ReactNode
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="rounded-2xl bg-white border border-slate-200 shadow-sm p-3 space-y-3"
    >
      <div className="flex items-center gap-3">
        <span className="size-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center font-mono font-black text-xl tabular-nums shrink-0" dir="ltr">
          {entry.queueNumber}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 truncate">
            {entry.billNumber ? `Bill ${entry.billNumber}` : `#${entry.queueNumber}`}
          </p>
          <p className="text-xs text-slate-400 truncate">{entry.customerName || 'Walk-in'}</p>
        </div>
        <ElapsedPill mins={minutesSince(entry.joinedAt, now)} />
      </div>
      {entry.notes && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          <span className="shrink-0">⚠</span>
          <span className="leading-5">{entry.notes}</span>
        </div>
      )}
      {children}
    </motion.div>
  )
}

/* Calm empty lane: flat icon tile + short message. */
function LaneEmpty({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 px-4">
      <div className="size-14 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center mb-3">
        <Icon className="size-6 text-slate-300" />
      </div>
      <p className="text-sm font-semibold text-slate-500">{title}</p>
      <p className="text-xs mt-1 max-w-52">{sub}</p>
    </div>
  )
}
