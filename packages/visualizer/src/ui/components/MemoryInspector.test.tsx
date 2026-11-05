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
  expect(await screen.findByText("0.80")).toBeTruthy();
  expect(screen.queryByText("0.640")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Activity" }));
  expect(screen.getByText("0.640")).toBeTruthy();
  expect(screen.queryByText("0.80")).toBeNull();
});

test("cold start (no performance row) shows an honest empty state, not a fabricated zero", async () => {
  vi.spyOn(api, "getMemoryDetail").mockResolvedValue(coldStartMemoryDetailFixture);
  render(<MemoryInspector id="m4" nodesById={nodesById} onClose={() => {}} onSelectNeighbor={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Activity" }));
  expect(screen.getByText(/No usefulness evidence yet/)).toBeTruthy();
});

test("clicking a neighbor row calls onSelectNeighbor with the OTHER side of the pair", async () => {
  vi.spyOn(api, "getMemoryDetail").mockResolvedValue(memoryDetailFixture);
  const onSelectNeighbor = vi.fn();
  render(<MemoryInspector id="m1" nodesById={nodesById} onClose={() => {}} onSelectNeighbor={onSelectNeighbor} />);
  fireEvent.click(await screen.findByRole("button", { name: "Related" }));
  const filter = screen.getByLabelText("Related memory type");
  fireEvent.change(filter, { target: { value: "rule" } });
  expect(screen.queryByText(/similarity 0.65/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /similarity 0.62/ }));
  expect(onSelectNeighbor).toHaveBeenCalledWith("m2");
});

test("long memory content starts as a preview and expands without losing the stored text", async () => {
  const content = "A long memory with a record attached. ".repeat(25) + "END-OF-MEMORY";
  vi.spyOn(api, "getMemoryDetail").mockResolvedValue({
    ...memoryDetailFixture, memory: { ...memoryDetailFixture.memory, content },
  });
  render(<MemoryInspector id="m1" nodesById={nodesById} onClose={() => {}} onSelectNeighbor={() => {}} />);
  const expand = await screen.findByRole("button", { name: "Read full memory" });
  expect(screen.queryByText(/END-OF-MEMORY/)).toBeNull();
  fireEvent.click(expand);
  expect(screen.getByText(content)).toBeTruthy();
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

test("the inspector edge snaps open and shut without discarding the selected section", async () => {
  vi.spyOn(api, "getMemoryDetail").mockResolvedValue(memoryDetailFixture);
  render(<MemoryInspector id="m1" nodesById={nodesById} onClose={() => {}} onSelectNeighbor={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Activity" }));
  const edge = screen.getByRole("separator", { name: "Resize memory inspector" });
  fireEvent.keyDown(edge, { key: "Home" });
  expect(edge.getAttribute("aria-valuetext")).toBe("collapsed");
  expect(screen.queryByRole("heading", { name: "Delivery & feedback" })).toBeNull();
  fireEvent.keyDown(edge, { key: "End" });
  expect(edge.getAttribute("aria-valuetext")).toBe("wide");
  expect(screen.getByRole("heading", { name: "Delivery & feedback" })).toBeTruthy();
});
