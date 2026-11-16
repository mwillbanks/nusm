import { mkdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parseSync, Visitor } from "oxc-parser";
import { isolatedDeclarationSync } from "oxc-transform";

const source = resolve("src");
const output = resolve("dist");
const entries = ["index.ts", "react/index.ts", "devtools/index.ts"];

const bundle = await Bun.build({
  define: { "process.env.NODE_ENV": '"production"' },
  entrypoints: entries.map((path) => join(source, path)),
  format: "esm",
  packages: "external",
  root: source,
  sourcemap: "linked",
  splitting: true,
  target: "node",
});

const sources = new Map(
  [...new Bun.Glob("**/*.{ts,tsx}").scanSync(source)].map((path) => [
    join(source, path.replace(/\.tsx?$/, ".js")),
    join(source, path),
  ]),
);

const declarations = new Map<string, string>();
const pending = new Set(entries.map((path) => join(source, path)));
for (const file of pending) {
  const path = relative(source, file);
  const destination = path.replace(/\.tsx?$/, ".d.ts");
  const target = join(output, destination);
  const original = relative(dirname(target), file);
  const result = isolatedDeclarationSync(
    original,
    await Bun.file(file).text(),
    {
      sourcemap: true,
    },
  );
  if (result.errors.length > 0) {
    throw new Error(
      [path, ...result.errors.map(({ message }) => message)].join("\n"),
    );
  }
  if (!result.map) {
    throw new Error(`Declaration map is missing for ${path}`);
  }
  const parsed = parseSync(destination, result.code);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(({ message }) => message).join("\n"));
  }
  const enqueue = (specifier: string | undefined) => {
    if (!specifier?.startsWith(".")) return;
    const dependency = sources.get(resolve(dirname(file), specifier));
    if (!dependency) {
      throw new Error(`Cannot resolve ${specifier} from ${path}`);
    }
    pending.add(dependency);
  };
  new Visitor({
    ImportDeclaration: (node) => enqueue(node.source.value),
    ExportNamedDeclaration: (node) => enqueue(node.source?.value),
    ExportAllDeclaration: (node) => enqueue(node.source.value),
    TSImportType: (node) => {
      if (typeof node.source.value === "string") enqueue(node.source.value);
    },
  }).visit(parsed.program);

  const mapName = `${destination.split("/").at(-1)}.map`;
  declarations.set(
    destination,
    `${result.code.trimEnd()}\n//# sourceMappingURL=${mapName}\n`,
  );
  declarations.set(`${destination}.map`, JSON.stringify(result.map));
}

await rm(output, { force: true, recursive: true });
await mkdir(output, { recursive: true });
await Promise.all([
  ...bundle.outputs.map((file) => Bun.write(join(output, file.path), file)),
  ...[...declarations].map(([path, contents]) =>
    Bun.write(join(output, path), contents),
  ),
]);
