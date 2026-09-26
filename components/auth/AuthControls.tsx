'use client'

import { useState, type ComponentProps, type ReactNode } from 'react'
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AuthFieldProps extends Omit<ComponentProps<'input'>, 'className'> {
  /** Accessible name; shown as the placeholder, as in the app login. */
  label: string
  icon: ReactNode
  /** Adds a show/hide toggle. Only meaningful with `type="password"`. */
  revealable?: boolean
  hint?: string
  className?: string
}

export function AuthField({
  label,
  icon,
  revealable,
  hint,
  className,
  type = 'text',
  id,
  ...props
}: AuthFieldProps) {
  const [shown, setShown] = useState(false)
  const fieldId = id ?? props.name
  const effectiveType = revealable && shown ? 'text' : type

  return (
    <div>
      <label htmlFor={fieldId} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-gray-700 [&_svg]:size-5"
        >
          {icon}
        </span>
        <input
          id={fieldId}
          type={effectiveType}
          placeholder={label}
          className={cn(
            'h-13 w-full rounded-xl border border-gray-200 bg-gray-50 pl-12 text-[15px] text-gray-900 outline-none transition-colors',
            'placeholder:text-gray-500 hover:border-gray-300',
            'focus:border-brand-600 focus:bg-white focus:ring-3 focus:ring-brand-600/15',
            'disabled:opacity-60',
            revealable ? 'pr-12' : 'pr-4',
            className,
          )}
          {...props}
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            className="absolute inset-y-0 right-1.5 my-auto flex size-10 items-center justify-center rounded-lg text-gray-700 transition-colors hover:bg-gray-200/60"
          >
            {shown ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        )}
      </div>
      {hint && <p className="mt-1.5 px-1 text-[13px] text-gray-500">{hint}</p>}
    </div>
  )
}

export function AuthError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-700"
    >
      <AlertCircle className="mt-px size-4.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

export function AuthSubmit({
  pending,
  children,
  pendingLabel,
}: {
  pending: boolean
  children: ReactNode
  pendingLabel: string
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-600/30 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? (
        <>
          <Loader2 className="size-5 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        <>
          {children}
          <ArrowRight className="size-5" />
        </>
      )}
    </button>
  )
}
