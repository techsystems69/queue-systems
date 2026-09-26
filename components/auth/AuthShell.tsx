import type { ReactNode } from 'react'
import { BrandLogo } from '@/components/auth/BrandLogo'

interface AuthShellProps {
  /** First line of the panel headline, in white. */
  headline: string
  /** Second line, in the mint accent. */
  headlineAccent: string
  /** One or two sentences under the headline. */
  blurb: string
  /** Small labels along the bottom of the panel. */
  tags?: string[]
  children: ReactNode
}

/**
 * Two-pane frame shared by every sign-in and activation page: a dark brand
 * panel on the left (hidden below `lg`, where a compact logo takes its place)
 * and the form on the right.
 *
 * Deliberately light-only, like the native app's login — the pages set their
 * own colours rather than following the dashboard's theme tokens.
 */
export function AuthShell({
  headline,
  headlineAccent,
  blurb,
  tags = ['Kiosks', 'Displays', 'Counters'],
  children,
}: AuthShellProps) {
  return (
    <div className="min-h-screen bg-[#fcfcfa] text-gray-900 lg:flex">
      <aside className="relative hidden overflow-hidden bg-brand-900 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[42%] lg:flex-col lg:justify-between lg:px-16 lg:py-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.07),transparent_60%)]"
        />

        <div className="relative">
          <BrandLogo tone="light" />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-5xl font-semibold leading-[1.08] tracking-tight xl:text-[56px]">
            {headline}
            <br />
            <span className="text-brand-300">{headlineAccent}</span>
          </h2>
          <p className="mt-6 max-w-sm text-lg leading-relaxed text-white/65">
            {blurb}
          </p>
        </div>

        <ul className="relative flex items-center gap-3 text-sm text-white/60">
          {tags.map((tag, i) => (
            <li key={tag} className="flex items-center gap-3">
              {i > 0 && <span aria-hidden>·</span>}
              {tag}
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex min-h-screen flex-1 flex-col px-6 py-10 sm:px-10 lg:min-h-0 lg:justify-center">
        <div className="mb-10 lg:hidden">
          <BrandLogo tone="dark" />
        </div>
        <div className="mx-auto my-auto w-full max-w-110 lg:my-0">{children}</div>
      </main>
    </div>
  )
}

/** Heading block for the form column. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-gray-900 sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-base text-gray-500">{subtitle}</p>
    </div>
  )
}

/**
 * Hairline-separated row under the form: a muted note on the left, an action
 * on the right (the "Change server" row from the app login).
 */
export function AuthFooterRow({ children }: { children: ReactNode }) {
  return (
    <div className="mt-8 flex items-center justify-between gap-4 border-t border-gray-200/80 pt-5 text-sm">
      {children}
    </div>
  )
}
