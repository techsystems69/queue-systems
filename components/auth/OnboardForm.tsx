'use client'

import { useActionState } from 'react'
import { Building2, KeyRound, Lock, Mail, User } from 'lucide-react'
import { onboardAction } from '@/lib/actions/auth'
import { AuthError, AuthField, AuthSubmit } from '@/components/auth/AuthControls'

import type { AuthResult } from '@/lib/actions/auth'
const INIT: AuthResult = {}

export function OnboardForm() {
  const [state, formAction, pending] = useActionState(onboardAction, INIT)

  return (
    <form action={formAction} className="space-y-4">
      <AuthField
        name="licenseKey"
        label="License key"
        icon={<KeyRound />}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        hint="Provided by your distributor"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="font-mono uppercase tracking-widest placeholder:normal-case placeholder:tracking-normal"
        required
      />
      <AuthField
        name="businessName"
        label="Business name"
        icon={<Building2 />}
        hint="Only needed for some license keys"
        autoComplete="organization"
      />
      <AuthField
        name="fullName"
        label="Full name"
        icon={<User />}
        autoComplete="name"
        required
      />
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
        hint="At least 8 characters"
        autoComplete="new-password"
        minLength={8}
        revealable
        required
      />

      <AuthError message={state.error} />

      <div className="pt-1">
        <AuthSubmit pending={pending} pendingLabel="Activating…">
          Activate account
        </AuthSubmit>
      </div>
    </form>
  )
}
