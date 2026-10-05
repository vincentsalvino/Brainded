import { test, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { api } from "../api-client";
import { ContextListPage } from "./ContextListPage";
import { contextListFixture, emptyContextListFixture } from "../fixtures/contexts.fixture";

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders one row per context delivery", async () => {
  vi.spyOn(api, "listContexts").mockResolvedValue(contextListFixture);
  render(<ContextListPage onSelect={() => {}} />);
  await waitFor(() => screen.getByText("task-42"));
  expect(screen.getByText(/no task id/)).toBeTruthy();
});

test("clicking a row calls onSelect with that context's id", async () => {
  vi.spyOn(api, "listContexts").mockResolvedValue(contextListFixture);
  const onSelect = vi.fn();
  render(<ContextListPage onSelect={onSelect} />);
  const row = await waitFor(() => screen.getByText("task-42"));
  fireEvent.click(row);
  expect(onSelect).toHaveBeenCalledWith("ctx-1");
});

test("shows an empty state when there are no context deliveries", async () => {
  vi.spyOn(api, "listContexts").mockResolvedValue(emptyContextListFixture);
  render(<ContextListPage onSelect={() => {}} />);
  await waitFor(() => screen.getByText(/No context deliveries recorded yet/));
});

test("shows an error state when the fetch fails", async () => {
  vi.spyOn(api, "listContexts").mockRejectedValue(new Error("network down"));
  render(<ContextListPage onSelect={() => {}} />);
  const el = await waitFor(() => screen.getByText(/failed to load contexts/));
  expect(el.className).toContain("empty-state-error");
});

test("shows the header immediately and skeleton placeholders while loading, announced to screen readers", () => {
  vi.spyOn(api, "listContexts").mockResolvedValue(contextListFixture);
  const { container } = render(<ContextListPage onSelect={() => {}} />);
  expect(screen.getByText("Context Deliveries")).toBeTruthy();
  expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  expect(screen.getByRole("status").textContent).toMatch(/loading/i);
});
