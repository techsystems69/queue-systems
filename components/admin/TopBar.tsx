'use client'

import { usePathname } from 'next/navigation'
import { Menu, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Sidebar } from './Sidebar'
import { BranchSwitcher } from './BranchSwitcher'
import { useState } from 'react'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { ManagerAlertBell } from '@/components/shared/ManagerAlertBell'
import type { BranchDTO } from '@/lib/db/types'

function getTitle(pathname: string): string {
  if (pathname === '/dashboard') return 'Dashboard'
  if (pathname === '/branches') return 'Branches'
  if (pathname === '/ads') return 'Common Ads'
  if (pathname.startsWith('/branches/') && pathname.endsWith('/settings')) return 'Branch Settings'
  if (pathname.startsWith('/branches/') && pathname.endsWith('/screens')) return 'Screen Management'
  if (pathname.startsWith('/branches/') && pathname.endsWith('/ads')) return 'Ads & Ticker'
  if (pathname.startsWith('/branches/')) return 'Queue Management'
  if (pathname === '/users') return 'Users'
  if (pathname === '/analytics') return 'Analytics'
  if (pathname === '/settings') return 'Settings'
  return 'Queue System'
}

interface Props {
  branches: BranchDTO[]
  activeBranchId: string | null
}

export function TopBar({ branches, activeBranchId }: Props) {
  const pathname = usePathname()
  const title = getTitle(pathname)
  const [open, setOpen] = useState(false)
  const { canInstall, install } = usePWAInstall()

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden shrink-0">
            <Menu className="size-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-60 p-0 border-slate-200 bg-white">
          <Sidebar onNavigate={() => setOpen(false)} branches={branches} />
        </SheetContent>
      </Sheet>

      <div className="flex-1 min-w-0">
        <h1 className="text-base font-semibold text-slate-800 truncate">{title}</h1>
      </div>

      <BranchSwitcher branches={branches} activeBranchId={activeBranchId} />

      <ManagerAlertBell />

      {canInstall && (
        <Button onClick={install} size="sm" variant="outline" className="gap-1.5 text-accent-700 border-accent-200 active:bg-accent-50 shrink-0">
          <Download className="size-3.5" />
          <span className="hidden sm:inline">Install App</span>
        </Button>
      )}

    </header>
  )
}
