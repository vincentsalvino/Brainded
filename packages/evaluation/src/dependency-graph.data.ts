/**
 * Phase 3.3 hand-labeled dependency-graph evaluation fixture (PHASE_3_SPEC.md
 * QUALITY EVALUATION). A small, frozen synthetic repository -- not this
 * repository's own code -- covering the required hard cases: comments, dynamic
 * import, re-export, extensionless path, directory index, external package,
 * missing target, and a 2-node cycle. Labels were written before the extractor was
 * ever run against this fixture; not adjusted afterward to make scores look better.
 */

export const DEPENDENCY_FIXTURE_FILES: Record<string, string> = {
  "src/index.ts": [
    `import { createUser } from "./services/user-service";`,
    `import "./polyfill.js";`,
    `// import { fake } from "./fake";`,
    `import config from "zod";`,
    `console.log(createUser, config);`,
    "",
  ].join("\n"),
  "src/polyfill.js": `// side-effect only, no imports of its own\n`,
  "src/services/user-service.ts": [
    `import { UserRepository } from "../repositories/user-repository";`,
    `export { helper } from "./helper";`,
    `export function createUser() { return new UserRepository(); }`,
    "",
  ].join("\n"),
  "src/services/helper.ts": `export function helper() { return true; }\n`,
  "src/repositories/user-repository.ts": [
    `import { db } from "../db";`,
    `export class UserRepository { constructor() { db(); } }`,
    "",
  ].join("\n"),
  "src/cyclic-a.ts": `import "./cyclic-b";\nexport const a = 1;\n`,
  "src/cyclic-b.ts": `import "./cyclic-a";\nexport const b = 1;\n`,
  "src/models/index.ts": `export const Model = {};\n`,
  "src/uses-models.ts": `import { Model } from "./models";\nconsole.log(Model);\n`,
};

export interface GroundTruthEdge {
  source: string;
  specifier: string;
  kind: "static_import" | "dynamic_import" | "require" | "re_export";
  resolution: "internal" | "external" | "unresolved";
  target: string | null;
}

export const DEPENDENCY_FIXTURE_GROUND_TRUTH: GroundTruthEdge[] = [
  { source: "src/index.ts", specifier: "./services/user-service", kind: "static_import", resolution: "internal", target: "src/services/user-service.ts" },
  { source: "src/index.ts", specifier: "./polyfill.js", kind: "static_import", resolution: "internal", target: "src/polyfill.js" },
  { source: "src/index.ts", specifier: "zod", kind: "static_import", resolution: "external", target: null },
  { source: "src/services/user-service.ts", specifier: "../repositories/user-repository", kind: "static_import", resolution: "internal", target: "src/repositories/user-repository.ts" },
  { source: "src/services/user-service.ts", specifier: "./helper", kind: "re_export", resolution: "internal", target: "src/services/helper.ts" },
  { source: "src/repositories/user-repository.ts", specifier: "../db", kind: "static_import", resolution: "unresolved", target: null },
  { source: "src/cyclic-a.ts", specifier: "./cyclic-b", kind: "static_import", resolution: "internal", target: "src/cyclic-b.ts" },
  { source: "src/cyclic-b.ts", specifier: "./cyclic-a", kind: "static_import", resolution: "internal", target: "src/cyclic-a.ts" },
  { source: "src/uses-models.ts", specifier: "./models", kind: "static_import", resolution: "internal", target: "src/models/index.ts" },
];
