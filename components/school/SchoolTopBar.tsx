'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Menu, GitBranch, ChevronsUpDown, Check } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { setActiveBranchAction } from '@/lib/actions/branches'
import { SchoolSidebar } from '@/components/school/SchoolSidebar'
import { ManagerAlertBell } from '@/components/shared/ManagerAlertBell'
import type { BranchDTO } from '@/lib/db/types'

interface Props {
  branches: BranchDTO[]
  activeBranchId: string
  schoolName: string
}

export function SchoolTopBar({ branches, activeBranchId, schoolName }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [menuOpen, setMenuOpen] = useState(false)
  const active = branches.find((b) => b.id === activeBranchId)

  // Campus switching reuses the business product's active-branch cookie, so
  // the /school pages just need a refresh — no route rewriting.
  function selectBranch(branchId: string) {
    if (branchId === activeBranchId || pending) return
    startTransition(async () => {
      await setActiveBranchAction(branchId)
      router.refresh()
    })
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="md:hidden rounded-lg border border-border p-2 text-slate-600 active:bg-slate-100"
            aria-label="Open menu"
          >
            <Menu className="size-4" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-60 p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SchoolSidebar schoolName={schoolName} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      {branches.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              disabled={pending}
              className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-slate-800 active:bg-slate-50 disabled:opacity-50"
            >
              <GitBranch className="size-3.5 text-muted-foreground shrink-0" />
              <span className="truncate max-w-36 sm:max-w-48">{active?.name ?? 'Select campus'}</span>
              <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {branches.map((b) => (
              <DropdownMenuItem key={b.id} onSelect={() => selectBranch(b.id)}>
                <span className="flex-1 truncate">{b.name}</span>
                {b.id === activeBranchId && <Check className="size-3.5 text-accent-600" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <p className="text-sm font-semibold text-slate-800 truncate">{active?.name}</p>
      )}

      <div className="ms-auto">
        <ManagerAlertBell />
      </div>
    </header>
  )
}
