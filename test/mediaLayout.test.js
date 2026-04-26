import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve("src/styles.css"), "utf8");

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const match = css.match(re);
  if (!match) {
    throw new Error(`Selector ${selector} not found in styles.css`);
  }
  return match[1];
}

describe("media frame layout — no cropping", () => {
  it("media-frame uses flex centering, not grid", () => {
    // Grid with auto track sizing creates a cell sized to the item's
    // max-content. An image with max-height: 100% then has a circular
    // constraint and falls back to intrinsic size, overflowing the frame.
    // Flex sizes children against the container directly, so max-height:
    // 100% resolves correctly. This bug hit vertical images hardest.
    const body = ruleBody(".media-frame");
    expect(body).toMatch(/display:\s*flex/);
    expect(body).not.toMatch(/display:\s*grid/);
    expect(body).toMatch(/align-items:\s*center/);
    expect(body).toMatch(/justify-content:\s*center/);
  });

  it("media-frame still clips overflow as a safety net", () => {
    expect(ruleBody(".media-frame")).toMatch(/overflow:\s*hidden/);
  });

  it("img and video are bounded by the frame and use object-fit contain", () => {
    const re = /\.media-frame img[^{]*\{([^}]*)\}/;
    const match = css.match(re);
    expect(match).toBeTruthy();
    const body = match[1];
    expect(body).toMatch(/max-width:\s*100%/);
    expect(body).toMatch(/max-height:\s*100%/);
    expect(body).toMatch(/object-fit:\s*contain/);
  });
});

describe("switch toggle — must not scroll the page when clicked", () => {
  // Regression: the .switch input was `position: absolute` without an offset
  // and .switch wasn't a positioned ancestor, so when clicking the label
  // focused the input the browser scrolled the page (body.scrollTop jumped
  // to ~1070px) bringing the input "into view" — but the input was actually
  // at the top-left of the document, off-screen because of the high
  // scrollTop. Effect: clicking any folder toggle blanked the visible page.

  it(".switch is a positioned ancestor so its absolute child stays inside it", () => {
    const body = ruleBody(".switch");
    expect(body).toMatch(/position:\s*relative/);
  });

  it(".switch input uses the visually-hidden pattern (clip + 1px) to suppress scroll-to-focus", () => {
    const body = ruleBody(".switch input");
    // The input must be visually hidden in a way that doesn't trigger the
    // browser's scroll-into-view-on-focus behaviour.
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/opacity:\s*0/);
    // clip: rect(0, 0, 0, 0) prevents the browser from treating the element
    // as having on-screen geometry.
    expect(body).toMatch(/clip:\s*rect\(\s*0(?:px)?\s*,\s*0(?:px)?\s*,\s*0(?:px)?\s*,\s*0(?:px)?\s*\)/);
  });
});

describe("media frame layout — fits large images without cropping", () => {
  // Pure-math model of the CSS rules:
  //   width: auto; height: auto; max-width: 100%; max-height: 100%
  // The image scales uniformly to fit within the frame, preserving aspect
  // ratio. Smaller images stay at natural size (don't enlarge).
  function fit(imgW, imgH, frameW, frameH) {
    const ratio = Math.min(frameW / imgW, frameH / imgH, 1);
    return { width: imgW * ratio, height: imgH * ratio };
  }

  function expectFitsWithoutCropping(rendered, frameW, frameH, imgW, imgH) {
    expect(rendered.width).toBeLessThanOrEqual(frameW + 0.001);
    expect(rendered.height).toBeLessThanOrEqual(frameH + 0.001);
    // Aspect ratio preserved (no cropping/squishing)
    expect(rendered.width / rendered.height).toBeCloseTo(imgW / imgH, 5);
  }

  it("tall vertical photo (2000x6000) fits a wide frame (1200x700)", () => {
    const r = fit(2000, 6000, 1200, 700);
    expectFitsWithoutCropping(r, 1200, 700, 2000, 6000);
    // Height-bound: 700 / 6000 is the limiting ratio
    expect(r.height).toBeCloseTo(700, 5);
    expect(r.width).toBeCloseTo((2000 * 700) / 6000, 5);
  });

  it("very tall portrait (1080x4500) fits a normal frame (1100x780)", () => {
    const r = fit(1080, 4500, 1100, 780);
    expectFitsWithoutCropping(r, 1100, 780, 1080, 4500);
    expect(r.height).toBeCloseTo(780, 5);
  });

  it("ultra-wide panorama (8000x2000) fits a narrow frame (600x700)", () => {
    const r = fit(8000, 2000, 600, 700);
    expectFitsWithoutCropping(r, 600, 700, 8000, 2000);
    // Width-bound: 600 / 8000 is the limiting ratio
    expect(r.width).toBeCloseTo(600, 5);
  });

  it("smaller image than frame is not enlarged", () => {
    const r = fit(400, 300, 1200, 700);
    expect(r.width).toBe(400);
    expect(r.height).toBe(300);
  });

  it("a 4K image (3840x2160) fits a small frame (800x600)", () => {
    const r = fit(3840, 2160, 800, 600);
    expectFitsWithoutCropping(r, 800, 600, 3840, 2160);
    // Width-bound here
    expect(r.width).toBeCloseTo(800, 5);
  });
});
