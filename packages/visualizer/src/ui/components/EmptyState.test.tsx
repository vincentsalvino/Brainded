import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

test("defaults to the neutral empty tone", () => {
  render(<EmptyState message="Nothing here yet." />);
  expect(screen.getByText("Nothing here yet.").className).toBe("empty-state");
});

test("error tone adds the error class without changing the message", () => {
  render(<EmptyState message="failed to load overview: network down" tone="error" />);
  const el = screen.getByText(/failed to load overview/);
  expect(el.className).toBe("empty-state empty-state-error");
});
