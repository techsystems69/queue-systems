'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Image from 'next/image'
import { Volume2 } from 'lucide-react'
import { SchoolAdRail, type SchoolAd } from '@/components/school/SchoolAdRail'
import { DisplayClock } from '@/components/display/DisplayClock'
import { useSchoolBoard } from '@/lib/hooks/useSchoolBoard'
import { SchoolAnnouncer } from '@/lib/school/announce'
import type { SchoolBoardPacket } from '@/lib/db/school-types'
import type { Locale } from '@/lib/region'
import { coerceLocales, defaultLocale, dirFor, pickLocale, regionLocales } from '@/lib/region'

// The board renders in the market's base locale (lib/region.ts) — a single
// public screen, one language, like the school kiosk's primary column.
type BoardCopy = Record<Locale, {
  tokenNo: string; counter: string; status: string
  pleaseProceed: string; available: string; noCounters: string
  nowCalling: string; callingAgain: string
  notActive: string; enableSound: string; enableSoundHint: string
}>
const BOARD_COPY: BoardCopy = {
  en: {
    tokenNo: 'TOKEN NO.', counter: 'COUNTER', status: 'STATUS',
    pleaseProceed: 'Please proceed', available: 'Available',
    noCounters: 'No counters are open right now',
    nowCalling: 'Now calling', callingAgain: 'Calling again',
    notActive: 'This display is not active.',
    enableSound: 'Tap anywhere to enable sound',
    enableSoundHint: 'Announcements and ad audio',
  },
  ar: {
    tokenNo: 'رقم التذكرة', counter: 'الشباك', status: 'الحالة',
    pleaseProceed: 'يرجى التوجه', available: 'متاح',
    noCounters: 'لا توجد شبابيك مفتوحة الآن',
    nowCalling: 'النداء الآن', callingAgain: 'إعادة النداء',
    notActive: 'هذه الشاشة غير مفعّلة.',
    enableSound: 'انقر في أي مكان لتفعيل الصوت',
    enableSoundHint: 'الإعلانات وصوت الإعلانات',
  },
  mr: {
    tokenNo: 'टोकन क्र.', counter: 'काउंटर', status: 'स्थिती',
    pleaseProceed: 'कृपया पुढे या', available: 'उपलब्ध',
    noCounters: 'सध्या कोणतेही काउंटर उघडे नाही',
    nowCalling: 'आता बोलावत आहे', callingAgain: 'पुन्हा बोलावत आहे',
    notActive: 'हा डिस्प्ले सक्रिय नाही.',
    enableSound: 'आवाज सुरू करण्यासाठी कुठेही स्पर्श करा',
    enableSoundHint: 'घोषणा आणि जाहिरात आवाज',
  },
  hi: {
    tokenNo: 'टोकन नं.', counter: 'काउंटर', status: 'स्थिति',
    pleaseProceed: 'कृपया आगे बढ़ें', available: 'उपलब्ध',
    noCounters: 'अभी कोई काउंटर खुला नहीं है',
    nowCalling: 'अभी बुला रहे हैं', callingAgain: 'फिर से बुला रहे हैं',
    notActive: 'यह डिस्प्ले सक्रिय नहीं है.',
    enableSound: 'ध्वनि चालू करने के लिए कहीं भी स्पर्श करें',
    enableSoundHint: 'घोषणाएँ और विज्ञापन ध्वनि',
  },
}

// Guest waiting-area board. Light canvas to match the rest of the product,
// mono token numbers sized with clamp() to stay legible from across a lobby,
// one row per open service window (a quiet window stays on the board instead of
// scrolling away), an auto-rotating ad rail on the right, and a one-shot
// "now calling" overlay. Nothing here is tappable except the audio curtain.

const FLASH_MS = 8000

