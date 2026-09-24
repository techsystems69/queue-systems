'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Accessibility, ArrowRightLeft, Check, ChevronDown, Loader2, Printer, Star,
  Ticket, TriangleAlert, Users,
} from 'lucide-react'
import { ConfirmCancel, useNow, minutesSince, formatElapsed } from '@/components/counter/console'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QRCodeCanvas } from 'qrcode.react'
import {
  schoolIssueTokenAction, schoolKioskCancelTokenAction,
  schoolKioskMoveTokenAction, schoolKioskSetPriorityAction,
  schoolKioskWaitingAheadAction,
} from '@/lib/actions/school-tokens'
import { fetchSchoolKioskFeedAction } from '@/lib/actions/school-read'
import {
  printSchoolTicket, prepareTicketLogo, prepareTicketQr, waitingAheadLine,
  qrCaptionLine, SCHOOL_PAPER, QR_SOURCE_PX, QR_TARGET_MM,
} from '@/lib/school/printTicket'
import type { TicketLogo } from '@/lib/school/printTicket'
import { publicTrackingUrl } from '@/lib/school/constants'
import { formatDate, formatTime } from '@/lib/queueUtils'
import type {
  SchoolDepartmentDTO, SchoolSettingsDTO, SchoolTokenDTO, SchoolTokenStatus,
  SchoolLanguage, SchoolKioskFeed,
} from '@/lib/db/school-types'
import type { Locale } from '@/lib/region'
import { coerceLocales, defaultLocale, dirFor, LOCALE_LABEL, pickLocale } from '@/lib/region'

interface Props {
  branchToken: string
  branchName: string
  departments: SchoolDepartmentDTO[]
  settings: SchoolSettingsDTO | null
  silentPrintEnabled: boolean
  printerName: string
  initialFeed: SchoolKioskFeed
  // Effective public-tracking gate (distributor grant AND the school's own
  // switch) — see lib/dal/school-limits.ts#getSchoolPublicTrackingEnabled.
  // Gates the QR on the printed ticket only; nothing else on the kiosk reads
  // this.
  publicTrackingEnabled: boolean
}

const FEED_POLL_MS = 20000
const RECENT_LIMIT = 30

const COPY = {
  en: {
    prompt: 'Please select a service',
    promptHint: 'Touch a service to take a number',
    priority: 'Priority assistance',
    priorityHint: 'Senior citizens and visitors needing assistance',
    priorityArmed: 'Next ticket will be priority',
    yourToken: 'Your token number',
    watch: 'Please watch the screen for your number',
    printing: 'Printing your ticket…',
    printFailed: 'The printer is unavailable. Please note your number.',
    issuing: 'Issuing…',
    waitingHere: 'waiting',
    noneWaiting: 'no queue',
    recent: 'Today’s tickets',
    recentEmpty: 'Tickets issued here will appear in this list.',
    heroEmpty: 'Your ticket will appear here',
    inQueue: 'in queue',
    issuedToday: 'issued today',
    reprint: 'Reprint',
    move: 'Move',
    moveTitle: 'Move to another service',
    makePriority: 'Mark priority',
    clearPriority: 'Clear priority',
    priorityTag: 'Priority',
    cancel: 'Cancel',
  },
  ar: {
    prompt: 'يرجى اختيار الخدمة',
    promptHint: 'المس الخدمة للحصول على رقم',
    priority: 'مساعدة ذوي الأولوية',
    priorityHint: 'كبار السن والزوار الذين يحتاجون إلى مساعدة',
    priorityArmed: 'التذكرة التالية ذات أولوية',
    yourToken: 'رقم تذكرتك',
    watch: 'يرجى متابعة الشاشة لظهور رقمك',
    printing: 'جارٍ طباعة التذكرة…',
    printFailed: 'الطابعة غير متاحة. يرجى تدوين رقمك.',
    issuing: 'جارٍ الإصدار…',
    waitingHere: 'في الانتظار',
    noneWaiting: 'لا يوجد انتظار',
    recent: 'تذاكر اليوم',
    recentEmpty: 'ستظهر التذاكر الصادرة هنا في هذه القائمة.',
    heroEmpty: 'ستظهر تذكرتك هنا',
    inQueue: 'في الطابور',
    issuedToday: 'صدرت اليوم',
    reprint: 'إعادة طباعة',
    move: 'نقل',
    moveTitle: 'النقل إلى خدمة أخرى',
    makePriority: 'تعيين كأولوية',
    clearPriority: 'إلغاء الأولوية',
    priorityTag: 'أولوية',
    cancel: 'إلغاء التذكرة',
  },
  mr: {
    prompt: 'कृपया सेवा निवडा',
    promptHint: 'क्रमांक घेण्यासाठी सेवेला स्पर्श करा',
    priority: 'प्राधान्य सहाय्य',
    priorityHint: 'ज्येष्ठ नागरिक आणि सहाय्याची गरज असलेले अभ्यागत',
    priorityArmed: 'पुढील तिकीट प्राधान्याचे असेल',
    yourToken: 'तुमचा टोकन क्रमांक',
    watch: 'तुमच्या क्रमांकासाठी कृपया स्क्रीनकडे लक्ष द्या',
    printing: 'तुमचे तिकीट छापत आहे…',
    printFailed: 'प्रिंटर उपलब्ध नाही. कृपया तुमचा क्रमांक लक्षात ठेवा.',
    issuing: 'देत आहे…',
    waitingHere: 'प्रतीक्षेत',
    noneWaiting: 'रांग नाही',
    recent: 'आजची तिकिटे',
    recentEmpty: 'येथे दिलेली तिकिटे या यादीत दिसतील.',
    heroEmpty: 'तुमचे तिकीट येथे दिसेल',
    inQueue: 'रांगेत',
    issuedToday: 'आज दिलेली',
    reprint: 'पुन्हा छापा',
    move: 'हलवा',
    moveTitle: 'दुसऱ्या सेवेकडे हलवा',
    makePriority: 'प्राधान्य द्या',
    clearPriority: 'प्राधान्य काढा',
    priorityTag: 'प्राधान्य',
    cancel: 'रद्द करा',
  },
  hi: {
    prompt: 'कृपया सेवा चुनें',
    promptHint: 'नंबर लेने के लिए सेवा को स्पर्श करें',
    priority: 'प्राथमिकता सहायता',
    priorityHint: 'वरिष्ठ नागरिक और सहायता चाहने वाले आगंतुक',
    priorityArmed: 'अगला टिकट प्राथमिकता वाला होगा',
    yourToken: 'आपका टोकन नंबर',
    watch: 'अपने नंबर के लिए कृपया स्क्रीन देखें',
    printing: 'आपका टिकट प्रिंट हो रहा है…',
    printFailed: 'प्रिंटर उपलब्ध नहीं है. कृपया अपना नंबर नोट करें.',
    issuing: 'जारी हो रहा है…',
    waitingHere: 'प्रतीक्षा में',
    noneWaiting: 'कोई कतार नहीं',
    recent: 'आज के टिकट',
    recentEmpty: 'यहाँ जारी किए गए टिकट इस सूची में दिखाई देंगे.',
    heroEmpty: 'आपका टिकट यहाँ दिखाई देगा',
    inQueue: 'कतार में',
    issuedToday: 'आज जारी',
    reprint: 'पुनः प्रिंट',
    move: 'स्थानांतरित करें',
    moveTitle: 'दूसरी सेवा में स्थानांतरित करें',
    makePriority: 'प्राथमिकता दें',
    clearPriority: 'प्राथमिकता हटाएँ',
    priorityTag: 'प्राथमिकता',
    cancel: 'रद्द करें',
  },
} as const

