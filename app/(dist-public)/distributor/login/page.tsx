import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { DistributorLoginForm } from '@/components/distributor/DistributorLoginForm'
import { AuthFooterRow, AuthHeading, AuthShell } from '@/components/auth/AuthShell'

export default function DistributorLoginPage() {
  return (
    <AuthShell
      headline="Every customer,"
      headlineAccent="every key."
      blurb="Onboard customers, issue license keys and keep every deployment in view."
      tags={['Customers', 'License keys', 'Deployments']}
    >
      <AuthHeading
        title="Distributor portal"
        subtitle="Enter your distributor secret to continue."
      />

      <DistributorLoginForm />

      <AuthFooterRow>
        <span className="flex items-center gap-2 text-gray-500">
          <ShieldCheck className="size-4" aria-hidden />
          Authorized distributors only
        </span>
        <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
          Customer sign in
        </Link>
      </AuthFooterRow>
    </AuthShell>
  )
}
