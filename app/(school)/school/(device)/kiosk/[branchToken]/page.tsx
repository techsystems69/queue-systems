import { notFound } from 'next/navigation'
import type { Viewport } from 'next'
import { getSchoolKioskPacket, getSchoolKioskFeed } from '@/lib/dal/school'
import { SchoolKiosk } from '@/components/school/SchoolKiosk'

export const dynamic = 'force-dynamic'

// Unattended touch terminal: lock zoom so a fast double-tap on a department
// never leaves the next visitor looking at a zoomed-in kiosk.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

interface Props {
  params: Promise<{ branchToken: string }>
}

export default async function SchoolKioskPage({ params }: Props) {
  const { branchToken } = await params
  const packet = await getSchoolKioskPacket(branchToken)
  if (packet.status !== 'ok') notFound()

  // Server-rendered so the recent-ticket rail is populated on the first paint
  // — a kiosk that boots showing an empty list reads as a broken kiosk.
  const feed = await getSchoolKioskFeed(branchToken)

  if ((packet.departments ?? []).length === 0) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center bg-slate-100 p-8 text-center">
        <div>
          <p className="text-2xl font-bold text-slate-800">This kiosk isn&apos;t set up yet</p>
          <p className="mt-2 text-slate-500">
            Add departments in the school manager (or, for a desk kiosk, assign departments to its
            counter), then reload this screen.
          </p>
        </div>
      </div>
    )
  }

  return (
    <SchoolKiosk
      branchToken={branchToken}
      branchName={packet.branchName!}
      departments={packet.departments!}
      settings={packet.settings ?? null}
      silentPrintEnabled={packet.silentPrint ?? false}
      printerName={packet.printerName ?? ''}
      initialFeed={feed}
      publicTrackingEnabled={packet.publicTrackingEnabled ?? false}
      counterName={packet.counterName}
    />
  )
}
