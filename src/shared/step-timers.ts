// Finds cooking durations in method text ("simmer 10–15 minutes", "roast 1 hour 30 min",
// "rest 90 seconds") so Cooking Mode can turn each into a tap-to-start timer. Pure — the
// step text is the only input, so it works on every imported and catalog recipe alike.

export type StepPart =
  | { kind: 'text'; text: string }
  | { kind: 'timer'; text: string; seconds: number; label: string }

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  another: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  'forty-five': 45,
  sixty: 60
}

const UNIT_SECONDS: Record<string, number> = { h: 3600, m: 60, s: 1 }

/** "1½", "1 1/2", "1.5", "½", "two", "an" → number. */
function toNumber(raw: string): number | null {
  const s = raw.trim().toLowerCase()
  if (s in WORD_NUMBERS) return WORD_NUMBERS[s]
  const frac: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 }
  const m = s.match(/^(\d+(?:\.\d+)?)?\s*(?:([½¼¾⅓⅔])|(\d+)\/(\d+))?$/)
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null
  let n = m[1] !== undefined ? Number(m[1]) : 0
  if (m[2]) n += frac[m[2]]
  if (m[3] && m[4]) n += Number(m[3]) / Number(m[4])
  return n
}

function unitKey(unit: string): 'h' | 'm' | 's' {
  const u = unit.toLowerCase()
  if (u.startsWith('h')) return 'h'
  if (u.startsWith('s')) return 's'
  return 'm'
}

const NUM = String.raw`(?:\d+(?:\.\d+)?\s*[½¼¾⅓⅔]?|\d+\s+\d+\/\d+|\d+\/\d+|[½¼¾⅓⅔]|${Object.keys(
  WORD_NUMBERS
)
  .sort((a, b) => b.length - a.length)
  .join('|')})`
const UNIT = String.raw`(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)`

// One amount: "10", "10–15", "10 to 15", "1 1/2", plus a unit; optionally followed by a
// second smaller amount ("1 hour 30 minutes", "1 hr and 15 min").
const DURATION = new RegExp(
  String.raw`\b(half an hour|half a minute|(${NUM})(?:\s*(?:-|–|—|to)\s*(${NUM}))?\s*(${UNIT})\b(?:,?\s*(?:and\s+)?(${NUM})\s*(${UNIT})\b)?)`,
  'gi'
)

/** "two minutes short of the packet time" is not a timer — it adjusts someone else's. */
const NOT_A_TIMER_AFTER = /^\s*(short|less|early|earlier|shy)\b/i

function formatLabel(seconds: number, maxSeconds: number | null): string {
  const one = (sec: number): string => {
    if (sec >= 3600) {
      const h = Math.floor(sec / 3600)
      const m = Math.round((sec % 3600) / 60)
      return m === 0 ? `${h} hr` : `${h} hr ${m} min`
    }
    if (sec >= 60) return `${Math.round(sec / 60)} min`
    return `${sec} sec`
  }
  if (maxSeconds === null) return one(seconds)
  // "10–15 min" rather than "10 min–15 min" when both ends sit in the same plain unit.
  if (maxSeconds < 60) return `${seconds}–${maxSeconds} sec`
  if (seconds >= 60 && maxSeconds < 3600 && seconds % 60 === 0 && maxSeconds % 60 === 0)
    return `${seconds / 60}–${maxSeconds / 60} min`
  if (seconds % 3600 === 0 && maxSeconds % 3600 === 0)
    return `${seconds / 3600}–${maxSeconds / 3600} hr`
  return `${one(seconds)}–${one(maxSeconds)}`
}

/**
 * Split step text into plain runs and timer runs, in order. A range ("10–15 minutes")
 * starts the timer on its LOWER bound — checking early is recoverable, overcooking is
 * not — and the label keeps the range so the cook knows how long it may go on.
 */
export function splitStepTimers(text: string): StepPart[] {
  const parts: StepPart[] = []
  let last = 0
  for (const m of text.matchAll(DURATION)) {
    const start = m.index ?? 0
    const matched = m[0]
    const after = text.slice(start + matched.length)
    if (NOT_A_TIMER_AFTER.test(after)) continue

    let seconds: number
    let maxSeconds: number | null = null
    const phrase = m[1].toLowerCase()
    if (phrase === 'half an hour') seconds = 1800
    else if (phrase === 'half a minute') seconds = 30
    else {
      const unit = UNIT_SECONDS[unitKey(m[4])]
      const lo = toNumber(m[2])
      const hi = m[3] !== undefined ? toNumber(m[3]) : null
      if (lo === null) continue
      seconds = Math.round(lo * unit)
      if (hi !== null && hi > lo) maxSeconds = Math.round(hi * unit)
      if (m[5] !== undefined && m[6] !== undefined) {
        const extra = toNumber(m[5])
        if (extra !== null) {
          const add = Math.round(extra * UNIT_SECONDS[unitKey(m[6])])
          seconds += add
          if (maxSeconds !== null) maxSeconds += add
        }
      }
    }
    // A bare "a minute" in passing prose is still worth a button, but a zero or a
    // multi-day figure is a misread, not a timer.
    if (seconds <= 0 || seconds > 48 * 3600) continue

    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) })
    parts.push({ kind: 'timer', text: matched, seconds, label: formatLabel(seconds, maxSeconds) })
    last = start + matched.length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

/** "1:05:09" / "4:30" countdown display. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}
