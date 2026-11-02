import { copyFileSync, existsSync } from "node:fs";

/**
 * Phase 4.3C mechanics (docs/archive/phase-4/PHASE_4_3_REPORT.md "ORGANIC PILOT DESIGN"). Deliberately minimal --
 * this session did not run a live organic pilot (see the report's own reasoning), so this file
 * intentionally does NOT include a task-execution orchestrator: building one, unused, would be
 * exactly the speculative-infrastructure-for-a-pilot-that-isn't-running the project's own
 * lazy-first discipline argues against. What's here are the three primitives the protocol
 * (docs/archive/phase-4/PHASE_4_3_REPORT.md's pre-registered A/B design) actually needs, each independently
 * correct and testable without running a single real task.
 */

/** A pre-task DB snapshot is a plain file copy -- the same primitive Phase 4.1/4.2's own
 *  validation runs already used against data/brain.db. Returns the snapshot path. */
export function snapshotDatabase(sourcePath: string, snapshotPath: string): string {
  if (!existsSync(sourcePath)) {
    throw new Error(`snapshotDatabase: source database does not exist: ${sourcePath}`);
  }
  copyFileSync(sourcePath, snapshotPath);
  return snapshotPath;
}

export type PilotArm = "learning-off" | "learning-on";

/**
 * Frozen, deterministic, balanced assignment (docs/archive/phase-4/PHASE_4_3_REPORT.md "LIVE PILOT A/B DESIGN"):
 * odd task number -> OFF, even -> ON. Never based on expected retrieval quality -- taskNumber is
 * the only input, so the assignment is decided before anyone could look at what either arm would
 * produce.
 */
export function assignArm(taskNumber: number): PilotArm {
  if (!Number.isInteger(taskNumber) || taskNumber < 1) {
    throw new Error(`assignArm: taskNumber must be a positive integer, got ${taskNumber}`);
  }
  return taskNumber % 2 === 0 ? "learning-on" : "learning-off";
}

/** Cohort tag for auditability (docs/archive/phase-4/PHASE_4_3_REPORT.md "PILOT-PROVENANCE ISOLATION") --
 *  genuine tasks, tagged for later separation from Phase 2C pilot data and other activity, never
 *  a marker that the task itself is synthetic. */
export function pilotTaskId(taskNumber: number, slug: string): string {
  return `phase4.3-organic-${String(taskNumber).padStart(2, "0")}-${slug}`;
}