export function SchoolBoard({ screenToken, initial }: {
  screenToken: string
  initial: SchoolBoardPacket
}) {
  const { packet, lastCall } = useSchoolBoard(screenToken, initial)
  const boardLocale = defaultLocale()
  const bc = BOARD_COPY[boardLocale] ?? BOARD_COPY.en
  const boardRtl = dirFor(boardLocale) === 'rtl'
  // Which locales the announcer speaks. Phase 2: the RPC emits announceLocales
  // from school_settings.languages. Fall back to the screen's announcement_lang
  // for an un-migrated board packet ('both' → every market locale).
  const announceLocales: Locale[] = packet.announceLocales?.length
    ? coerceLocales(packet.announceLocales)
    : packet.announcementLang === 'both'
      ? regionLocales()
      : coerceLocales(packet.announcementLang ? [packet.announcementLang] : [boardLocale])
  // Lazy initialiser rather than a ref written during render: the announcer is
  // created once, and reading it while rendering stays legal.
  const [announcer] = useState(() => new SchoolAnnouncer())
  const [audioReady, setAudioReady] = useState(false)
  // Flash is derived, not stored: the overlay shows the latest call until its
  // key is dismissed. Storing a copy would mean writing state from an effect
  // on every call.
  const [dismissedKey, setDismissedKey] = useState(0)
  const flash = lastCall && lastCall.key !== dismissedKey ? lastCall : null

  useEffect(() => {
    // The Android WebView injects window.AndroidTTS after the bundle loads, so
    // this capability can only be read on the client, after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (announcer.isReady) setAudioReady(true)
  }, [announcer])

  // `lastCall.key` increments on every call event, so a recall of the same
  // token re-runs this effect and re-announces.
  useEffect(() => {
    if (!lastCall) return

    if (packet.announceEnabled !== false && audioReady) {
      announcer.announce({
        tokenCode: lastCall.tokenCode,
        counter: lastCall.counter ?? { en: lastCall.counterEn, ar: lastCall.counterAr },
        templates: packet.announceTemplateI18n ?? {
          en: packet.announceTemplateEn ?? 'Token {token}, please proceed to {counter}',
          ar: packet.announceTemplateAr ?? '',
        },
        locales: announceLocales,
      })
    }

    const key = lastCall.key
    const t = setTimeout(() => setDismissedKey(key), FLASH_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCall?.key, audioReady])

  const ads: SchoolAd[] = useMemo(
    () =>
      (packet.ads ?? [])
        .filter((a) => a.is_active)
        .map((a) => ({
          id: a.id,
          src: a.file_url,
          type: a.file_type,
          durationMs: (a.duration_seconds || 8) * 1000,
          audioEnabled: a.audio_enabled ?? false,
        })),
    [packet.ads]
  )

  const tickerLines = (packet.tickers ?? []).map((t) => t.message)
  const ticker = [packet.tickerText, ...tickerLines].filter(Boolean).join('   •   ')
  const counters = (packet.counters ?? []).filter((c) => c.is_open)
  const hasAds = ads.length > 0
  // With no ad rail eating the width, a long row of windows reads better as a
  // two-up grid than a tall stack of short bars.
  const twoCol = !hasAds && counters.length > 6

  if (packet.status === 'expired') {
    return (
      <div className="flex h-dvh w-screen items-center justify-center bg-slate-50 text-slate-500">
        <p className="text-2xl font-semibold" dir={dirFor(boardLocale)}>{bc.notActive}</p>
      </div>
    )
  }

  return (
    <div
      dir={dirFor(boardLocale)}
      className="relative flex h-dvh w-screen flex-col overflow-hidden bg-slate-50 text-slate-900"
    >
      {/* Header */}
      <header className="flex shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
        {packet.logoUrl ? (
          <Image
            src={packet.logoUrl}
            alt=""
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-lg object-contain"
            unoptimized
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p
            className="truncate font-bold leading-tight text-slate-900"
            style={{ fontSize: 'clamp(1.2rem, 2.2vw, 2.4rem)' }}
          >
            {packet.schoolName}
          </p>
          {regionLocales().slice(1).map((l) => {
            const name = packet.schoolNameI18n?.[l] || (l === 'ar' ? packet.schoolNameAr : '')
            return name ? (
              <p key={l} dir={dirFor(l)} className="truncate text-slate-500" style={{ fontSize: 'clamp(0.8rem, 1.2vw, 1.3rem)' }}>
                {name}
              </p>
            ) : null
          })}
        </div>
        {packet.scoped && (packet.departments ?? []).length > 0 && (
          // A department display says whose queue it is — the lobby TV and
          // the Fees-wing TV otherwise look identical.
          <div className="flex max-w-[40%] flex-wrap justify-end gap-2">
            {(packet.departments ?? []).map((d) => (
              <span
                key={d.id}
                className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 font-semibold text-slate-700"
                style={{ fontSize: 'clamp(0.9rem, 1.4vw, 1.5rem)' }}
              >
                <span className="size-3 rounded-full" style={{ backgroundColor: d.color }} />
                {d.name?.[boardLocale] || d.name?.en || d.name_en}
              </span>
            ))}
          </div>
        )}
        {packet.showClock !== false && (
          <DisplayClock timeColor="#0F172A" dateColor="#64748B" />
        )}
      </header>

      {/* Board + ads */}
      <div className="flex min-h-0 flex-1">
        <main className={hasAds ? 'flex min-w-0 flex-[62] flex-col' : 'flex min-w-0 flex-1 flex-col'}>
          <div className="grid shrink-0 grid-cols-[1fr_1fr_1fr] gap-4 border-b border-slate-200 bg-white px-6 py-2 text-slate-500">
            <HeaderCell label={bc.tokenNo} dir={dirFor(boardLocale)} />
            <HeaderCell label={bc.counter} dir={dirFor(boardLocale)} />
            <HeaderCell label={bc.status} dir={dirFor(boardLocale)} />
          </div>

          <div
            className={
              twoCol
                ? 'grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-3 p-3'
                : 'flex min-h-0 flex-1 flex-col gap-2.5 p-3'
            }
          >
            {counters.length === 0 ? (
              <div className="col-span-full flex flex-1 items-center justify-center text-slate-400">
                <p style={{ fontSize: 'clamp(1rem, 2vw, 2rem)' }}>{bc.noCounters}</p>
              </div>
            ) : (
              counters.map((counter) => {
                const isFlashing = flash?.tokenCode && flash.tokenCode === counter.token_code
                const called = !!counter.token_code
                return (
                  <motion.div
                    key={counter.id}
                    animate={isFlashing ? { scale: [1, 1.03, 1] } : { scale: 1 }}
                    transition={{ duration: 0.25 }}
                    className={
                      'grid min-h-0 flex-1 grid-cols-[1fr_1fr_1fr] items-center gap-4 rounded-2xl border px-6 ' +
                      (called
                        ? 'border-accent-600 bg-accent-600 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-900')
                    }
                  >
                    <p
                      dir="ltr"
                      className="truncate font-mono font-black tabular-nums"
                      style={{ fontSize: 'clamp(2rem, 6.5vw, 6.5rem)' }}
                    >
                      {counter.token_code ?? '—'}
                    </p>
                    <div className="min-w-0">
                      <p className="truncate font-semibold" style={{ fontSize: 'clamp(1rem, 2.4vw, 2.6rem)' }}>
                        {pickLocale(counter.name, boardLocale) || counter.name_en}
                      </p>
                      {(pickLocale(counter.department, boardLocale) || counter.department_en) && (
                        <p
                          className={called ? 'truncate text-white/80' : 'truncate text-slate-500'}
                          style={{ fontSize: 'clamp(0.7rem, 1.1vw, 1.2rem)' }}
                        >
                          {pickLocale(counter.department, boardLocale) || counter.department_en}
                        </p>
                      )}
                    </div>
                    <p
                      className="truncate font-semibold"
                      style={{ fontSize: 'clamp(0.9rem, 2vw, 2.2rem)' }}
                    >
                      {called ? bc.pleaseProceed : bc.available}
                    </p>
                  </motion.div>
                )
              })
            )}
          </div>

          {/* Waiting counts — the "how long until me" question the token
              alone can't answer. */}
          {(packet.departments ?? []).length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-6 py-2">
              {(packet.departments ?? []).map((d) => (
                <span
                  key={d.id}
                  className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1"
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-slate-600" style={{ fontSize: 'clamp(0.65rem, 0.9vw, 1rem)' }}>
                    {pickLocale(d.name, boardLocale) || d.name_en}
                  </span>
                  <span
                    dir="ltr"
                    className="font-mono font-bold tabular-nums text-slate-900"
                    style={{ fontSize: 'clamp(0.7rem, 1vw, 1.1rem)' }}
                  >
                    {d.waiting}
                  </span>
                </span>
              ))}
            </div>
          )}
        </main>

        {hasAds && (
          <aside className="min-w-0 flex-[38] border-s border-slate-200">
            <SchoolAdRail ads={ads} audioReady={audioReady} />
          </aside>
        )}
      </div>

      {/* Ticker */}
      {ticker && (
        <footer className="flex shrink-0 items-stretch overflow-hidden border-t border-slate-200 bg-white">
          <div className="w-1.5 shrink-0 bg-accent-600" />
          <div className="flex-1 overflow-hidden py-2">
            <div
              className={
                boardRtl
                  ? 'animate-[school-marquee-rtl_38s_linear_infinite] whitespace-nowrap'
                  : 'animate-[school-marquee_38s_linear_infinite] whitespace-nowrap'
              }
            >
              <span className="px-8 text-slate-600" style={{ fontSize: 'clamp(0.8rem, 1.2vw, 1.4rem)' }}>
                {ticker}
              </span>
            </div>
          </div>
        </footer>
      )}

      {/* One-shot call overlay */}
      <AnimatePresence>
        {flash && (
          <motion.div
            key={flash.key}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-8 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.92, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              className="flex w-full max-w-4xl flex-col items-center rounded-3xl border border-slate-200 bg-white px-10 py-12 text-center shadow-2xl"
            >
              <p className="font-semibold uppercase tracking-[0.2em] text-slate-400" style={{ fontSize: 'clamp(0.9rem, 1.6vw, 1.6rem)' }}>
                {flash.recallCount > 0 ? bc.callingAgain : bc.nowCalling}
              </p>
              <p
                dir="ltr"
                className="font-mono font-black tabular-nums text-accent-600"
                style={{ fontSize: 'clamp(5rem, 18vw, 16rem)', lineHeight: 1 }}
              >
                {flash.tokenCode}
              </p>
              <p className="mt-3 font-semibold text-slate-900" style={{ fontSize: 'clamp(1.4rem, 4vw, 3.5rem)' }}>
                {pickLocale(flash.counter, boardLocale) || flash.counterEn}
              </p>
              {(pickLocale(flash.department, boardLocale) || flash.departmentEn) && (
                <p className="text-slate-500" style={{ fontSize: 'clamp(0.9rem, 1.6vw, 1.6rem)' }}>
                  {pickLocale(flash.department, boardLocale) || flash.departmentEn}
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Browsers block audio until a gesture. The Android shell sets
          mediaPlaybackRequiresUserGesture=false, so it never sees this. */}
      {!audioReady && packet.announceEnabled !== false && (
        <button
          type="button"
          onClick={() => {
            announcer.unlock()
            setAudioReady(true)
          }}
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-white/95 text-slate-700"
        >
          <Volume2 className="size-12 text-accent-600" />
          <span className="text-2xl font-semibold">{bc.enableSound}</span>
          <span className="text-sm text-slate-500">{bc.enableSoundHint}</span>
        </button>
      )}
    </div>
  )
}

function HeaderCell({ label, dir }: { label: string; dir: 'rtl' | 'ltr' }) {
  return (
    <div className="min-w-0" dir={dir}>
      <p className="truncate font-semibold tracking-wider" style={{ fontSize: 'clamp(0.7rem, 1.1vw, 1.2rem)' }}>
        {label}
      </p>
    </div>
  )
}
