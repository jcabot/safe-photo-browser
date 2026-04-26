// Decides whether an auto-advance timer should be running and starts one
// if so. Returns a cleanup function that clears the timer, or undefined if
// no timer was set. Designed to be called from a React useEffect (the return
// value is what useEffect expects). MUST return undefined, never null —
// returning null causes React to try to invoke null() as the cleanup on the
// next effect run, throwing a TypeError that blanks the component tree.
//
// Rules:
//   - No item or autoAdvance is off              -> no timer.
//   - Item is a video and autoAdvanceVideos off  -> no timer (video plays
//                                                    to natural end and
//                                                    advances via onEnded).
//   - Otherwise                                  -> timer for autoAdvanceSeconds.
export function runAutoAdvanceEffect({
  item,
  autoAdvance,
  autoAdvanceSeconds,
  autoAdvanceVideos,
  onEnded
}) {
  if (!item || !autoAdvance) return undefined;
  const isVideo = item.mimeType?.startsWith("video/") ?? false;
  if (isVideo && !autoAdvanceVideos) return undefined;
  const id = setTimeout(() => onEnded?.(), autoAdvanceSeconds * 1000);
  return () => clearTimeout(id);
}
