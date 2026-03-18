import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

import { RootRedirect } from "@/components/shared/RootRedirect";

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/admin" element={<div>Admin Page</div>} />
        <Route path="/sprzedawca" element={<div>Sprzedawca Page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("RootRedirect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to /login when not authenticated", () => {
    mockUseAuth.mockReturnValue({
      user: null, roles: [], primaryRole: "", loading: false,
    });
    renderWithRouter();
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("redirects to /login when no roles", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "1" }, roles: [], primaryRole: "", loading: false,
    });
    renderWithRouter();
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("redirects to admin when primaryRole is admin", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "1" }, roles: ["admin"], primaryRole: "admin", loading: false,
    });
    renderWithRouter();
    expect(screen.getByText("Admin Page")).toBeInTheDocument();
  });

  it("redirects to sprzedawca when primaryRole is sprzedawca", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "1" }, roles: ["sprzedawca"], primaryRole: "sprzedawca", loading: false,
    });
    renderWithRouter();
    expect(screen.getByText("Sprzedawca Page")).toBeInTheDocument();
  });

  it("shows loading screen while loading", () => {
    mockUseAuth.mockReturnValue({
      user: null, roles: [], primaryRole: "", loading: true,
    });
    renderWithRouter();
    expect(screen.getByText("Ładowanie…")).toBeInTheDocument();
  });
});
