import { expect, test } from "bun:test";
import published from "../package.json";
import source from "../src/package.json";

test("source-linked consumers use the published runtime dependencies and peers", () => {
  expect(source.dependencies).toEqual(published.dependencies);
  expect(source.engines).toEqual(published.engines);
  expect(source.peerDependencies).toEqual(published.peerDependencies);
  expect(source.peerDependenciesMeta).toEqual(published.peerDependenciesMeta);
  expect(published.peerDependenciesMeta.typescript.optional).toBe(true);
});
