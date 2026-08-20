import { test } from "node:test";
import assert from "node:assert/strict";
import { ScopeRefSchema, globalScope, projectScope, sessionScope, scopeIncludes } from "./scope.js";

test("global scope requires null id", () => {
  const parsed = ScopeRefSchema.parse(globalScope());
  assert.equal(parsed.kind, "global");
  assert.equal(parsed.id, null);
});

test("project scope requires non-null id", () => {
  const parsed = ScopeRefSchema.parse(projectScope("proj-1"));
  assert.equal(parsed.id, "proj-1");
});

test("session scope requires non-null id", () => {
  const parsed = ScopeRefSchema.parse(sessionScope("sess-1"));
  assert.equal(parsed.id, "sess-1");
});

test("rejects global scope with a non-null id", () => {
  assert.throws(() => ScopeRefSchema.parse({ kind: "global", id: "should-not-exist" }));
});

test("rejects project scope with a null id", () => {
  assert.throws(() => ScopeRefSchema.parse({ kind: "project", id: null }));
});

test("rejects session scope with a null id", () => {
  assert.throws(() => ScopeRefSchema.parse({ kind: "session", id: null }));
});

test("rejects an unknown scope kind (only global/project/session per D5)", () => {
  assert.throws(() => ScopeRefSchema.parse({ kind: "organization", id: "x" }));
});

test("rejects unrecognized fields (strict -- no silent drop)", () => {
  assert.throws(() => ScopeRefSchema.parse({ kind: "global", id: null, extra: "field" }));
});

test("scopeIncludes: a global record is visible from every query scope", () => {
  const record = globalScope();
  assert.equal(scopeIncludes(record, globalScope()), true);
  assert.equal(scopeIncludes(record, projectScope("p1")), true);
  assert.equal(scopeIncludes(record, sessionScope("s1")), true);
});

test("scopeIncludes: a project record is visible only to the exact same project", () => {
  const record = projectScope("p1");
  assert.equal(scopeIncludes(record, projectScope("p1")), true);
  assert.equal(scopeIncludes(record, projectScope("p2")), false);
  assert.equal(scopeIncludes(record, globalScope()), false);
  assert.equal(scopeIncludes(record, sessionScope("p1")), false);
});

test("scopeIncludes: a session record is visible only to the exact same session", () => {
  const record = sessionScope("s1");
  assert.equal(scopeIncludes(record, sessionScope("s1")), true);
  assert.equal(scopeIncludes(record, sessionScope("s2")), false);
  assert.equal(scopeIncludes(record, globalScope()), false);
});

test("scopeIncludes: a global query scope sees only global records, not a specific project/session", () => {
  assert.equal(scopeIncludes(projectScope("p1"), globalScope()), false);
  assert.equal(scopeIncludes(sessionScope("s1"), globalScope()), false);
});
