// WHAT A FIGURE IS — the words behind the hover bubble (client/TipLayer.tsx).
// Ported from the Pacific ERP's Production overview (app/_dashboard/tip.tsx).
// No directive and no imports but React's types: the server cards (viz.tsx
// and every card) and the Ticker island share it.
//
// A figure opts in with data-tip and carries its words ONCE, in a visually
// hidden [data-tip-text] child. A screen reader reads them right after the
// figure; TipLayer copies them into the bubble, which is aria-hidden — so
// nothing is read twice, and no second copy travels in an attribute.
//
// Writing a tip: it FOLLOWS its figure — "1,234" + "slabs the MIS sheet
// declared this production day" (the bubble capitalises the first letter).
// One phrase, about 120 characters at most: what the figure counts and over
// which window. The working stays in the card's (i) fold.
//
// Never give a tipped element (or anything around it) a `title`: the tip
// replaces it. TipLayer lifts any title it finds while a figure is armed, so a
// stray one never shows a second, native tooltip — but the rule is no title.
// Cards never write the two markers by hand: Num, TipText, TipRect, a
// primitive's `tip` prop, or LinkOr's.
import type { CSSProperties, ReactNode, SVGProps } from "react";

/** The hidden words. `spoken={false}`: the same words are already printed
 *  beside the figure, or the figure sits inside an element whose aria-label
 *  carries them — the bubble still shows them, a screen reader reads them
 *  once, elsewhere. It must be the tipped element's DIRECT child (TipLayer
 *  reads `:scope > [data-tip-text]`); place it last unless a `> :last-child`
 *  rule styles that element's own children. */
export function TipText({ tip, spoken = true }: { tip: string; spoken?: boolean }) {
  return <span className="sr-only select-none" data-tip-text="" aria-hidden={spoken ? undefined : true}>{tip}</span>;
}

type NumTag = "span" | "div" | "b" | "dd" | "td" | "th" | "li" | "p";

/** Any figure in a sentence, a tile, a list or a table cell:
 *  <Num tip="slabs short of the plan so far">{fmtInt(cap.lost)}</Num>.
 *  A column header (`as="th"`) explains every cell under it. */
export function Num({ tip, children, as: Tag = "span", className, style, spoken, scope }: {
  tip: string; children: ReactNode; as?: NumTag; className?: string; style?: CSSProperties; spoken?: boolean;
  /** Only with as="th". */
  scope?: "col" | "row";
}) {
  return <Tag data-tip="" className={className} style={style} scope={Tag === "th" ? scope : undefined}>{children}<TipText tip={tip} spoken={spoken} /></Tag>;
}

/** An SVG bar that explains itself: the native <title> (a browser tooltip
 *  TipLayer cannot lift) becomes a <desc> the bubble reads. The SVG around it
 *  is role="img" with its own aria-label, so the desc is the bubble's only. */
export function TipRect({ tip, ...rect }: SVGProps<SVGRectElement> & { tip: string }) {
  return <rect data-tip="" {...rect}><desc data-tip-text="">{tip}</desc></rect>;
}
