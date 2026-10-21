// Where the gift's sheet may sit while a phone's on-screen keyboard is up: the part of the page the person can still
// see, the visual viewport. Browsers disagree about what the keyboard does to everything else: Safari on an older
// iPhone keeps the page's height and pans over it, newer iPhones also shrink 100dvh (so subtracting the keyboard
// from it took it away twice, and the sheet folded to a sliver), and Chrome on Android may resize the whole page. The
// visual viewport's own box is right in every case, so while a keyboard is up the sheet is laid in it, and otherwise
// the stylesheet's own layout stands (gift.css .gift-dock). Pure, so it is tested without a browser.

/** The visible box to lay the sheet in, in the page's fixed coordinates, or null while no keyboard is up. */
export function keyboardBox(innerHeight: number, vv: { height: number; offsetTop: number }): { top: number; height: number } | null {
  const covered = innerHeight - vv.height - vv.offsetTop;
  // small differences are browser toolbars moving, not a keyboard
  if (covered <= 80) return null;
  return { top: Math.round(vv.offsetTop), height: Math.round(vv.height) };
}
