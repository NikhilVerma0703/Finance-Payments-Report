"use client";
// WHAT A FIGURE IS — the hover explanation (ported from the Pacific ERP's Production overview). One listener set for the
// whole page and one bubble, created on first use as a child of <body>, fixed
// to the viewport: no card's overflow, the bento grid, or a transformed
// (.dash-rise, .card-hover) or contained (.dash-cq, .dash-fill) ancestor can
// clip it or re-anchor it. The figures stay server components: a figure opts
// in with data-tip and carries its words ONCE, in a visually hidden
// [data-tip-text] child (tip.tsx) that a screen reader reads in place; the
// bubble copies them with textContent (never as HTML) and is aria-hidden, so
// nothing is read twice.
//
// Mouse / pen: rest on a figure 1.5 s. The bubble is a hover target: the
// pointer may cross onto it and rest there (a strip bridges the gap, and a
// shown bubble waits GRACE_MS before it goes), and it goes once the pointer
// has left both. Within 0.4 s of a shown bubble closing, the next figure
// needs only a short dwell; while one is up, the next figure the pointer
// stops on takes it over in place — a flick along a row shows nothing on the
// figures it crosses. A scroll hides a bubble under the pointer; once the
// page is still, the figure now under the resting pointer is armed afresh,
// as is any figure a moving pointer finds with nothing armed. Keyboard: focus
// from a key the same way (a link's own tip, or its first figure's); Escape
// hides it until focus or the pointer moves on. Touch: press and hold 0.5 s
// — the hold never follows the link the figure may be; any press hides it,
// and a press ON the bubble does nothing else (its click is dropped, so the
// link the bubble covers does not open); a plain tap elsewhere still opens
// the link. A native title on or above the figure is lifted while it is
// armed, so the browser never shows a second tooltip. Refresh-safe: while
// shown it re-reads and re-places itself every 0.5 s, and hides once its
// figure has left the page (router.refresh replaced it), folded away or
// scrolled out of sight; a focused one follows its figure, since the focus
// itself scrolls it into view. The timings, the placement and those rules
// are tipBubble.ts's.
import { useEffect } from "react";
import {
  EAT_CLICK_MS, GRACE_MS, HOLD_MS, HOVER_MS, POLL_MS, SCROLL_QUIET_MS,
  armDelay, movedBeyond, offScreen, onLeave, placeBubble, scrollHides, within, type ArmedBy, type LeftTo,
} from "../tipBubble";

