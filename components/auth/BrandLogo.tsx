import { cn } from '@/lib/utils'

/** Ticket glyph: rounded body, a notch on each side, three perforation dots. */
export function TicketMark({
  className,
  dotClassName = 'fill-brand-900',
}: {
  className?: string
  /** Perforation dots read as cut-outs, so they take the background colour. */
  dotClassName?: string
}) {
  return (
    <svg
      viewBox="0 0 36 28"
      aria-hidden
      className={cn('h-7 w-9 shrink-0', className)}
    >
      <path
        fill="currentColor"
        d="M4 0H32a4 4 0 0 1 4 4V10.5a3.5 3.5 0 0 0 0 7V24a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V17.5a3.5 3.5 0 0 0 0-7V4a4 4 0 0 1 4-4Z"
      />
      <g className={dotClassName}>
        <circle cx="18" cy="7" r="1.7" />
        <circle cx="18" cy="14" r="1.7" />
        <circle cx="18" cy="21" r="1.7" />
      </g>
    </svg>
  )
}

/**
 * `tone="light"` sits on the dark brand panel; `tone="dark"` is the compact
 * header shown above the form when the panel is hidden on small screens.
 */
export function BrandLogo({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const light = tone === 'light'
  return (
    <div className="flex items-center gap-3">
      <TicketMark
        className={light ? 'text-white' : 'text-brand-900'}
        dotClassName={light ? 'fill-brand-900' : 'fill-[#fcfcfa]'}
      />
      <span
        className={cn(
          'text-[26px] font-semibold tracking-tight',
          light ? 'text-white' : 'text-brand-900',
        )}
      >
        Queue
        <span className={light ? 'text-brand-200' : 'text-brand-600'}>Flow</span>
      </span>
    </div>
  )
}
