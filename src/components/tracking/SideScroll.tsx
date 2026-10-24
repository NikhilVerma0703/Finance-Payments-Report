"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A wide table's sideways scroll, with a second scrollbar along its top.
 *
 * A table taller than the screen has its own scrollbar at the bottom, out of
 * sight, so a reader with a mouse had no way to move it sideways from where
 * they were reading (owner, 24 Oct 2026: "make the table easier to navigate
 * from left to right"). The top bar mirrors the table's width and the two move
 * together; it is drawn only while the table is wider than its box. The box
 * takes the keyboard too: focus it, and the arrow keys scroll it.
 */
export function SideScroll({ children, label }: { children: ReactNode; label: string }) {
  const top = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const box = body.current;
    if (!box) return;
    const measure = () => setWidth(box.scrollWidth > box.clientWidth + 1 ? box.scrollWidth : 0);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    if (box.firstElementChild) watch.observe(box.firstElementChild);
    return () => watch.disconnect();
  }, []);

  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  };

  return (
    <>
      {width > 0 && (
        <div ref={top} onScroll={() => follow(top.current, body.current)} className="overflow-x-auto border-b border-[#e8eef4]" aria-hidden>
          <div style={{ width, height: 1 }} />
        </div>
      )}
      <div
        ref={body}
        onScroll={() => follow(body.current, top.current)}
        className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-[#c6dcf3]"
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        {children}
      </div>
    </>
  );
}
