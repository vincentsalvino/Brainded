/**
 * Phase 3.4 coding-context evaluation fixture (PHASE_3_SPEC.md Phase 3.4,
 * Formal Evaluation). 12 tasks covering the required combinations. Labels
 * were written from this fixture's own content, not from running the
 * integrated context against it.
 */

export const CODING_CONTEXT_MEMORIES = [
  { id: "mem-repo-layer", content: "Architectural rule: route handlers must never import the repository layer directly -- always go through a service.", domain: "architecture" },
  { id: "mem-validation", content: "Constraint: all user-creation input must be validated before it reaches the service layer.", domain: "validation" },
  { id: "mem-testing", content: "Decision: every new route handler needs at least one integration test covering the happy path and one validation-failure path.", domain: "testing" },
  { id: "mem-config", content: "Constraint: configuration values must be read from environment variables, never hardcoded.", domain: "configuration" },
];

export const CODING_CONTEXT_FILES: Record<string, string> = {
  "src/routes/users.ts": "import { UserService } from '../services/user-service';\nexport function createUserRoute(req, res) { return userService.createUser(req.body); }",
  "src/services/user-service.ts": "import { UserRepository } from '../repositories/user-repository';\nexport class UserService { createUser(input) { return this.repo.save(input); } }",
  "src/repositories/user-repository.ts": "export class UserRepository { save(user) { /* db write */ } }",
  "src/services/user-service.test.ts": "import { UserService } from './user-service';\ntest('createUser', () => {});",
  "src/config/index.ts": "export const config = { port: process.env.PORT };",
  "src/utils/weather.ts": "export function getWeather() { return 'sunny'; }",
};

export interface CodingContextTask {
  id: string;
  category: string;
  task: string;
  requiredMemoryIds: string[];
  requiredFilePaths: string[];
  usefulDependencyRelations: { seedPath: string; relation: "dependency" | "dependent" | "impact" }[];
}

export const CODING_CONTEXT_TASKS: CodingContextTask[] = [
  { id: "t1", category: "memory+code", task: "Add validation to the user creation route without bypassing the repository layer", requiredMemoryIds: ["mem-repo-layer", "mem-validation"], requiredFilePaths: ["src/routes/users.ts", "src/services/user-service.ts"], usefulDependencyRelations: [{ seedPath: "src/services/user-service.ts", relation: "dependency" }] },
  { id: "t2", category: "code-only", task: "Where is UserRepository.save implemented", requiredMemoryIds: [], requiredFilePaths: ["src/repositories/user-repository.ts"], usefulDependencyRelations: [] },
  { id: "t3", category: "memory-only", task: "What is the configuration policy for this project", requiredMemoryIds: ["mem-config"], requiredFilePaths: [], usefulDependencyRelations: [] },
  { id: "t4", category: "code+dependency", task: "What does user-service.ts depend on", requiredMemoryIds: [], requiredFilePaths: ["src/services/user-service.ts"], usefulDependencyRelations: [{ seedPath: "src/services/user-service.ts", relation: "dependency" }] },
  { id: "t5", category: "memory+code+dependency", task: "Refactor the user creation flow, keep the repository layer boundary intact", requiredMemoryIds: ["mem-repo-layer"], requiredFilePaths: ["src/routes/users.ts", "src/services/user-service.ts", "src/repositories/user-repository.ts"], usefulDependencyRelations: [{ seedPath: "src/services/user-service.ts", relation: "dependency" }] },
  { id: "t6", category: "validation-change", task: "Add input validation before user creation reaches the service", requiredMemoryIds: ["mem-validation"], requiredFilePaths: ["src/services/user-service.ts"], usefulDependencyRelations: [] },
  { id: "t7", category: "storage-repository-change", task: "Change how UserRepository persists a user", requiredMemoryIds: [], requiredFilePaths: ["src/repositories/user-repository.ts"], usefulDependencyRelations: [{ seedPath: "src/repositories/user-repository.ts", relation: "dependent" }] },
  { id: "t8", category: "api-route-change", task: "Add a new field to the user creation route handler", requiredMemoryIds: ["mem-validation"], requiredFilePaths: ["src/routes/users.ts"], usefulDependencyRelations: [] },
  { id: "t9", category: "cross-package-change", task: "Trace the full path from the users route to the database write", requiredMemoryIds: ["mem-repo-layer"], requiredFilePaths: ["src/routes/users.ts", "src/services/user-service.ts", "src/repositories/user-repository.ts"], usefulDependencyRelations: [{ seedPath: "src/routes/users.ts", relation: "dependency" }] },
  { id: "t10", category: "configuration-change", task: "Where do we read the server port from", requiredMemoryIds: ["mem-config"], requiredFilePaths: ["src/config/index.ts"], usefulDependencyRelations: [] },
  { id: "t11", category: "test-related", task: "What test coverage exists for user creation", requiredMemoryIds: ["mem-testing"], requiredFilePaths: ["src/services/user-service.test.ts"], usefulDependencyRelations: [] },
  { id: "t12", category: "architecture-boundary", task: "Confirm route handlers never call the repository layer directly", requiredMemoryIds: ["mem-repo-layer"], requiredFilePaths: ["src/routes/users.ts", "src/services/user-service.ts"], usefulDependencyRelations: [] },
];
