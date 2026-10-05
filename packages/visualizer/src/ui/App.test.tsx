import { test, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { App } from "./App";
import { api } from "./api-client";
import { overviewFixture } from "./fixtures/overview.fixture";
import { memoryGraphFixture, memoryDetailFixture } from "./fixtures/graph.fixture";
import { contextListFixture, contextDetailFixture } from "./fixtures/contexts.fixture";

afterEach(() => {
  vi.restoreAllMocks();
});

function stubApi() {
  vi.spyOn(api, "getOverview").mockResolvedValue(overviewFixture);
  vi.spyOn(api, "getMemoryGraph").mockResolvedValue(memoryGraphFixture);
  vi.spyOn(api, "listContexts").mockResolvedValue(contextListFixture);
  vi.spyOn(api, "getContextDetail").mockResolvedValue(contextDetailFixture);
  vi.spyOn(api, "getMemoryDetail").mockResolvedValue(memoryDetailFixture);
}

test("defaults to the Brain Map view", async () => {
  stubApi();
  const { container } = render(<App />);
  await waitFor(() => expect(container.querySelectorAll("circle").length).toBe(memoryGraphFixture.nodes.length));
});

test("Contexts nav shows the context list; selecting a row returns to the map in trace mode", async () => {
  stubApi();
  render(<App />);
  fireEvent.click(screen.getByText("Contexts"));
  const row = await waitFor(() => screen.getByText(contextListFixture.items[0]!.taskId!));
  fireEvent.click(row.closest(".row-item")!);

  await waitFor(() => screen.getByText(/Context Trace/));
});

test("Escape clears the topmost overlay first (memory selection), a second Escape clears context trace", async () => {
  stubApi();
  const { container } = render(<App />);

  // Enter trace mode.
  fireEvent.click(screen.getByText("Contexts"));
  const row = await waitFor(() => screen.getByText(contextListFixture.items[0]!.taskId!));
  fireEvent.click(row.closest(".row-item")!);
  await waitFor(() => screen.getByText(/Context Trace/));

  // Select a memory node.
  await waitFor(() => expect(container.querySelectorAll("circle").length).toBeGreaterThan(0));
  const circle = container.querySelectorAll("circle")[0]!;
  fireEvent.pointerDown(circle, { pointerId: 1, clientX: 5, clientY: 5 });
  fireEvent.pointerUp(circle, { pointerId: 1, clientX: 5, clientY: 5 });
  await waitFor(() => screen.getByText("Memory Inspector"));

  // First Escape: closes the inspector, trace badge stays.
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByText("Memory Inspector")).toBeNull());
  expect(screen.getByText(/Context Trace/)).toBeTruthy();

  // Second Escape: clears trace mode too.
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByText(/Context Trace/)).toBeNull());
});

test("the back-to-full-graph pill button also clears trace mode", async () => {
  stubApi();
  render(<App />);
  fireEvent.click(screen.getByText("Contexts"));
  const row = await waitFor(() => screen.getByText(contextListFixture.items[0]!.taskId!));
  fireEvent.click(row.closest(".row-item")!);
  const backButton = await waitFor(() => screen.getByText("back to full graph"));
  fireEvent.click(backButton);
  await waitFor(() => expect(screen.queryByText(/Context Trace/)).toBeNull());
});

test("Overview nav renders the overview screen", async () => {
  stubApi();
  render(<App />);
  fireEvent.click(screen.getByText("Overview"));
  await waitFor(() => screen.getByText(String(overviewFixture.memories.total)));
});
