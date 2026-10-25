// What the server sends and public/sw.js renders. One shape for every kind of
// recipient (hotel counter, school counter, manager) so the worker needs no
// per-product logic: it just merges `label`s that share a `tag`.
export interface PushPayload {
  // Counter name, or branch/department for managers.
  heading: string
  // The thing that needs attention: "#12" for an order, "A014" for a token.
  label: string
  noun: 'order' | 'token'
  // Completes "<Noun> <label> is …": "waiting to be prepared", "ready for billing".
  what: string
  // Where tapping the notification goes.
  url: string
  // Notifications sharing a tag replace/merge each other. Counters and managers
  // use different tags so one never swallows the other in the same browser.
  tag: string
}

export const COUNTER_ALERT_TAG = 'counter-alert'
export const MANAGER_ALERT_TAG = 'manager-alert'
