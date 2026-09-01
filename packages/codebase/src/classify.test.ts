import { test } from "node:test";
import assert from "node:assert/strict";
import { isBinaryContent, detectLanguage } from "./classify.js";

test("isBinaryContent: plain text is not binary", () => {
  assert.equal(isBinaryContent(Buffer.from("hello world\nline two\n", "utf-8")), false);
});

test("isBinaryContent: a buffer containing a NUL byte is binary", () => {
  assert.equal(isBinaryContent(Buffer.from([0x68, 0x69, 0x00, 0x62, 0x79, 0x65])), true);
});

test("isBinaryContent: an empty buffer is not binary", () => {
  assert.equal(isBinaryContent(Buffer.alloc(0)), false);
});

test("isBinaryContent: a NUL byte far beyond the sniff window does not count", () => {
  const buf = Buffer.alloc(9000, 0x61); // all 'a'
  buf[8999] = 0x00;
  assert.equal(isBinaryContent(buf), false);
});

test("detectLanguage: recognizes common extensions", () => {
  assert.equal(detectLanguage("src/index.ts"), "typescript");
  assert.equal(detectLanguage("src/app.tsx"), "typescript");
  assert.equal(detectLanguage("main.py"), "python");
  assert.equal(detectLanguage("lib.rs"), "rust");
  assert.equal(detectLanguage("Main.java"), "java");
  assert.equal(detectLanguage("README.md"), "markdown");
});

test("detectLanguage: an unknown extension is null, not an error", () => {
  assert.equal(detectLanguage("data.xyzzy"), null);
});

test("detectLanguage: a file with no extension is null", () => {
  assert.equal(detectLanguage("Makefile"), null);
});

test("detectLanguage: matching is case-insensitive on the extension", () => {
  assert.equal(detectLanguage("Component.TSX"), "typescript");
});