type StatusCopy = Record<Locale, string> & { className: string }
const STATUS: Record<SchoolTokenStatus, StatusCopy> = {
  waiting: { en: 'Waiting', ar: 'في الانتظار', mr: 'प्रतीक्षेत', hi: 'प्रतीक्षारत', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  called: { en: 'Called', ar: 'تم النداء', mr: 'बोलावले', hi: 'बुलाया गया', className: 'bg-accent-50 text-accent-700 border-accent-200' },
  held: { en: 'On hold', ar: 'معلّق', mr: 'रोखलेले', hi: 'होल्ड पर', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  served: { en: 'Served', ar: 'تمت الخدمة', mr: 'सेवा पूर्ण', hi: 'सेवा पूर्ण', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'no-show': { en: 'No-show', ar: 'لم يحضر', mr: 'अनुपस्थित', hi: 'अनुपस्थित', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  cancelled: { en: 'Cancelled', ar: 'ملغاة', mr: 'रद्द', hi: 'रद्द', className: 'bg-slate-100 text-slate-400 border-slate-200' },
}

// A queued ticket carries its own department: a reprint from the recent list
// can be for a service other than the one last tapped.
// The number the last visitor took, as the screen and the ticket both need it.
interface HeroTicket {
  token: SchoolTokenDTO
  department: SchoolDepartmentDTO
  waitingAhead: number | null
}

interface PrintJob {
  key: number
  token: SchoolTokenDTO
  department: SchoolDepartmentDTO
  // People still ahead of this token when the job was queued. Null when the
  // server couldn't be asked (a reprint with the network down) — the ticket
  // then prints without the line rather than with a number that isn't true.
  waitingAhead: number | null
}

/*
 * Lobby kiosk.
 *
 * The service grid is mounted for the whole session and never swapped out —
 * issuing a number is a side effect, not a page transition. That is the single
 * decision the rest of this file follows from: the visitor behind you can tap
 * while your ticket is still coming out of the printer, so printing runs off a
 * queue instead of blocking the tap, and the ticket you just took is shown in
 * the rail rather than over the grid.
 *
 * The rail also carries today's tickets with the two corrections that belong at
 * the lobby end of the queue — wrong service, and priority missed — plus a
 * reprint for the ticket the printer ate. What a counter has already called is
 * read-only here; see schoolKioskCancelTokenAction for why.
 */
export function SchoolKiosk({
  branchToken, branchName, departments, settings, silentPrintEnabled, printerName,
  initialFeed, publicTrackingEnabled,
}: Props) {
  const languages = coerceLocales(settings?.languages)
  const [lang, setLang] = useState<Locale>(languages[0])
  const [priority, setPriority] = useState(false)
  const [issuingId, setIssuingId] = useState<string | null>(null)
  const [hero, setHero] = useState<HeroTicket | null>(null)
  const [feed, setFeed] = useState<SchoolKioskFeed>(initialFeed)
  const [busyTokenId, setBusyTokenId] = useState<string | null>(null)
  const [moveFor, setMoveFor] = useState<SchoolTokenDTO | null>(null)
  // One open action tray at a time: the rail stays a list, not a stack of forms.
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [printing, setPrinting] = useState<PrintJob | null>(null)
  // Token ids with a print still owed, so the card can say "printing…" for the
  // gap between the tap and the job actually reaching the head of the chain.
  const [printBusy, setPrintBusy] = useState<string[]>([])
  const [printFailedFor, setPrintFailedFor] = useState<string | null>(null)
  const [ticketLogo, setTicketLogo] = useState<TicketLogo | null>(null)
  const printRef = useRef<HTMLDivElement>(null)
  const printChain = useRef<Promise<void>>(Promise.resolve())
  const jobKey = useRef(0)
  // Scratch canvas: renders the current job's tracking URL off-screen so
  // prepareTicketQr can read it back as a crisp bitmap. Never shown to the
  // visitor — the printable ticket gets the derived <img> instead. See
  // prepareTicketQr's comment in lib/school/printTicket.ts for why.
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)
  const qrImgRef = useRef<HTMLImageElement>(null)
  const now = useNow(15000)

  const t = COPY[lang] ?? COPY[defaultLocale()] ?? COPY.en
  const rtl = dirFor(lang) === 'rtl'
  const idleSeconds = settings?.kioskIdleSeconds ?? 20
  const priorityEnabled = settings?.priorityEnabled ?? true
  const printEnabled = settings?.printEnabled ?? true
  const schoolName =
    (settings ? pickLocale(settings.schoolName, lang) : '') || settings?.schoolNameEn || branchName

  // The printed ticket carries every enabled language, base locale first — it is
  // read by whoever picks the ticket up, not by the person who set the kiosk
  // language. (Phase 1: only en/ar have content columns; mr/hi department names
  // and footers fall back / stay blank until the jsonb migration.)
  const printLocale = languages[0]
  const ticketLocales = languages
  const ticketDeptName = (l: Locale, d: SchoolDepartmentDTO) =>
    pickLocale(d.name, l) || d.nameEn
  const ticketFooter = (l: Locale) =>
    settings ? (settings.ticketFooter[l] ?? (l === 'en' ? settings.ticketFooterEn : '')) : ''

  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments]
  )
  const deptName = useCallback(
    (d: SchoolDepartmentDTO | undefined) =>
      !d ? '' : pickLocale(d.name, lang) || d.nameEn,
    [lang]
  )

  const recent = feed.recent ?? []
  const waitingByDepartment = feed.waitingByDepartment ?? {}

  // ── Feed ────────────────────────────────────────────────────
  // The school tables are service-role-only, so the kiosk can't subscribe with
  // the publishable key; it polls, exactly like the counter console.
  const refresh = useCallback(async () => {
    const next = await fetchSchoolKioskFeedAction(branchToken)
    if (next.status === 'ok') setFeed(next)
  }, [branchToken])

  // Pause while the tab is hidden — a backgrounded kiosk has no visitor reading
  // the rail, and every issued token folds itself into the feed optimistically.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined
    const start = () => { if (id === undefined) id = setInterval(refresh, FEED_POLL_MS) }
    const stop = () => { if (id !== undefined) { clearInterval(id); id = undefined } }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { refresh(); start() }
      else stop()
    }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [refresh])

  // ── Printing ────────────────────────────────────────────────
  const enqueuePrint = useCallback((
    token: SchoolTokenDTO,
    department: SchoolDepartmentDTO,
    waitingAhead: number | null
  ) => {
    jobKey.current += 1
    const job: PrintJob = { key: jobKey.current, token, department, waitingAhead }
    setPrintBusy((b) => [...b, token.id])

    // Chained rather than pumped from an effect: each job owns the single
    // hidden ticket node for the whole of its capture, so a second visitor
    // tapping mid-print can't swap the DOM out from under html2canvas.
    printChain.current = printChain.current.then(async () => {
      setPrinting(job)
      // One paint so the ticket for THIS job exists before it's rasterised,
      // and so a preloaded logo has decoded. The off-screen QR canvas (keyed
      // off `printing`, see qrValue below) repaints on this same commit —
      // 120ms of real time is ample for its own effect to have run by the
      // time the read below happens.
      await new Promise((r) => setTimeout(r, 120))
      if (publicTrackingEnabled && qrCanvasRef.current && qrImgRef.current) {
        const qr = prepareTicketQr(qrCanvasRef.current)
        // Written straight to the DOM rather than through React state: both
        // capture paths (html2canvas re-rendering the live DOM, and the
        // desktop path's el.innerHTML string read) pick up whatever the
        // <img>'s src attribute already is at the moment they run, and this
        // guarantees it's set before either can fire.
        if (qr) qrImgRef.current.src = qr.src
      }
      const el = printRef.current
      const method = el
        ? await printSchoolTicket(el, { silentPrintEnabled, printerName })
        : 'failed'
      setPrintFailedFor(method === 'failed' ? job.token.tokenCode : null)
      setPrinting(null)
      setPrintBusy((b) => b.filter((id) => id !== token.id))
    })
  }, [silentPrintEnabled, printerName, publicTrackingEnabled])

  const heroPrinting = !!hero && printBusy.includes(hero.token.id)

  // Convert the logo to the 1-bit bitmap the head will actually print, once
  // per kiosk session. This doubles as the preload it replaces: the first
  // print fires within ~100ms of the tap, too fast for a cold image decode,
  // and a data URL needs neither a fetch nor a CORS round-trip at capture time.
  useEffect(() => {
    const url = settings?.logoUrl
    if (!url) return
    let cancelled = false
    prepareTicketLogo(url).then((logo) => {
      if (!cancelled) setTicketLogo(logo)
    })
    return () => { cancelled = true }
  }, [settings?.logoUrl])

  // Auto-reset so the next visitor always meets a neutral screen. The grid
  // itself never went anywhere, so this only clears what was personal to the
  // last visitor: their number, their priority tap, their language.
  useEffect(() => {
    if (!hero) return
    const timer = setTimeout(() => {
      setHero(null)
      setPriority(false)
      setPrintFailedFor(null)
      setLang(languages[0])
    }, idleSeconds * 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero, idleSeconds])

  // ── Issue ───────────────────────────────────────────────────
  async function selectDepartment(department: SchoolDepartmentDTO) {
    if (issuingId) return
    setIssuingId(department.id)
    setPrintFailedFor(null)

    const result = await schoolIssueTokenAction(
      branchToken,
      department.id,
      priority || department.isPriority,
      // The language on screen right now — the tracker page the ticket's QR
      // points at opens in it.
      lang
    )
    setIssuingId(null)

    if (result.error || !result.token) {
      toast.error(result.error ?? 'Please ask for assistance')
      return
    }

    // Committed before printing is attempted, and shown regardless — a printer
    // failure must never leave a visitor with no number at all.
    const token = result.token
    const waitingAhead = result.waitingAhead ?? null
    setHero({ token, department, waitingAhead })
    setPriority(false)

    // Optimistic, so the rail moves on the same frame as the tap; the next
    // poll reconciles it against the server.
    setFeed((f) => ({
      ...f,
      recent: [token, ...(f.recent ?? [])].slice(0, RECENT_LIMIT),
      waitingTotal: (f.waitingTotal ?? 0) + 1,
      issuedToday: (f.issuedToday ?? 0) + 1,
      waitingByDepartment: {
        ...(f.waitingByDepartment ?? {}),
        [department.id]: (f.waitingByDepartment?.[department.id] ?? 0) + 1,
      },
    }))

    if (printEnabled) enqueuePrint(token, department, waitingAhead)
    refresh()
  }

  // ── Row actions ─────────────────────────────────────────────
  const runOnToken = useCallback(async (
    token: SchoolTokenDTO,
    fn: () => Promise<{ token?: SchoolTokenDTO; error?: string }>,
    success: string
  ) => {
    setBusyTokenId(token.id)
    const result = await fn()
    setBusyTokenId(null)
    if (result.error) toast.error(result.error)
    else toast.success(success)
    await refresh()
    return result
  }, [refresh])

  function cancelToken(token: SchoolTokenDTO) {
    setOpenRow(null)
    runOnToken(
      token,
      () => schoolKioskCancelTokenAction(branchToken, token.id),
      `${token.tokenCode} cancelled`
    ).then((r) => {
      if (!r.error && hero?.token.id === token.id) setHero(null)
    })
  }

  function togglePriority(token: SchoolTokenDTO) {
    runOnToken(
      token,
      () => schoolKioskSetPriorityAction(branchToken, token.id, !token.isPriority),
      token.isPriority ? `${token.tokenCode} is no longer priority` : `${token.tokenCode} marked priority`
    )
  }

  function moveToken(token: SchoolTokenDTO, target: SchoolDepartmentDTO) {
    setMoveFor(null)
    setOpenRow(null)
    runOnToken(
      token,
      () => schoolKioskMoveTokenAction(branchToken, token.id, target.id),
      `${token.tokenCode} moved to ${target.nameEn}`
    )
  }

  // The queue moves while a ticket sits in the rail, so the count is read
  // again rather than reprinted from the issue. It is a best-effort read: if
  // it fails, the reprint still happens, just without that line.
  async function reprint(token: SchoolTokenDTO) {
    const department = deptById.get(token.departmentId)
    if (!department) return
    setPrintFailedFor(null)
    const ahead = await schoolKioskWaitingAheadAction(branchToken, token.id)
    enqueuePrint(token, department, ahead.waitingAhead ?? null)
  }

  const printedTicket = printing ?? (hero ? { key: -1, ...hero } : null)

  // The URL the scratch QR canvas (and, after prepareTicketQr, the printed
  // ticket) encodes. Tracks `printedTicket` rather than `hero`/`printing`
  // separately so the canvas always has the QR for whichever job is about to
  // be captured — see the wait in enqueuePrint.
  const qrValue = publicTrackingEnabled && printedTicket
    ? publicTrackingUrl(
        printedTicket.token.publicCode,
        typeof window !== 'undefined' ? window.location.origin : ''
      )
    : ''
  // Bare host+path for the fallback line under the QR — shorter than the
  // full https:// URL on a 48mm-wide ticket, and still enough to type by
  // hand if a scan fails.
  const qrDisplayValue = qrValue.replace(/^https?:\/\//, '')

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="flex h-dvh w-screen flex-col overflow-hidden bg-slate-100">
      <style>{`
        #school-ticket.rawbt-capturing { display: block !important; position: fixed; left: -9999px; top: 0; }
        @media print {
          .no-print { display: none !important; }
          #school-ticket { display: block !important; width: ${SCHOOL_PAPER.paperMm}mm; }
        }
      `}</style>

      {/* ── Header ───────────────────────────────────────────── */}
      <header className="no-print flex shrink-0 items-center gap-4 bg-slate-900 px-5 py-3.5 text-white md:px-6">
        {settings?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={settings.logoUrl}
            alt=""
            className="size-11 shrink-0 rounded-xl bg-white/10 object-contain p-1"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-bold md:text-2xl">{schoolName}</p>
          <p className="truncate text-sm text-slate-400">{branchName}</p>
        </div>

        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <HeaderStat
            icon={<Users className="size-4" />}
            value={feed.waitingTotal ?? 0}
            label={t.inQueue}
          />
          <HeaderStat
            icon={<Ticket className="size-4" />}
            value={feed.issuedToday ?? 0}
            label={t.issuedToday}
          />
        </div>

        {languages.length > 1 && (
          <div className="flex shrink-0 gap-1.5 rounded-2xl bg-white/10 p-1">
            {languages.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={
                  l === lang
                    ? 'rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-900 md:text-base'
                    : 'rounded-xl px-4 py-2 text-sm font-medium text-slate-300 active:bg-white/10 md:text-base'
                }
              >
                {LOCALE_LABEL[l]}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="no-print flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row lg:gap-5 lg:p-6">
        {/* ── Service grid — mounted for the whole session ───── */}
        <main className="flex min-h-0 flex-1 flex-col">
          <div className="mb-3 flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h1 className="text-2xl font-bold text-slate-800 md:text-3xl">{t.prompt}</h1>
            <p className="text-sm text-slate-500 md:text-base">{t.promptHint}</p>
          </div>

          <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-1 gap-3 overflow-y-auto pb-1 sm:grid-cols-2 2xl:grid-cols-3">
            {departments.map((dept) => {
              const queued = waitingByDepartment[dept.id] ?? 0
              const secondary = rtl ? dept.nameEn : dept.nameAr
              return (
                <button
                  key={dept.id}
                  type="button"
                  disabled={!!issuingId}
                  onClick={() => selectDepartment(dept)}
                  className="group relative flex min-h-28 items-center gap-4 overflow-hidden rounded-3xl px-5 py-4 text-start text-white shadow-lg shadow-slate-900/10 ring-1 ring-inset ring-white/20 transition duration-150 active:scale-[0.97] disabled:opacity-60"
                  style={{ backgroundColor: dept.color }}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/10"
                  />
                  <span
                    dir="ltr"
                    className="relative flex size-16 shrink-0 items-center justify-center rounded-2xl bg-white/25 font-mono text-3xl font-black shadow-inner"
                  >
                    {dept.prefix}
                  </span>

                  <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-xl font-bold md:text-2xl">
                      {deptName(dept)}
                    </span>
                    {secondary && (
                      <span
                        dir={rtl ? 'ltr' : 'rtl'}
                        style={{ textAlign: rtl ? 'right' : 'left' }}
                        className="block truncate text-base text-white/75"
                      >
                        {secondary}
                      </span>
                    )}
                  </span>

                  <span className="relative shrink-0 text-end">
                    <span className="block font-mono text-2xl font-black tabular-nums leading-none">
                      {queued}
                    </span>
                    <span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-white/70">
                      {queued === 0 ? t.noneWaiting : t.waitingHere}
                    </span>
                  </span>

                  {dept.isPriority && (
                    <span className="absolute end-3 top-3 rounded-full bg-white/25 p-1.5">
                      <Accessibility className="size-4" />
                    </span>
                  )}

                  {issuingId === dept.id && (
                    <span className="absolute inset-0 grid place-items-center bg-black/30">
                      <Loader2 className="size-10 animate-spin" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {priorityEnabled && (
            <button
              type="button"
              onClick={() => setPriority((v) => !v)}
              className={
                priority
                  ? 'mt-3 flex shrink-0 items-center gap-4 rounded-2xl border-2 border-amber-400 bg-amber-50 px-5 py-3.5 text-start shadow-sm ring-4 ring-amber-100'
                  : 'mt-3 flex shrink-0 items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-start shadow-sm active:bg-slate-50'
              }
            >
              <Accessibility className={priority ? 'size-8 shrink-0 text-amber-600' : 'size-8 shrink-0 text-slate-400'} />
              <span className="min-w-0 flex-1">
                <span className={priority ? 'block text-lg font-bold text-amber-900' : 'block text-lg font-semibold text-slate-700'}>
                  {t.priority}
                </span>
                <span className="block truncate text-sm text-slate-500">
                  {priority ? t.priorityArmed : t.priorityHint}
                </span>
              </span>
              <span
                className={
                  priority
                    ? 'grid size-9 shrink-0 place-items-center rounded-full bg-amber-500 text-white'
                    : 'grid size-9 shrink-0 place-items-center rounded-full border-2 border-slate-200 text-transparent'
                }
              >
                <Check className="size-5" />
              </span>
            </button>
          )}
        </main>

        {/* ── Rail: the ticket just taken, then today's list ─── */}
        <aside className="flex min-h-0 max-h-[46vh] shrink-0 flex-col gap-3 lg:max-h-none lg:w-[380px] xl:w-[420px]">
          <IssuedCard
            hero={hero}
            t={t}
            rtl={rtl}
            printing={heroPrinting}
            printFailed={!!hero && printFailedFor === hero.token.tokenCode}
            deptName={deptName}
          />

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{t.recent}</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-slate-600">
                {feed.issuedToday ?? recent.length}
              </span>
            </header>

            {recent.length === 0 ? (
              <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-400">
                {t.recentEmpty}
              </p>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
                {recent.map((token) => (
                  <RecentRow
                    key={token.id}
                    token={token}
                    department={deptById.get(token.departmentId)}
                    deptName={deptName}
                    lang={lang}
                    t={t}
                    now={now}
                    open={openRow === token.id}
                    busy={busyTokenId === token.id}
                    disabled={!!busyTokenId}
                    printEnabled={printEnabled}
                    canMove={departments.length > 1}
                    onToggle={() => setOpenRow((id) => (id === token.id ? null : token.id))}
                    onReprint={() => reprint(token)}
                    onTogglePriority={() => togglePriority(token)}
                    onMove={() => setMoveFor(token)}
                    onCancel={() => cancelToken(token)}
                  />
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {/* ── Move a ticket to another service ─────────────────── */}
      <Dialog open={!!moveFor} onOpenChange={(open) => !open && setMoveFor(null)}>
        <DialogContent className="max-w-lg" dir={rtl ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {t.moveTitle}
              {moveFor && (
                <span dir="ltr" className="ms-2 font-mono text-accent-700">{moveFor.tokenCode}</span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
            {departments
              .filter((d) => d.id !== moveFor?.departmentId)
              .map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => moveFor && moveToken(moveFor, d)}
                  className="flex items-center gap-3 rounded-2xl px-4 py-3 text-start text-white shadow-sm transition active:scale-[0.97]"
                  style={{ backgroundColor: d.color }}
                >
                  <span
                    dir="ltr"
                    className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/25 font-mono text-lg font-black"
                  >
                    {d.prefix}
                  </span>
                  <span className="min-w-0 truncate text-base font-bold">{deptName(d)}</span>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* 58 mm thermal ticket, cut to length.
          Laid out at the head's 48 mm printable width, not the roll's 58 mm,
          so RawBT's stretch to 384 dots is 1:1 and the ticket prints at true
          scale; the roll's own margins come from centring it on the page.
          Height is the content's, nothing more: the roll is cut to length, so
          a fixed height only ever buys blank paper, and a long school name or
          a two-line footer lengthens the ticket instead of being clipped.
          Renders the job being printed, not the last one issued — a reprint
          from the rail may be for an older ticket. */}
      <div id="school-ticket" ref={printRef} style={{ display: 'none' }}>
        {printedTicket && (
          <div
            style={{
              width: `${SCHOOL_PAPER.printableMm}mm`, boxSizing: 'border-box',
              // 3 mm of lead-in, then the trailing feed: that bottom band is
              // not padding for looks, it is the paper between the head and
              // the tear bar. Without it the date line is still under the bar
              // when the visitor tears, and the tear lands through the type.
              padding: `3mm 2mm ${SCHOOL_PAPER.tearFeedMm}mm`, margin: '0 auto',
              fontFamily: "'Courier New', Courier, monospace",
              color: '#000', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}
          >
            {settings?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ticketLogo?.src ?? settings.logoUrl}
                alt=""
                crossOrigin={ticketLogo ? undefined : 'anonymous'}
                style={{
                  width: `${ticketLogo?.widthMm ?? 14}mm`, height: 'auto',
                  margin: '0 0 2mm',
                }}
              />
            )}
            <p style={{ fontSize: '10pt', fontWeight: 700, lineHeight: 1.25, margin: '0 0 3mm' }}>
              {settings?.schoolNameEn || branchName}
            </p>
            <p style={{ fontSize: '40pt', fontWeight: 900, lineHeight: 1, margin: '0 0 4mm' }}>
              {printedTicket.token.tokenCode}
            </p>
            {ticketLocales.map((l) => {
              const name = ticketDeptName(l, printedTicket.department)
              if (!name) return null
              return (
                <p
                  key={l}
                  dir={dirFor(l)}
                  style={{ fontSize: l === printLocale ? '11pt' : '9.5pt', fontWeight: 700, lineHeight: 1.25, margin: '0 0 2mm' }}
                >
                  {name}
                </p>
              )
            })}
            {printedTicket.token.isPriority && (
              <p style={{ fontSize: '9pt', fontWeight: 700, margin: '1mm 0 3mm' }}>PRIORITY</p>
            )}
            {/* Boxed because it is the one line a visitor re-reads while they
                wait, and on a thermal ticket a rule is the only emphasis that
                survives the 1-bit threshold. Omitted entirely when the count
                is unknown — see PrintJob.waitingAhead. */}
            {printedTicket.waitingAhead !== null && (
              <div
                style={{
                  border: '1px solid #000', borderRadius: '1mm',
                  padding: '1.5mm 2mm', margin: '0 0 3mm', width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                {ticketLocales.map((l, i) => (
                  <p
                    key={l}
                    dir={dirFor(l)}
                    style={{
                      fontSize: i === 0 ? '9pt' : '8.5pt', fontWeight: 700,
                      lineHeight: i === 0 ? 1.25 : 1.35, margin: i === 0 ? 0 : '1mm 0 0',
                    }}
                  >
                    {waitingAheadLine(printedTicket.waitingAhead!)[l]}
                  </p>
                ))}
              </div>
            )}
            <p style={{ fontSize: '8pt', fontWeight: 700, margin: 0 }}>
              {formatDate(printedTicket.token.joinedAt)} · {formatTime(printedTicket.token.joinedAt)}
            </p>
            {ticketLocales.map((l, i) => {
              const footer = ticketFooter(l)
              if (!footer) return null
              return (
                <p
                  key={l}
                  dir={dirFor(l)}
                  style={{ fontSize: '7.5pt', lineHeight: 1.3, margin: i === 0 ? '3mm 0 0' : '1mm 0 0' }}
                >
                  {footer}
                </p>
              )
            })}
            {/* publicTrackingEnabled gates this whole block — no QR, no
                caption, no fallback line, when the feature isn't granted or
                the school has switched it off. The <img> starts srcless and
                is filled in imperatively right before capture (enqueuePrint)
                — see prepareTicketQr's comment for why it isn't React state. */}
            {publicTrackingEnabled && (
              <div style={{ marginTop: '3mm', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={qrImgRef}
                  alt=""
                  style={{ width: `${QR_TARGET_MM}mm`, height: `${QR_TARGET_MM}mm` }}
                />
                {ticketLocales.map((l, i) => (
                  <p
                    key={l}
                    dir={dirFor(l)}
                    style={{ fontSize: i === 0 ? '7.5pt' : '7pt', fontWeight: 700, margin: i === 0 ? '1.5mm 0 0' : '0.5mm 0 0' }}
                  >
                    {qrCaptionLine()[l]}
                  </p>
                ))}
                {/* Scan-failure fallback: costs ~3mm of paper, saves a
                    support call from someone who can't get the camera to
                    pick it up. */}
                <p style={{ fontSize: '6.5pt', color: '#333', margin: '1mm 0 0', wordBreak: 'break-all' }}>
                  {qrDisplayValue}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Off-screen QR source. Re-renders every job (the URL changes per
          ticket); prepareTicketQr reads its painted pixels back inside
          enqueuePrint. Never captured directly — see that function's
          comment in lib/school/printTicket.ts. */}
      {publicTrackingEnabled && (
        <div style={{ position: 'fixed', left: -99999, top: 0 }}>
          <QRCodeCanvas
            ref={qrCanvasRef}
            value={qrValue || ' '}
            size={QR_SOURCE_PX}
            // M, not H: on a ~45-char URL, H forces enough extra modules to
            // print unscannably dense at a size that still fits the ticket —
            // see the comment on QR_TARGET_MM in printTicket.ts.
            level="M"
            marginSize={4}
            fgColor="#000000"
            bgColor="#ffffff"
          />
        </div>
      )}
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────

function HeaderStat({ icon, value, label }: {
  icon: React.ReactNode
  value: number
  label: string
}) {
  return (
    <span className="flex items-center gap-2 rounded-2xl bg-white/10 px-3.5 py-2">
      <span className="text-slate-400">{icon}</span>
      <span className="font-mono text-lg font-black tabular-nums leading-none">{value}</span>
      <span className="text-xs font-medium text-slate-400">{label}</span>
    </span>
  )
}

// `as const` narrows every value to its own literal, which makes the two
// language objects mutually unassignable. The rail only needs the keys.
type Copy = Record<keyof typeof COPY['en'], string>

/* The number the last visitor took. Sits beside the grid rather than over it
   so the queue never stops moving while someone reads it. */
function IssuedCard({ hero, t, rtl, printing, printFailed, deptName }: {
  hero: HeroTicket | null
  t: Copy
  rtl: boolean
  printing: boolean
  printFailed: boolean
  deptName: (d: SchoolDepartmentDTO | undefined) => string
}) {
  return (
    <div className="shrink-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <AnimatePresence mode="wait">
        {hero ? (
          <motion.div
            key={hero.token.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="px-5 py-4 text-center"
          >
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              {t.yourToken}
            </p>
            <p
              dir="ltr"
              className="font-mono font-black leading-none tabular-nums text-accent-700"
              style={{ fontSize: 'clamp(3.5rem, 7vw, 6rem)' }}
            >
              {hero.token.tokenCode}
            </p>
            <p className="mt-2 truncate text-xl font-bold text-slate-800">
              {deptName(hero.department)}
            </p>
            {hero.token.isPriority && (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800">
                <Accessibility className="size-4" />
                {t.priorityTag}
              </span>
            )}
            <p className="mt-2 text-sm text-slate-500">{t.watch}</p>

            {printing && (
              <p className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500">
                <Printer className="size-4 animate-pulse" />
                {t.printing}
              </p>
            )}
            {printFailed && (
              <p className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                <TriangleAlert className="size-4 shrink-0" />
                {t.printFailed}
              </p>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-2 px-5 py-8 text-center"
          >
            <Ticket className={rtl ? 'size-9 -scale-x-100 text-slate-300' : 'size-9 text-slate-300'} />
            <p className="text-sm font-medium text-slate-400">{t.heroEmpty}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* One ticket in the rail.
 *
 * Collapsed, a row is a record: number, service, how long it has been waiting.
 * The four corrections live behind a tap, because four labelled buttons on
 * every row turned a 30-ticket list into a wall of chrome — and on the tickets
 * a counter has already taken, none of them are even live. Only one row opens
 * at a time, so the tray reads as "this ticket", and its buttons get real
 * kiosk-sized targets instead of the 8 mm ones they were squeezed into.
 */
function RecentRow({
  token, department, deptName, lang, t, now, open, busy, disabled,
  printEnabled, canMove, onToggle, onReprint, onTogglePriority, onMove, onCancel,
}: {
  token: SchoolTokenDTO
  department: SchoolDepartmentDTO | undefined
  deptName: (d: SchoolDepartmentDTO | undefined) => string
  lang: SchoolLanguage
  t: Copy
  now: number
  open: boolean
  busy: boolean
  disabled: boolean
  printEnabled: boolean
  canMove: boolean
  onToggle: () => void
  onReprint: () => void
  onTogglePriority: () => void
  onMove: () => void
  onCancel: () => void
}) {
  const status = STATUS[token.status]
  // Only what's still in the pool is the kiosk's to change; once a counter has
  // it, the rail is a read-only record.
  const editable = token.status === 'waiting' || token.status === 'held'
  const mins = minutesSince(token.joinedAt, now)

  const line = (
    <>
      <span className="flex items-center gap-2.5">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: department?.color ?? '#94a3b8' }}
        />
        <span dir="ltr" className="shrink-0 font-mono text-base font-black tabular-nums text-slate-800">
          {token.tokenCode}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-500">
          {deptName(department)}
        </span>
        {token.isPriority && <Accessibility className="size-4 shrink-0 text-amber-600" />}
        {/* "Waiting" is what almost every row says, so it earns no pill — the
            elapsed timer below already reads as waiting. Only the states worth
            noticing are called out. */}
        {token.status !== 'waiting' && (
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold ${status.className}`}>
            {status[lang]}
          </span>
        )}
        {editable && (
          <ChevronDown
            className={
              open
                ? 'size-4 shrink-0 rotate-180 text-slate-400 transition-transform'
                : 'size-4 shrink-0 text-slate-300 transition-transform'
            }
          />
        )}
      </span>
      <span dir="ltr" className="mt-0.5 block ps-5 text-xs font-medium tabular-nums text-slate-400">
        {formatTime(token.joinedAt)} · {formatElapsed(mins, false)}
      </span>
    </>
  )

  return (
    <li className={busy ? 'opacity-50' : undefined}>
      {editable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={`w-full select-none px-4 py-2.5 text-start transition active:bg-slate-50 ${
            open ? 'bg-slate-50' : ''
          }`}
        >
          {line}
        </button>
      ) : (
        <div className="px-4 py-2.5">{line}</div>
      )}

      <AnimatePresence initial={false}>
        {open && editable && (
          <motion.div
            key="tray"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden bg-slate-50"
          >
            <div className="grid grid-cols-2 gap-2 px-4 pb-3">
              {printEnabled && (
                <RowAction label={t.reprint} onTap={onReprint} disabled={disabled}>
                  <Printer className="size-4" />
                </RowAction>
              )}
              <RowAction
                label={token.isPriority ? t.clearPriority : t.makePriority}
                onTap={onTogglePriority}
                disabled={disabled}
                active={token.isPriority}
              >
                <Star className={token.isPriority ? 'size-4 fill-current' : 'size-4'} />
              </RowAction>
              {canMove && (
                <RowAction label={t.move} onTap={onMove} disabled={disabled}>
                  <ArrowRightLeft className="size-4" />
                </RowAction>
              )}
              <ConfirmCancel onConfirm={onCancel} disabled={disabled} label={t.cancel} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

/* Labelled icon buttons: a kiosk gets tapped by people who never see a
   tooltip, so the label is rendered, not hovered. Sized to match
   ConfirmCancel, which shares the tray with them. */
function RowAction({ label, onTap, disabled, active, children }: {
  label: string
  onTap: () => void
  disabled?: boolean
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={disabled}
      className={`flex h-8 select-none items-center justify-center gap-1 rounded-lg px-2.5 text-xs font-bold shadow-sm transition active:scale-95 disabled:opacity-40 ${
        active
          ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-200'
          : 'border border-slate-200 bg-white text-slate-600 active:bg-slate-50'
      }`}
    >
      {children}
      {label}
    </button>
  )
}
