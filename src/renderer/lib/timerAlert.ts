// How a finished cooking timer gets your attention: three beeps, a buzz, and — when the
// app is in the background and you've allowed it — a system notification.
//
// Browsers only allow sound and the notification prompt from a tap, so `primeTimerAlerts`
// runs when a timer is STARTED and `fireTimerAlert` reuses what it unlocked. On iPhone a
// backgrounded web app is paused, so the alarm fires the moment you come back to it
// rather than on the dot; in the foreground it is exact.

let audio: AudioContext | null = null

export function primeTimerAlerts(): void {
  try {
    audio ??= new AudioContext()
    void audio.resume()
  } catch {
    // no Web Audio — vibration and the on-screen "Done" still work
  }
  if ('Notification' in window && Notification.permission === 'default') {
    // Older Safari returns undefined rather than a promise.
    void Promise.resolve(Notification.requestPermission()).catch(() => undefined)
  }
}

function beep(): void {
  if (!audio) return
  const start = audio.currentTime
  for (let i = 0; i < 3; i++) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    const t = start + i * 0.45
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    osc.connect(gain).connect(audio.destination)
    osc.start(t)
    osc.stop(t + 0.32)
  }
}

export function fireTimerAlert(title: string, body: string): void {
  beep()
  navigator.vibrate?.([300, 150, 300, 150, 300])
  if (document.visibilityState === 'visible') return
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const plain = (): void => {
    try {
      new Notification(title, { body })
    } catch {
      // nothing left to try — the on-screen alarm is waiting when they come back
    }
  }
  // iOS only shows notifications through the service worker. The desktop app has none
  // registered, so getRegistration() comes back empty and the plain API is used.
  const sw = navigator.serviceWorker
  if (!sw) return plain()
  sw.getRegistration()
    .then((reg) => (reg ? reg.showNotification(title, { body, tag: `timer-${title}` }) : plain()))
    .catch(plain)
}
