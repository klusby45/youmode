// Native touches for the iOS wrapper (no-ops on the web). Guideline 4.2 asks
// an app to feel like an app, not a site in a box: physical feedback on wins
// and a daily reminder are the two that matter for a habit tracker.
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { LocalNotifications } from '@capacitor/local-notifications'

export const isNative = Capacitor.isNativePlatform()

// A soft tick when logging an item.
export async function tapHaptic() {
  if (!isNative) return
  try { await Haptics.impact({ style: ImpactStyle.Light }) } catch { /* simulator */ }
}

// The big one: day complete.
export async function celebrateHaptic() {
  if (!isNative) return
  try { await Haptics.notification({ type: NotificationType.Success }) } catch { /* simulator */ }
}

// One daily 7pm local nudge while a challenge is live. Fixed id: re-scheduling
// replaces instead of stacking; pass active=false to clear it (challenge done
// or signed out). Permission is only requested once a challenge exists, so the
// prompt lands in context instead of at first boot.
const REMINDER_ID = 75
export async function syncDailyReminder(active) {
  if (!isNative) return
  try {
    if (!active) {
      await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] })
      return
    }
    const perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return
    await LocalNotifications.schedule({
      notifications: [{
        id: REMINDER_ID,
        title: 'You Mode',
        body: "Today's checklist is still open. Close it out.",
        schedule: { on: { hour: 19, minute: 0 }, allowWhileIdle: true },
      }],
    })
  } catch { /* notifications unavailable */ }
}
