import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { getUser, getProfile } from '@/lib/dal/session'
import { logoutAction } from '@/lib/actions/auth'
import { OnboardForm } from '@/components/auth/OnboardForm'
import { AuthFooterRow, AuthHeading, AuthShell } from '@/components/auth/AuthShell'

export default async function OnboardPage() {
  const user = await getUser()

  if (user) {
    const profile = await getProfile()
    if (profile) redirect('/dashboard')
  }

  const isTrapped = !!user

  return (
    <AuthShell
      headline="Get your queues"
      headlineAccent="up and running."
      blurb="Activate your workspace with the license key from your distributor. It takes a minute."
    >
      <AuthHeading
        title="Activate your account"
        subtitle="Enter your license key to create your workspace."
      />

      {isTrapped && (
        <div className="mb-6 flex items-start justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">No profile found</p>
            <p className="mt-0.5 text-[13px] text-amber-800/80">
              Your account exists but has no profile yet. Sign out and use the correct credentials.
            </p>
          </div>
          <form action={logoutAction} className="shrink-0">
            <button
              type="submit"
              className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-900 hover:underline"
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </form>
        </div>
      )}

      <OnboardForm />

      {!isTrapped && (
        <AuthFooterRow>
          <span className="text-gray-500">Already have an account?</span>
          <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </AuthFooterRow>
      )}
    </AuthShell>
  )
}
