import { describe, expect, it } from "vitest";
import { parseFolderId } from "../server/folderId.js";

describe("parseFolderId", () => {
  it("accepts a bare folder id", () => {
    expect(parseFolderId("abc123")).toBe("abc123");
  });

  it("extracts an id from a folder URL", () => {
    expect(parseFolderId("https://drive.google.com/drive/folders/abc123?usp=sharing")).toBe(
      "abc123"
    );
  });

  it("extracts an id query parameter", () => {
    expect(parseFolderId("https://drive.google.com/open?id=abc123")).toBe("abc123");
  });

  it("rejects empty input", () => {
    expect(() => parseFolderId(" ")).toThrow(/folder/i);
  });
});
