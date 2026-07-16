import { describe, expect, test } from "bun:test";
import { resolveStaticAsset } from "./static-path";

const root = new URL("file:///workspace/example/dist/");

describe("production example static path resolution", () => {
  test.each([
    "http://example.test//etc/passwd",
    "http://example.test/%2Fetc/passwd",
    "http://example.test/%2fetc/passwd",
    "http://example.test/../etc/passwd",
    "http://example.test/%2e%2e/etc/passwd",
    "http://example.test/assets%5C..%5Csecret",
    "http://example.test/%E0%A4%A",
  ])("rejects traversal input %s", (requestUrl) => {
    expect(resolveStaticAsset(requestUrl, root)).toBeUndefined();
  });

  test("resolves assets and the document root beneath dist", () => {
    expect(resolveStaticAsset("http://example.test/", root)?.href).toBe(
      "file:///workspace/example/dist/index.html",
    );
    expect(
      resolveStaticAsset("http://example.test/assets/app.js", root)?.href,
    ).toBe("file:///workspace/example/dist/assets/app.js");
  });
});
