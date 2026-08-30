import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateDataSource, parseDataSource, validateContent } from "../src/index.js";

const source = `const DATA_VERSION = 'v10';

const INITIAL_DATA = {
  scintilla: [{ id: "s1", date: "2026.08.19", content: "hello", }],
  inlandEmpire: [],
  gravityRainbow: [],
  bSide: [],
  manifesto: { text: "fragment", bgStyle: "dark-geo" },
};

const STORAGE_KEY = 'key';`;

test("parses the existing JavaScript data format", () => {
  const parsed = parseDataSource(source);
  assert.equal(parsed.version, "v10");
  assert.equal(parsed.data.scintilla[0].content, "hello");
});

test("generates strict reusable content without changing the data layer", () => {
  const parsed = parseDataSource(source);
  parsed.data.bSide.push({ id: "bs1", date: "2026.08.19", content: "secret" });
  const generated = generateDataSource(source, parsed.data, "20260819010101");
  assert.match(generated, /const DATA_VERSION = "20260819010101";/);
  assert.match(generated, /const STORAGE_KEY = 'key';/);
  assert.equal(parseDataSource(generated).data.bSide[0].content, "secret");
});

test("rejects duplicated IDs", () => {
  assert.throws(() => validateContent({
    scintilla: [{ id: "same", date: "x", content: "a" }, { id: "same", date: "x", content: "b" }],
    inlandEmpire: [], gravityRainbow: [], bSide: [], manifesto: {}
  }), /重复 ID/);
});

test("parses and regenerates the live site data.js", async () => {
  const liveSource = await readFile(new URL("../../data.js", import.meta.url), "utf8");
  const parsed = parseDataSource(liveSource);
  assert.ok(parsed.data.scintilla.length > 0);
  assert.ok(parsed.data.bSide.length > 0);
  const regenerated = generateDataSource(liveSource, parsed.data, "test-version");
  assert.deepEqual(parseDataSource(regenerated).data, parsed.data);
});
