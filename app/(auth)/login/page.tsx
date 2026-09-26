'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { KeyRound, Lock, Mail } from 'lucide-react'
import { loginAction } from '@/lib/actions/auth'
import { AuthFooterRow, AuthHeading, AuthShell } from '@/components/auth/AuthShell'
import { AuthError, AuthField, AuthSubmit } from '@/components/auth/AuthControls'

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, {})

  return (
    <AuthShell
      headline="Every queue,"
      headlineAccent="under control."
      blurb="Manage tickets, counters and displays from one place."
    >
      <AuthHeading
        title="Sign in to your workspace"
        subtitle="Use your QueueFlow account to access this device."
      />

      <form action={action} className="space-y-4">
        <AuthField
          name="email"
          type="email"
          label="Email"
          icon={<Mail />}
          autoComplete="email"
          required
        />
        <AuthField
          name="password"
          type="password"
          label="Password"
          icon={<Lock />}
          autoComplete="current-password"
          revealable
          required
        />

        <AuthError message={state.error} />

        <div className="pt-1">
          <AuthSubmit pending={pending} pendingLabel="Signing in…">
            Sign in
          </AuthSubmit>
        </div>
      </form>

      <AuthFooterRow>
        <span className="flex items-center gap-2 text-gray-500">
          <KeyRound className="size-4" aria-hidden />
          Have a license key?
        </span>
        <Link href="/onboard" className="font-semibold text-brand-600 hover:text-brand-700">
          Activate account
        </Link>
      </AuthFooterRow>
    </AuthShell>
  )
}
