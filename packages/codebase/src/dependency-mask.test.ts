import { test } from "node:test";
import assert from "node:assert/strict";
import { maskComments } from "./dependency-mask.js";

test("line comment is blanked out", () => {
  const masked = maskComments(`// import x from "./fake"\nconst y = 1;`);
  assert.ok(!masked.includes("import"));
  assert.ok(masked.includes("const y = 1;"));
});

test("block comment is blanked out", () => {
  const masked = maskComments(`/*\nrequire("./fake")\n*/\nconst y = 1;`);
  assert.ok(!masked.includes("require"));
  assert.ok(masked.includes("const y = 1;"));
});

test("block comment spanning a single line is blanked out", () => {
  const masked = maskComments(`const x = 1; /* import "./fake" */ const y = 2;`);
  assert.ok(!masked.includes("import"));
  assert.ok(masked.includes("const x = 1;"));
  assert.ok(masked.includes("const y = 2;"));
});

test("line count is preserved (newlines inside comments survive)", () => {
  const content = `/*\nline2\nline3\n*/\nconst y = 1;`;
  const masked = maskComments(content);
  assert.equal(masked.split("\n").length, content.split("\n").length);
});

test("string literals pass through untouched, including their contents", () => {
  const masked = maskComments(`import x from "./real-module";`);
  assert.equal(masked, `import x from "./real-module";`);
});

test("a // inside a string literal is not treated as a comment start", () => {
  const masked = maskComments(`const url = "http://example.com/path"; const y = 1;`);
  assert.ok(masked.includes(`"http://example.com/path"`));
  assert.ok(masked.includes("const y = 1;"));
});

test("a /* inside a string literal is not treated as a comment start", () => {
  const masked = maskComments(`const s = "/* not a comment */"; const y = 1;`);
  assert.ok(masked.includes("const y = 1;"), "code after the string must survive, not be swallowed as a fake block comment");
});

test("single-quoted and template-literal strings are also passed through untouched", () => {
  const single = maskComments(`import x from './real-module';`);
  assert.equal(single, `import x from './real-module';`);
  const template = maskComments("const s = `./real-${x}`;");
  assert.equal(template, "const s = `./real-${x}`;");
});

test("an escaped quote inside a string does not end the string early", () => {
  const content = `const s = "a \\" still inside // not a comment"; const y = 1;`;
  const masked = maskComments(content);
  assert.equal(masked, content, "no real comment exists here (the // is inside the string) -- nothing should be masked");
});

test("empty content masks to empty content", () => {
  assert.equal(maskComments(""), "");
});

test("content with no comments or strings is returned unchanged", () => {
  const content = `function add(a, b) {\n  return a + b;\n}`;
  assert.equal(maskComments(content), content);
});
