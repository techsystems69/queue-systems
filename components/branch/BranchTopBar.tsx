'use client'

import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { BranchSidebar } from './BranchSidebar'
import { ManagerAlertBell } from '@/components/shared/ManagerAlertBell'
import { useState } from 'react'
import type { CounterDTO } from '@/lib/db/types'

function getTitle(pathname: string): string {
  if (pathname === '/branch') return 'Overview'
  if (pathname.startsWith('/branch/counters')) return 'Counters'
  if (pathname.startsWith('/branch/ads')) return 'Ads & Ticker'
  if (pathname.startsWith('/branch/screens')) return 'Screen Management'
  return 'Branch Panel'
}

interface BranchTopBarProps {
  branchName: string
  counters?: CounterDTO[]
}

export function BranchTopBar({ branchName, counters = [] }: BranchTopBarProps) {
  const pathname = usePathname()
  const title = getTitle(pathname)
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden shrink-0">
            <Menu className="size-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-60 p-0 border-slate-200 bg-white">
          <BranchSidebar branchName={branchName} counters={counters} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex-1 min-w-0">
        <h1 className="text-base font-semibold text-slate-800 truncate">{title}</h1>
      </div>

      <ManagerAlertBell />
    </header>
  )
}
