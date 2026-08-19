import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("renders the Chinese label for a status", () => {
    render(<StatusBadge status="RESEARCH_APPROVED" />);
    expect(screen.getByText("研究已完成")).toBeInTheDocument();
  });
});
