import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

test("renders full labels and calls onSelect with the clicked section", () => {
  const onSelect = vi.fn();
  render(<Sidebar active="map" onSelect={onSelect} collapsed={false} onToggleCollapsed={() => {}} />);
  expect(screen.getByText("Brain")).toBeTruthy();
  expect(screen.getByText("Contexts")).toBeTruthy();
  fireEvent.click(screen.getByText("Overview"));
  expect(onSelect).toHaveBeenCalledWith("overview");
});

test("collapsed: labels shrink to one letter, full name moves to a title tooltip", () => {
  render(<Sidebar active="map" onSelect={() => {}} collapsed={true} onToggleCollapsed={() => {}} />);
  expect(screen.queryByText("Brain")).toBeNull();
  const link = screen.getByText("B");
  expect(link.getAttribute("title")).toBe("Brain");
});

test("toggle button calls onToggleCollapsed and reflects the current state", () => {
  const onToggleCollapsed = vi.fn();
  const { rerender } = render(
    <Sidebar active="map" onSelect={() => {}} collapsed={false} onToggleCollapsed={onToggleCollapsed} />,
  );
  fireEvent.click(screen.getByLabelText("Collapse sidebar"));
  expect(onToggleCollapsed).toHaveBeenCalledOnce();

  rerender(<Sidebar active="map" onSelect={() => {}} collapsed={true} onToggleCollapsed={onToggleCollapsed} />);
  expect(screen.getByLabelText("Expand sidebar")).toBeTruthy();
});
