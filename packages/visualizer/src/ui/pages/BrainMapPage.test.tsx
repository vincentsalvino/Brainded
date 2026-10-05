import { test, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { api } from "../api-client";
import { BrainMapPage } from "./BrainMapPage";
import { memoryGraphFixture, emptyMemoryGraphFixture } from "../fixtures/graph.fixture";
import { contextDetailFixture } from "../fixtures/contexts.fixture";

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage(overrides: Partial<Parameters<typeof BrainMapPage>[0]> = {}) {
  return render(
    <BrainMapPage
      activeContextId={null}
      onClearContext={() => {}}
      selectedMemoryId={null}
      onSelectMemory={() => {}}
      searchQuery=""
      onSearchQueryChange={() => {}}
      {...overrides}
    />,
  );
}

test("renders the graph and the meta summary once loaded", async () => {
  vi.spyOn(api, "getMemoryGraph").mockResolvedValue(memoryGraphFixture);
  const { container } = renderPage();
  await waitFor(() => expect(container.querySelectorAll("circle").length).toBe(memoryGraphFixture.nodes.length));
  expect(screen.getByText(/7 memories/)).toBeTruthy();
});

test("shows an empty state when there are no memories", async () => {
  vi.spyOn(api, "getMemoryGraph").mockResolvedValue(emptyMemoryGraphFixture);
  renderPage();
  await waitFor(() => screen.getByText(/No memories indexed yet/));
});

test("shows the inspector only when a memory is selected", async () => {
  vi.spyOn(api, "getMemoryGraph").mockResolvedValue(memoryGraphFixture);
  vi.spyOn(api, "getMemoryDetail").mockResolvedValue({
    memory: { ...memoryGraphFixture.nodes[0]!, content: "x", domain: null, source: { origin: "system" }, status: "active", supersedes: null, updatedAt: "" } as never,
    neighbors: [],
    supersededBy: null,
    feedback: { useful: 0, notUseful: 0, other: 0 },
    deliveryCount: 0,
    performance: null,
  });
  const { rerender } = renderPage();
  await waitFor(() => expect(screen.queryByText("Memory Inspector")).toBeNull());

  rerender(
    <BrainMapPage
      activeContextId={null}
      onClearContext={() => {}}
      selectedMemoryId={memoryGraphFixture.nodes[0]!.id}
      onSelectMemory={() => {}}
      searchQuery=""
      onSearchQueryChange={() => {}}
    />,
  );
  await waitFor(() => screen.getByText("Memory Inspector"));
});

test("context trace mode: included/omitted memories from the active context reach GraphCanvas as highlight state", async () => {
  vi.spyOn(api, "getMemoryGraph").mockResolvedValue(memoryGraphFixture);
  vi.spyOn(api, "getContextDetail").mockResolvedValue(contextDetailFixture);
  const { container } = renderPage({ activeContextId: contextDetailFixture.context.id });

  await waitFor(() => screen.getByText(/Context Trace/));
  await waitFor(() => {
    const circles = container.querySelectorAll("circle");
    // contextDetailFixture includes "m1", omits "m2" -- see fixtures/contexts.fixture.ts
    const includedIndex = memoryGraphFixture.nodes.findIndex((n) => n.id === "m1");
    expect(circles[includedIndex]?.getAttribute("opacity")).toBe("1");
  });
});

test("shows an error state when the graph fails to load", async () => {
  vi.spyOn(api, "getMemoryGraph").mockRejectedValue(new Error("network down"));
  renderPage();
  const el = await waitFor(() => screen.getByText(/failed to load memory graph/));
  expect(el.className).toContain("empty-state-error");
});

test("search input and a skeleton canvas are visible immediately, before the graph loads, announced to screen readers", () => {
  vi.spyOn(api, "getMemoryGraph").mockResolvedValue(memoryGraphFixture);
  const { container } = renderPage();
  expect(screen.getByPlaceholderText("Search memories...")).toBeTruthy();
  expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  expect(screen.getByRole("status").textContent).toMatch(/loading/i);
});

test("search filters matched nodes, passed through as matchedIds", async () => {
  vi.spyOn(api, "getMemoryGraph").mockResolvedValue(memoryGraphFixture);
  const { container } = renderPage({ searchQuery: "plural" }); // matches m1's content preview
  await waitFor(() => {
    const circles = container.querySelectorAll("circle");
    const matchIndex = memoryGraphFixture.nodes.findIndex((n) => n.id === "m1");
    expect(circles[matchIndex]?.getAttribute("stroke")).toBe("var(--warning)");
  });
});
