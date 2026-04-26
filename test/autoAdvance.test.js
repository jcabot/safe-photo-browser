import { afterEach, describe, expect, it, vi } from "vitest";
import { runAutoAdvanceEffect } from "../src/autoAdvance.js";

afterEach(() => {
  vi.useRealTimers();
});

const image = (id = "img1") => ({ id, mimeType: "image/jpeg" });
const video = (id = "vid1") => ({ id, mimeType: "video/mp4" });

describe("runAutoAdvanceEffect — when a timer should start", () => {
  it("returns null and never fires when autoAdvance is off", () => {
    vi.useFakeTimers();
    const onEnded = vi.fn();
    const cleanup = runAutoAdvanceEffect({
      item: image(),
      autoAdvance: false,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: false,
      onEnded
    });
    expect(cleanup).toBeUndefined();
    vi.advanceTimersByTime(10_000);
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("returns null when there is no item", () => {
    vi.useFakeTimers();
    const onEnded = vi.fn();
    const cleanup = runAutoAdvanceEffect({
      item: null,
      autoAdvance: true,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: false,
      onEnded
    });
    expect(cleanup).toBeUndefined();
    vi.advanceTimersByTime(10_000);
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("starts a timer for an image when autoAdvance is on", () => {
    vi.useFakeTimers();
    const onEnded = vi.fn();
    const cleanup = runAutoAdvanceEffect({
      item: image(),
      autoAdvance: true,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: false,
      onEnded
    });
    expect(cleanup).not.toBeNull();
    vi.advanceTimersByTime(2999);
    expect(onEnded).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("does NOT start a timer for a video when autoAdvanceVideos is off (video plays to natural end)", () => {
    vi.useFakeTimers();
    const onEnded = vi.fn();
    const cleanup = runAutoAdvanceEffect({
      item: video(),
      autoAdvance: true,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: false,
      onEnded
    });
    expect(cleanup).toBeUndefined();
    vi.advanceTimersByTime(10_000);
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("starts a timer for a video when autoAdvanceVideos is on", () => {
    vi.useFakeTimers();
    const onEnded = vi.fn();
    const cleanup = runAutoAdvanceEffect({
      item: video(),
      autoAdvance: true,
      autoAdvanceSeconds: 4,
      autoAdvanceVideos: true,
      onEnded
    });
    expect(cleanup).not.toBeNull();
    vi.advanceTimersByTime(4000);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});

describe("runAutoAdvanceEffect — never returns null (page-blank regression)", () => {
  // React's useEffect calls the previous render's cleanup before re-running
  // the effect. Internally it does roughly `if (cleanup !== undefined)
  // cleanup()`, so returning `null` makes React attempt `null()` and throw a
  // TypeError, which unmounts the component tree — symptom: clicking the
  // seconds input blanked the page once a session was running. The "no
  // timer" branches must return undefined, not null.
  const cases = [
    {
      name: "no item",
      args: { item: null, autoAdvance: true, autoAdvanceSeconds: 3, autoAdvanceVideos: false }
    },
    {
      name: "autoAdvance off",
      args: { item: image(), autoAdvance: false, autoAdvanceSeconds: 3, autoAdvanceVideos: false }
    },
    {
      name: "video without autoAdvanceVideos",
      args: { item: video(), autoAdvance: true, autoAdvanceSeconds: 3, autoAdvanceVideos: false }
    }
  ];

  for (const { name, args } of cases) {
    it(`returns undefined (never null) when ${name}`, () => {
      vi.useFakeTimers();
      const result = runAutoAdvanceEffect({ ...args, onEnded: vi.fn() });
      expect(result).toBeUndefined();
      expect(result).not.toBeNull();
    });
  }
});

describe("runAutoAdvanceEffect — toggle and re-run scenarios (the regression)", () => {
  it("REGRESSION: toggling autoAdvance ON while item is showing starts the timer", () => {
    // The original bug: timer was started in img.onLoad / video.onPlay, so
    // turning autoAdvance ON after the image had already loaded did nothing.
    // The effect-driven version re-runs whenever autoAdvance flips, which is
    // simulated here by two consecutive runAutoAdvanceEffect calls with the
    // same item but a flipped autoAdvance flag.
    vi.useFakeTimers();
    const onEnded = vi.fn();
    const item = image();

    // 1. Initial render: autoAdvance is off. No timer.
    const cleanup1 = runAutoAdvanceEffect({
      item,
      autoAdvance: false,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: false,
      onEnded
    });
    expect(cleanup1).toBeUndefined();

    // User stares at the image for a while.
    vi.advanceTimersByTime(8000);
    expect(onEnded).not.toHaveBeenCalled();

    // 2. User toggles autoAdvance ON. React re-runs the effect; cleanup1 is
    //    null so nothing to clean up. New effect runs.
    const cleanup2 = runAutoAdvanceEffect({
      item,
      autoAdvance: true,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: false,
      onEnded
    });
    expect(cleanup2).not.toBeNull();

    // After autoAdvanceSeconds, onEnded fires.
    vi.advanceTimersByTime(3000);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("toggling autoAdvance OFF clears the pending timer", () => {
    vi.useFakeTimers();
    const onEnded = vi.fn();
    const item = image();

    const cleanup1 = runAutoAdvanceEffect({
      item,
      autoAdvance: true,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: false,
      onEnded
    });
    expect(cleanup1).not.toBeNull();

    vi.advanceTimersByTime(1000);
    expect(onEnded).not.toHaveBeenCalled();

    // User toggles OFF. React calls cleanup1, then re-runs effect.
    cleanup1();
    const cleanup2 = runAutoAdvanceEffect({
      item,
      autoAdvance: false,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: false,
      onEnded
    });
    expect(cleanup2).toBeUndefined();

    vi.advanceTimersByTime(10_000);
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("changing autoAdvanceSeconds restarts the timer with the new duration", () => {
    vi.useFakeTimers();
    const onEnded = vi.fn();
    const item = image();

    const cleanup1 = runAutoAdvanceEffect({
      item,
      autoAdvance: true,
      autoAdvanceSeconds: 10,
      autoAdvanceVideos: false,
      onEnded
    });
    expect(cleanup1).not.toBeNull();

    vi.advanceTimersByTime(2000);

    // User shortens the seconds. React cleans up old timer, runs effect again.
    cleanup1();
    runAutoAdvanceEffect({
      item,
      autoAdvance: true,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: false,
      onEnded
    });

    // Old 10s timer should be gone — only the new 3s one is ticking.
    vi.advanceTimersByTime(2999);
    expect(onEnded).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("toggling autoAdvanceVideos ON for a video that's already showing starts the timer", () => {
    vi.useFakeTimers();
    const onEnded = vi.fn();
    const item = video();

    // autoAdvance on but autoAdvanceVideos off — no timer (video plays to end).
    const cleanup1 = runAutoAdvanceEffect({
      item,
      autoAdvance: true,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: false,
      onEnded
    });
    expect(cleanup1).toBeUndefined();

    vi.advanceTimersByTime(5000);
    expect(onEnded).not.toHaveBeenCalled();

    // User toggles "Use timer for videos too" ON.
    const cleanup2 = runAutoAdvanceEffect({
      item,
      autoAdvance: true,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: true,
      onEnded
    });
    expect(cleanup2).not.toBeNull();

    vi.advanceTimersByTime(3000);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("changing item triggers a fresh timer (not double-fires the previous one)", () => {
    vi.useFakeTimers();
    const onEnded = vi.fn();

    const cleanup1 = runAutoAdvanceEffect({
      item: image("img1"),
      autoAdvance: true,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: false,
      onEnded
    });

    vi.advanceTimersByTime(1000);
    cleanup1();

    runAutoAdvanceEffect({
      item: image("img2"),
      autoAdvance: true,
      autoAdvanceSeconds: 3,
      autoAdvanceVideos: false,
      onEnded
    });

    // Neither old (cleared) nor new (still ticking) timer should have fired.
    vi.advanceTimersByTime(2999);
    expect(onEnded).not.toHaveBeenCalled();

    // Only the new timer fires.
    vi.advanceTimersByTime(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});
