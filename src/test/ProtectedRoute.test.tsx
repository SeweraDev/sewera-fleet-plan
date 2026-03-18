import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Mock useAuth before importing ProtectedRoute
const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

import { ProtectedRoute } from "@/components/shared/ProtectedRoute";

function renderWithRouter(allowedRoles: string[], initialRoute = "/test") {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/admin" element={<div>Admin Page</div>} />
        <Route path="/sprzedawca" element={<div>Sprzedawca Page</div>} />
        <Route
          path="/test"
          element={
            <ProtectedRoute allowedRoles={allowedRoles as any}>
              <div>Protected Content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading screen when loading", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      profile: null,
      roles: [],
      primaryRole: "",
      loading: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    renderWithRouter(["admin"]);
    expect(screen.getByText("Ładowanie…")).toBeInTheDocument();
  });

  it("redirects to /login when no user", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      profile: null,
      roles: [],
      primaryRole: "",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    renderWithRouter(["admin"]);
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("redirects to /login when roles are empty", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "123" },
      profile: { id: "123", full_name: "Test", roles: [], branch: null },
      roles: [],
      primaryRole: "",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    renderWithRouter(["admin"]);
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("renders children when user has allowed role", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "123" },
      profile: { id: "123", full_name: "Test", roles: ["admin"], branch: null },
      roles: ["admin"],
      primaryRole: "admin",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    renderWithRouter(["admin"]);
    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  it("redirects to primaryRole route when role not allowed", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "123" },
      profile: { id: "123", full_name: "Test", roles: ["sprzedawca"], branch: null },
      roles: ["sprzedawca"],
      primaryRole: "sprzedawca",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    renderWithRouter(["admin"]);
    expect(screen.getByText("Sprzedawca Page")).toBeInTheDocument();
  });
});
