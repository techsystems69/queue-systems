'use client'

import { useCallback } from 'react'
import { removeManagerPushAction, saveManagerPushAction } from '@/lib/actions/push'
import { MANAGER_ALERT_TAG } from '@/lib/push/payload'
import { closeNotificationsByTag } from '@/lib/push/client'
import { useAlertPreference } from '@/lib/hooks/useAlertPreference'
import { useAttention } from '@/lib/hooks/useAttention'

const save = (sub: Parameters<typeof saveManagerPushAction>[0], ua: string) => saveManagerPushAction(sub, ua)

// The manager bell: push-only. Manager pages have no live feed to diff, so
// there is no in-page chime — the server pushes, and the service worker stays
// quiet while a manager is actively using a visible tab.
export function useManagerAlerts() {
  useAttention({
    tag: MANAGER_ALERT_TAG,
    onInteract: useCallback(() => closeNotificationsByTag(MANAGER_ALERT_TAG), []),
  })
  return useAlertPreference({
    storageKey: 'queueflow:alerts:manager',
    tag: MANAGER_ALERT_TAG,
    save,
    remove: removeManagerPushAction,
  })
}
