import { z } from "zod";
import { globalScope } from "@brain/contracts";

/**
 * Phase 3.2 hand-labeled code retrieval evaluation fixture (PHASE_3_SPEC.md
 * EVALUATION DATASET). A small, frozen synthetic repository -- not this
 * repository's own code -- so labels stay stable regardless of future edits
 * elsewhere. Ten chunks covering the required intent categories (implementation,
 * validation, error handling, persistence, configuration, tests, type/interface,
 * boundary enforcement) plus two unrelated distractor chunks; twelve queries.
 *
 * `key` doubles as the chunk's id/fileId when seeded into a store -- results map
 * straight back to a label without an indirection table. Labels are graded
 * (0/1/2), same convention as @brain/evaluation's EvalExample, reusing the same
 * Grade meaning: 2 = the chunk a competent engineer would act on, 1 = related but
 * secondary, 0 = not useful (absent from `labels` also means 0).
 *
 * Frozen before evaluation ran (PHASE_3_SPEC.md instruction: do not tune content or
 * queries after seeing scores).
 */

export const CodeEvalChunkSchema = z
  .object({
    key: z.string().min(1),
    relativePath: z.string().min(1),
    language: z.string().min(1),
    content: z.string().min(1),
  })
  .strict();
export type CodeEvalChunk = z.infer<typeof CodeEvalChunkSchema>;

export const CODE_EVAL_REPOSITORY_ID = "code-eval-fixture-repo";
export const CODE_EVAL_SCOPE = globalScope();

export const CODE_EVAL_CHUNKS: CodeEvalChunk[] = [
  {
    key: "user-service-create",
    relativePath: "src/services/user-service.ts",
    language: "typescript",
    content:
      "export async function createUser(input: CreateUserInput) { const user = await userRepository.save(input); return user; }",
  },
  {
    key: "user-schema-validate",
    relativePath: "src/schemas/user-schema.ts",
    language: "typescript",
    content:
      "export const userSchema = z.object({ email: z.string().email(), name: z.string().min(1) }); export function validateUser(input: unknown) { return userSchema.parse(input); }",
  },
  {
    key: "error-handler",
    relativePath: "src/middleware/error-handler.ts",
    language: "typescript",
    content:
      "export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) { logger.error(err); res.status(500).json({ message: 'internal server error' }); }",
  },
  {
    key: "user-repository",
    relativePath: "src/repositories/user-repository.ts",
    language: "typescript",
    content:
      "export class UserRepository { async save(user: User) { return this.db.prepare('INSERT INTO users (id, email, name) VALUES (?,?,?)').run(user.id, user.email, user.name); } }",
  },
  {
    key: "app-config",
    relativePath: "src/config/app-config.ts",
    language: "typescript",
    content:
      "export const config = { port: process.env.PORT ?? 3000, databaseUrl: process.env.DATABASE_URL }; export function loadConfig() { return config; }",
  },
  {
    key: "user-service-test",
    relativePath: "tests/user-service.test.ts",
    language: "typescript",
    content:
      "test('createUser persists a new user', async () => { const user = await createUser({ email: 'a@b.com', name: 'A' }); assert.ok(user.id); });",
  },
  {
    key: "user-types",
    relativePath: "src/types/user.ts",
    language: "typescript",
    content: "export interface User { id: string; email: string; name: string; } export type CreateUserInput = Pick<User, 'email' | 'name'>;",
  },
  {
    key: "db-boundary-rule",
    relativePath: "src/repositories/boundary.ts",
    language: "typescript",
    content:
      "// architecture rule: database access must go through a repository interface; route handlers and services must never import the database driver directly.",
  },
  {
    key: "health-route",
    relativePath: "src/routes/health.ts",
    language: "typescript",
    content: "router.get('/health', (req: Request, res: Response) => { res.send('ok'); });",
  },
  {
    key: "weather-util",
    relativePath: "src/utils/weather.ts",
    language: "typescript",
    content: "export function currentForecast() { return { sunny: true, temperatureC: 21 }; }",
  },
];

export interface CodeEvalQuery {
  id: string;
  text: string;
  /** intent category, for the human-readable per-query report only -- not consumed by metrics */
  intent: string;
  labels: Record<string, 0 | 1 | 2>;
}

export const CODE_EVAL_QUERIES: CodeEvalQuery[] = [
  { id: "q1", text: "where is a new user created", intent: "locate implementation", labels: { "user-service-create": 2, "user-repository": 1 } },
  { id: "q2", text: "where is user input validated", intent: "locate validation", labels: { "user-schema-validate": 2 } },
  { id: "q3", text: "where are errors handled", intent: "locate error handling", labels: { "error-handler": 2 } },
  { id: "q4", text: "where is user data persisted to the database", intent: "locate persistence", labels: { "user-repository": 2, "user-service-create": 1 } },
  { id: "q5", text: "where is application configuration loaded", intent: "locate configuration", labels: { "app-config": 2 } },
  { id: "q6", text: "where are the tests for creating a user", intent: "locate tests", labels: { "user-service-test": 2 } },
  { id: "q7", text: "what is the shape of a User type", intent: "locate type/interface", labels: { "user-types": 2 } },
  {
    id: "q8",
    text: "where is database access restricted to a boundary layer",
    intent: "locate boundary enforcement",
    labels: { "db-boundary-rule": 2, "user-repository": 1 },
  },
  { id: "q9", text: "how does the health check endpoint work", intent: "locate implementation", labels: { "health-route": 2 } },
  { id: "q10", text: "what does the weather utility return", intent: "locate implementation", labels: { "weather-util": 2 } },
  {
    id: "q11",
    text: "validate user input before creating a user",
    intent: "locate validation",
    labels: { "user-schema-validate": 2, "user-service-create": 1 },
  },
  {
    id: "q12",
    text: "repository pattern for saving a user",
    intent: "locate persistence",
    labels: { "user-repository": 2, "db-boundary-rule": 1 },
  },
];