export function TipLayer() {
  useEffect(() => {
    const d = document;
    let box: HTMLDivElement | undefined;
    let at: Element | null = null; // the figure armed: shown, or waiting to be
    let cur: Element | null = null; // the figure the bubble shows now; `at` differs while it waits to take over
    let by: ArmedBy | null = null; // how `at` was armed
    let on = false; // the bubble is up
    let muted: Element | null = null; // Escaped or clicked: not again until left
    let timer = 0, poll = 0, grace = 0, still = 0, closed = -1e9, eat = 0;
    // The last input was a key, so a focus came from the keyboard (an older
    // iPad Safari throws on :focus-visible, so it is tracked by hand).
    let kbd = false;
    let press: { x: number; y: number } | null = null;
    // Where a mouse or pen rests (viewport px): what a scroll brings under it is armed.
    let ptr: { x: number; y: number } | null = null;
    const lifted: [Element, string][] = [];

    const tipOf = (t: EventTarget | null) => (t instanceof Element ? t.closest("[data-tip]") : null);
    const textOf = (el: Element) => el.querySelector(":scope>[data-tip-text]")?.textContent?.trim();
    const inBox = (t: EventTarget | null) => !!box && t instanceof Node && box.contains(t);
    const stopGrace = () => { clearTimeout(grace); grace = 0; };

    function place() {
      const r = cur?.isConnected ? cur.getBoundingClientRect() : null;
      const text = cur && textOf(cur);
      if (!box || !r || !text || !(r.width || r.height) || offScreen(r, innerHeight)) return hide();
      box.style.cssText = "left:0;top:0";
      box.textContent = text;
      const p = placeBubble(r, box.offsetWidth, box.offsetHeight, d.documentElement.clientWidth, innerHeight);
      box.style.cssText = `left:${p.x}px;top:${p.y}px;--ax:${p.ax}px`;
      box.dataset.side = p.side;
    }
    function show() {
      clearTimeout(timer); stopGrace(); clearInterval(poll);
      if (!at) return;
      if (!box) {
        box = d.createElement("div");
        box.className = "dash-tipbox";
        box.setAttribute("aria-hidden", "true");
        d.body.append(box);
      }
      cur = at; on = true; place();
      if (on) { box.dataset.show = ""; poll = window.setInterval(place, POLL_MS); }
    }
    function hide() {
      clearTimeout(timer); stopGrace(); clearInterval(poll);
      if (on) { closed = performance.now(); box?.removeAttribute("data-show"); }
      on = false; at = null; cur = null; by = null;
      unlift();
    }
    function unlift() { for (const [n, t] of lifted.splice(0)) n.setAttribute("title", t); }
    function lift(el: Element) {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const t = n.getAttribute("title");
        if (t !== null) { lifted.push([n, t]); n.removeAttribute("title"); }
      }
    }
    /** The figure the bubble shows becomes the armed one again: a pending takeover is dropped. */
    function keepShown() {
      if (!cur || at === cur) return;
      clearTimeout(timer); unlift();
      at = cur; by = "pointer"; lift(cur);
    }
    function arm(el: Element, ms: number, how: ArmedBy) {
      if (el === at || el === muted) return;
      // A bubble that is up stays, and takes this figure's words in place once
      // the pointer has stopped on it: no hide-and-show at each boundary.
      const swap = on && how !== "touch";
      if (swap) { clearTimeout(timer); stopGrace(); unlift(); } else hide();
      at = el; by = how; lift(el);
      if (swap && el === cur) return; // back on the figure it already shows
      timer = window.setTimeout(show, armDelay(performance.now(), closed, ms, swap));
    }

    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      ptr = { x: e.clientX, y: e.clientY };
      // Onto the bubble: it stays as it is, whatever the pointer crossed to get there.
      if (inBox(e.target)) { stopGrace(); keepShown(); return; }
      const el = tipOf(e.target);
      if (!el) return;
      if (el === at) stopGrace(); // back on its figure
      else arm(el, HOVER_MS, "pointer");
    };
    const out = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const rt = e.relatedTarget;
      if (rt === null) ptr = null; // out of the window
      const to = tipOf(rt);
      if (to !== muted) muted = null;
      // Only leaving the armed figure, or the bubble, matters: a pointer moving
      // elsewhere never ends a bubble keyboard focus opened.
      if (!at || (tipOf(e.target) !== at && !inBox(e.target))) return;
      const where: LeftTo = inBox(rt) ? "bubble" : to === at ? "same" : to && to !== muted ? "figure" : "nothing";
      const act = onLeave(where, on);
      if (act === "hide") hide();
      else if (act === "grace") {
        keepShown(); // a figure only crossed on the way out never takes the bubble over
        if (!grace) grace = window.setTimeout(hide, GRACE_MS);
      }
      // "stay": nothing changes. "handOver": over() arms the next figure.
    };
    // A focused link shows its own tip, else its first figure's: a tile, a
    // chip or a row leads with the figure it is about (a link that holds a
    // row of equal figures, like the Pulse strip, carries a tip of its own).
    const focus = (e: FocusEvent) => {
      const t = e.target;
      if (!kbd || !(t instanceof Element)) return;
      const el = tipOf(t) ?? t.querySelector("[data-tip]");
      if (el) arm(el, HOVER_MS, "focus");
    };
    // Only the focus that armed it ends it: a tap that blurs some other link
    // must not take down a bubble a press-and-hold has just opened.
    const blur = (e: FocusEvent) => { if (at && e.target instanceof Node && e.target.contains(at)) hide(); muted = null; };
    const key = (e: KeyboardEvent) => { kbd = true; if (e.key === "Escape" && at) { muted = at; hide(); } };
    const down = (e: PointerEvent) => {
      eat = 0; kbd = false;
      if (e.pointerType === "touch") ptr = null;
      // A press on the bubble closes it and does nothing else: the click it
      // fires is dropped, so the link the bubble covers does not open.
      if (on && box && (inBox(e.target) || within(box.getBoundingClientRect(), e.clientX, e.clientY))) {
        eat = performance.now() + EAT_CLICK_MS;
        hide();
        return;
      }
      if (at) hide(); // any other press ends a bubble; a tap on a link goes on to open it
      // A click ends it until the mouse leaves the figure, as a native title does.
      if (e.pointerType === "mouse") { muted = tipOf(e.target); return; }
      const el = tipOf(e.target);
      if (!el) return;
      press = { x: e.clientX, y: e.clientY };
      at = el; by = "touch";
      timer = window.setTimeout(show, HOLD_MS);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "touch") {
        ptr = { x: e.clientX, y: e.clientY };
        // Nothing armed under a moving mouse (a scroll took it down while the
        // pointer stayed on the figure): this move arms it, as an entry would.
        if (!at && !press) { const el = tipOf(e.target); if (el) arm(el, HOVER_MS, "pointer"); }
      }
      if (press && movedBeyond(press, { x: e.clientX, y: e.clientY })) { press = null; if (!on) hide(); }
    };
    const up = () => {
      if (!press) return;
      press = null;
      if (on) eat = performance.now() + EAT_CLICK_MS; // the click a held press may still fire
      else hide();
    };
    // The browser took the press (a scroll, or Android's touch drag): drop a
    // pending hold; a bubble already up stays until the scroll or next press.
    const cancel = () => { press = null; if (!on) hide(); };
    // Android's long press: no link menu, no text selection — the bubble instead.
    const menu = (e: Event) => { if (press) { e.preventDefault(); if (!on) show(); } };
    // On window, capturing: before React's root listener and next/link see it.
    const click = (e: MouseEvent) => { if (performance.now() < eat) { eat = 0; e.preventDefault(); e.stopPropagation(); } };
    const quiet = () => { if (at) hide(); };
    // Scrolling has stopped: the figure now under a resting mouse or pen is
    // armed from cold. The browser moved it there; a pointer that never left
    // it gets no new entry to arm it by.
    const rest = () => {
      if (!ptr || at || press) return;
      const el = tipOf(d.elementFromPoint(ptr.x, ptr.y));
      if (el) arm(el, HOVER_MS, "pointer");
    };
    // A focused figure the browser scrolls into view keeps its bubble, which
    // follows it; under a pointer or a finger a scroll hides it (tipBubble.ts),
    // and does not warm the next one — a scroll is not a scan along a row.
    const scrolled = () => {
      if (at) {
        if (scrollHides(by)) { hide(); closed = -1e9; }
        else if (on) place();
      }
      if (ptr) { clearTimeout(still); still = window.setTimeout(rest, SCROLL_QUIET_MS); }
    };

    // Every event reaches window first when it captures (visibilitychange,
    // fired at the document, travels through window too): one target, one list.
    const p = { capture: true, passive: true } as const;
    const all: [string, EventListener, AddEventListenerOptions | boolean][] = [
      ["pointerover", over as EventListener, p], ["pointerout", out as EventListener, p],
      ["pointerdown", down as EventListener, p], ["pointermove", move as EventListener, p],
      ["pointerup", up, p], ["pointercancel", cancel, p], ["scroll", scrolled, p],
      ["focusin", focus as EventListener, true], ["focusout", blur as EventListener, true], ["keydown", key as EventListener, true],
      ["contextmenu", menu, true], ["click", click as EventListener, true],
      ["visibilitychange", quiet, true], ["resize", quiet, true],
    ];
    for (const [t, f, o] of all) addEventListener(t, f, o);
    return () => {
      for (const [t, f, o] of all) removeEventListener(t, f, o);
      clearTimeout(still);
      hide(); box?.remove();
    };
  }, []);
  return null;
}
