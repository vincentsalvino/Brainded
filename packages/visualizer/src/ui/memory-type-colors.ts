import type { MemoryType } from "@brain/contracts";

// Evenly-spaced hues (30° steps) at a muted saturation/lightness that stays
// legible on the dark surface tokens without reading as neon. Independent of
// --success/--danger/--warning: those are status colors, these are a neutral
// categorical palette, not a judgment about any given type.
export const MEMORY_TYPE_COLORS: Record<MemoryType, string> = {
  fact: "hsl(0, 55%, 65%)",
  decision: "hsl(30, 55%, 60%)",
  pattern: "hsl(60, 45%, 55%)",
  rule: "hsl(90, 40%, 60%)",
  procedure: "hsl(120, 40%, 60%)",
  experience: "hsl(150, 40%, 60%)",
  error: "hsl(180, 40%, 55%)",
  constraint: "hsl(210, 50%, 65%)",
  project_state: "hsl(240, 45%, 70%)",
  task_state: "hsl(270, 45%, 68%)",
  agent_experience: "hsl(300, 45%, 68%)",
  preference: "hsl(330, 50%, 68%)",
};
