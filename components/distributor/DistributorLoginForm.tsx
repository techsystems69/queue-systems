'use client'

import { useActionState } from 'react'
import { Lock } from 'lucide-react'
import { distributorLoginAction } from '@/lib/actions/auth'
import { AuthError, AuthField, AuthSubmit } from '@/components/auth/AuthControls'

import type { AuthResult } from '@/lib/actions/auth'
const INIT: AuthResult = {}

export function DistributorLoginForm() {
  const [state, formAction, pending] = useActionState(distributorLoginAction, INIT)

  return (
    <form action={formAction} className="space-y-4">
      <AuthField
        name="secret"
        type="password"
        label="Distributor secret"
        icon={<Lock />}
        autoComplete="current-password"
        revealable
        required
      />

      <AuthError message={state.error} />

      <div className="pt-1">
        <AuthSubmit pending={pending} pendingLabel="Authenticating…">
          Sign in
        </AuthSubmit>
      </div>
    </form>
  )
}
