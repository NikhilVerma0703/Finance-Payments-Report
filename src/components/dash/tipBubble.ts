// THE HOVER BUBBLE'S RULES — when it shows and where it goes. Pure, import-
// free, no directive: client/TipLayer.tsx applies them to the DOM, and
// tests/dashboardTips.test.ts holds them to their numbers.

/** Mouse or pen resting on a figure, or keyboard focus on it, before the bubble shows. */
export const HOVER_MS = 1500;
/** A finger held on a figure before the bubble shows. */
export const HOLD_MS = 500;
/** Within this long of a bubble that was SHOWN closing, the next figure does
 *  not wait the full 1.5 s — scanning a row of numbers is quick… */
export const WARM_MS = 400;
/** …but the pointer must still stop on it this long: a figure crossed faster
 *  shows nothing, so a flick along a row never flashes a bubble on each one.
 *  The same dwell before a bubble that is up takes the next figure's words. */
export const DWELL_MS = 140;
/** Leaving a shown figure for nothing, the bubble waits this long before it
 *  goes, so the pointer can cross the PAD gap (or a corner) onto the bubble
 *  and rest there: WCAG 2.1 SC 1.4.13 "hoverable". */
export const GRACE_MS = 300;
/** A scroll hides a bubble under a resting mouse; once scrolling has been
 *  quiet this long, the figure now under the pointer is armed afresh. */
export const SCROLL_QUIET_MS = 150;
/** After a hold that showed the bubble, the click the lift may still fire is
 *  dropped for this long — the hold never follows the link the figure is. */
export const EAT_CLICK_MS = 800;
/** A finger that moves further than this is scrolling, not holding. */
export const SLOP_PX = 10;
/** While shown, the bubble re-reads its words and re-places itself this
 *  often, so a refresh that replaces or rewrites the figure never strands it. */
export const POLL_MS = 500;
/** Gap from the figure, and the least margin from the viewport's edge. */
export const PAD = 8;

/** How a figure was armed: a resting mouse or pen, keyboard focus, or a finger. */
export type ArmedBy = "pointer" | "focus" | "touch";

/** What a scroll (in any scroller) does to an armed or shown figure. Under a
 *  pointer or a finger the page moved, not the figure's owner: hide it. A
 *  figure armed by keyboard focus is very often scrolled INTO view by that
 *  focus, a moment later — hiding then would cancel the bubble of every
 *  figure below the fold; it follows its figure instead. */
export function scrollHides(by: ArmedBy | null): boolean {
  return by !== "focus";
}

/** Whether a figure's box is out of the viewport altogether — then its bubble goes. */
export function offScreen(r: Rect, vh: number): boolean {
  return r.top + r.height < 0 || r.top > vh;
}

/** How long to wait before showing a figure armed at `nowMs`: the full
 *  delay when cold, only DWELL_MS when warm (a shown bubble closed under
 *  WARM_MS ago) or when a bubble is up now (`showing`: it then takes this
 *  figure's words in place, without closing). Only a bubble that was shown
 *  warms the next one — a figure crossed inside the dwell never showed, so a
 *  flick cannot keep the window open from figure to figure. */
export function armDelay(nowMs: number, lastClosedMs: number, baseMs: number, showing = false): number {
  return showing || nowMs - lastClosedMs < WARM_MS ? Math.min(baseMs, DWELL_MS) : baseMs;
}

/** Where a pointer leaving the armed figure (or the bubble) went. */
export type LeftTo = "same" | "bubble" | "figure" | "nothing";
/** What that does: "stay" — still on the figure, or onto its bubble;
 *  "handOver" — straight onto another figure, which takes over (a bubble that
 *  is up stays and swaps its words in place after DWELL_MS); "grace" — a
 *  shown bubble waits GRACE_MS for the pointer to reach it or come back;
 *  "hide" — nothing was shown yet, so nothing waits. */
export function onLeave(to: LeftTo, showing: boolean): "stay" | "handOver" | "grace" | "hide" {
  if (to === "same" || to === "bubble") return "stay";
  if (to === "figure") return "handOver";
  return showing ? "grace" : "hide";
}

/** Whether a press at (x, y) landed on the bubble's box — then it only closes
 *  the bubble, and the click it fires is dropped: a tap meant to dismiss it
 *  must never open the link hidden under it. */
export function within(r: Rect, x: number, y: number): boolean {
  return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
}

/** Whether a press has moved far enough to be a scroll or a drag. */
export function movedBeyond(from: { x: number; y: number }, to: { x: number; y: number }, slop = SLOP_PX): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > slop;
}

export interface Rect { left: number; top: number; width: number; height: number }
export interface Placement {
  /** The bubble's left and top, in viewport px (position: fixed). */
  x: number; y: number;
  /** "top": above the figure, the arrow on the bubble's bottom edge. */
  side: "top" | "bottom";
  /** The arrow's x inside the bubble, kept off its rounded corners. */
  ax: number;
}

/** Above the figure when there is room for it there (or none below either),
 *  else below; centred on the figure and kept PAD inside the viewport. `vw`
 *  is the viewport's width without a scrollbar (clientWidth). */
export function placeBubble(r: Rect, w: number, h: number, vw: number, vh: number): Placement {
  const mid = r.left + r.width / 2;
  const bottom = r.top + r.height;
  const up = r.top >= h + 2 * PAD || bottom + h + 2 * PAD > vh;
  const x = Math.max(PAD, Math.min(mid - w / 2, vw - w - PAD));
  const y = Math.max(PAD, up ? r.top - h - PAD : bottom + PAD);
  return { x, y, side: up ? "top" : "bottom", ax: Math.max(12, Math.min(w - 12, mid - x)) };
}
