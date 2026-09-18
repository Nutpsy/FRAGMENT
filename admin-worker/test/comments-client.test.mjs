import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../comments.js", import.meta.url), "utf8");
test("unconfigured or insecure comment endpoints do not create forms or network requests", () => {
  for (const config of [{}, { apiBase: "" }, { apiBase: "http://example.com", siteKey: "public" }, { apiBase: "https://example.com" }]) {
    vm.runInNewContext(source, {
      URL, window: { FRAGMENT_COMMENTS_CONFIG: config },
      document: new Proxy({}, { get() { assert.fail("disabled comments must not touch the DOM"); } }),
      fetch() { assert.fail("disabled comments must not request external services"); }
    });
  }
});
test("configured comments defer DOM mounting and verification until needed", () => {
  let handler;
  vm.runInNewContext(source, {
    URL, window: { FRAGMENT_COMMENTS_CONFIG: { apiBase: "https://example.workers.dev", siteKey: "public" } },
    document: { addEventListener(event, callback) { assert.equal(event, "DOMContentLoaded"); handler = callback; } },
    fetch() { assert.fail("no automatic network request before mounting"); }
  });
  assert.equal(typeof handler, "function");
});
