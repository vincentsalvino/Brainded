import { test, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { api } from "../api-client";
import { MemoryInspector } from "./MemoryInspector";
import { memoryGraphFixture, memoryDetailFixture, coldStartMemoryDetailFixture } from "../fixtures/graph.fixture";

const nodesById = new Map(memoryGraphFixture.nodes.map((n) => [n.id, n]));

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders content, metadata, and confidence", async () => {
  vi.spyOn(api, "getMemoryDetail").mockResolvedValue(memoryDetailFixture);
  render(<MemoryInspector id="m1" nodesById={nodesById} onClose={() => {}} onSelectNeighbor={() => {}} />);
  await waitFor(() => screen.getByText(memoryDetailFixture.memory.content));
  expect(screen.getByText("0.80")).toBeTruthy(); // confidence
});

test("confidence and usefulnessSignal render as visually separate, labeled blocks -- never merged", async () => {
  vi.spyOn(api, "getMemoryDetail").mockResolvedValue(memoryDetailFixture);
  render(<MemoryInspector id="m1" nodesById={nodesById} onClose={() => {}} onSelectNeighbor={() => {}} />);
  await waitFor(() => screen.getByText(/DERIVED \/ EXPERIMENTAL/));
  expect(screen.getByText("0.640")).toBeTruthy(); // usefulnessSignal, distinct element from confidence's "0.80"
  expect(screen.getByText("0.80")).toBeTruthy();
});

test("cold start (no performance row) shows an honest empty state, not a fabricated zero", async () => {
  vi.spyOn(api, "getMemoryDetail").mockResolvedValue(coldStartMemoryDetailFixture);
  render(<MemoryInspector id="m4" nodesById={nodesById} onClose={() => {}} onSelectNeighbor={() => {}} />);
  await waitFor(() => screen.getByText(/No usefulness evidence yet/));
});

test("clicking a neighbor row calls onSelectNeighbor with the OTHER side of the pair", async () => {
  vi.spyOn(api, "getMemoryDetail").mockResolvedValue(memoryDetailFixture);
  const onSelectNeighbor = vi.fn();
  render(<MemoryInspector id="m1" nodesById={nodesById} onClose={() => {}} onSelectNeighbor={onSelectNeighbor} />);
  const row = await waitFor(() => screen.getByText(/similarity 0.62/));
  fireEvent.click(row.closest(".row-item")!);
  expect(onSelectNeighbor).toHaveBeenCalledWith("m2");
});

test("shows a skeleton placeholder in the panel while loading, announced to screen readers", () => {
  vi.spyOn(api, "getMemoryDetail").mockResolvedValue(memoryDetailFixture);
  const { container } = render(<MemoryInspector id="m1" nodesById={nodesById} onClose={() => {}} onSelectNeighbor={() => {}} />);
  expect(screen.getByText("Memory Inspector")).toBeTruthy();
  expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  expect(screen.getByRole("status").textContent).toMatch(/loading/i);
});

test("shows an error state when the fetch fails", async () => {
  vi.spyOn(api, "getMemoryDetail").mockRejectedValue(new Error("network down"));
  render(<MemoryInspector id="m1" nodesById={nodesById} onClose={() => {}} onSelectNeighbor={() => {}} />);
  const el = await waitFor(() => screen.getByText(/failed to load memory/));
  expect(el.className).toContain("empty-state-error");
});

test("close button calls onClose", async () => {
  vi.spyOn(api, "getMemoryDetail").mockResolvedValue(memoryDetailFixture);
  const onClose = vi.fn();
  render(<MemoryInspector id="m1" nodesById={nodesById} onClose={onClose} onSelectNeighbor={() => {}} />);
  await waitFor(() => screen.getByText(memoryDetailFixture.memory.content));
  fireEvent.click(screen.getByLabelText("Close inspector"));
  expect(onClose).toHaveBeenCalled();
});
