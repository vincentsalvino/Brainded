import { test, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { api } from "../api-client";
import { OverviewPage } from "./OverviewPage";
import { overviewFixture, emptyOverviewFixture } from "../fixtures/overview.fixture";

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders memory and event counts from a fixture overview response", async () => {
  vi.spyOn(api, "getOverview").mockResolvedValue(overviewFixture);
  render(<OverviewPage />);
  await waitFor(() => screen.getByText(String(overviewFixture.memories.total)));
  expect(screen.getByText(String(overviewFixture.events.contextEvents))).toBeTruthy();
  expect(screen.getByText(String(overviewFixture.events.feedbackEvents))).toBeTruthy();
});

test("renders recent activity items", async () => {
  vi.spyOn(api, "getOverview").mockResolvedValue(overviewFixture);
  render(<OverviewPage />);
  await waitFor(() => expect(screen.getAllByText(/outcome|feedback|context|mutation/).length).toBeGreaterThan(0));
});

test("shows an empty state when there is no recent activity", async () => {
  vi.spyOn(api, "getOverview").mockResolvedValue(emptyOverviewFixture);
  render(<OverviewPage />);
  await waitFor(() => screen.getByText(/No activity recorded yet/));
});

test("shows confidence-free config status -- learning/redundancy shown as OFF, never merged with a numeric confidence value", async () => {
  vi.spyOn(api, "getOverview").mockResolvedValue(overviewFixture);
  render(<OverviewPage />);
  await waitFor(() => screen.getByText(/Learning: OFF/));
  expect(screen.getByText(/Redundancy: OFF/)).toBeTruthy();
});

test("renders workflow coverage as count + percent of tasks tracked", async () => {
  vi.spyOn(api, "getOverview").mockResolvedValue(overviewFixture);
  render(<OverviewPage />);
  await waitFor(() => screen.getByText(String(overviewFixture.workflow.tasksTracked)));
  expect(screen.getByText("22 (91.7%)")).toBeTruthy();
  expect(screen.getByText("18 (81.8%)")).toBeTruthy();
  expect(screen.getByText("21 (95.5%)")).toBeTruthy();
});

test("shows workflow coverage as em dash, not a division-by-zero artifact, when no tasks are tracked", async () => {
  vi.spyOn(api, "getOverview").mockResolvedValue(emptyOverviewFixture);
  render(<OverviewPage />);
  await waitFor(() => screen.getAllByText("—"));
});

test("shows an error state when the fetch fails", async () => {
  vi.spyOn(api, "getOverview").mockRejectedValue(new Error("network down"));
  render(<OverviewPage />);
  const el = await waitFor(() => screen.getByText(/failed to load overview/));
  expect(el.className).toContain("empty-state-error");
});

test("shows section headers immediately and skeleton placeholders while loading, announced to screen readers", () => {
  vi.spyOn(api, "getOverview").mockResolvedValue(overviewFixture);
  const { container } = render(<OverviewPage />);
  expect(screen.getByText("Memories")).toBeTruthy();
  expect(screen.getByText("Recent Activity")).toBeTruthy();
  expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  expect(screen.getByRole("status").textContent).toMatch(/loading/i);
});

test("skeleton placeholders are gone once data resolves", async () => {
  vi.spyOn(api, "getOverview").mockResolvedValue(overviewFixture);
  const { container } = render(<OverviewPage />);
  await waitFor(() => screen.getByText(String(overviewFixture.memories.total)));
  expect(container.querySelectorAll(".skeleton").length).toBe(0);
});
