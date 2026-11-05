import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

test("renders full labels and calls onSelect with the clicked section", () => {
  const onSelect = vi.fn();
  render(<Sidebar active="map" onSelect={onSelect} />);
  expect(screen.getByText("Map")).toBeTruthy();
  expect(screen.getByText("Contexts")).toBeTruthy();
  fireEvent.click(screen.getByText("Overview"));
  expect(onSelect).toHaveBeenCalledWith("overview");
});

test("the sidebar edge snaps in either direction with the keyboard and keeps navigation accessible", () => {
  render(<Sidebar active="map" onSelect={() => {}} />);
  const edge = screen.getByRole("separator", { name: "Resize navigation sidebar" });
  const link = screen.getByRole("button", { name: "Map" });
  fireEvent.keyDown(edge, { key: "ArrowLeft" });
  expect(edge.getAttribute("aria-valuetext")).toBe("Collapsed");
  expect(link.getAttribute("title")).toBe("Map");
  fireEvent.keyDown(edge, { key: "ArrowRight" });
  expect(edge.getAttribute("aria-valuetext")).toBe("Expanded");
  expect(link.getAttribute("title")).toBeNull();
});
