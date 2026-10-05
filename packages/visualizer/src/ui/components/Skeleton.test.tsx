import { test, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton, SkeletonLines } from "./Skeleton";

test("renders a sized, decorative skeleton block", () => {
  const { container } = render(<Skeleton width={120} height={16} />);
  const el = container.querySelector(".skeleton");
  expect(el).toBeTruthy();
  expect(el?.getAttribute("aria-hidden")).toBe("true");
  expect((el as HTMLElement).style.width).toBe("120px");
  expect((el as HTMLElement).style.height).toBe("16px");
});

test("SkeletonLines renders `count` stacked blocks, last one shorter", () => {
  const { container } = render(<SkeletonLines count={4} />);
  const blocks = container.querySelectorAll(".skeleton");
  expect(blocks.length).toBe(4);
  expect((blocks[3] as HTMLElement).style.width).toBe("60%");
});
