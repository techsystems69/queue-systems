import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { DistributorSidebar } from '@/components/distributor/DistributorSidebar'

export default async function DistributorLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const session = cookieStore.get('dist_session')?.value
  const secret = process.env.DISTRIBUTOR_SECRET
  if (!secret || session !== secret) {
    redirect('/distributor/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-60 shrink-0 border-r border-border md:flex md:flex-col">
        <DistributorSidebar />
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6">{children}</div>
      </main>
    </div>
  )
}
