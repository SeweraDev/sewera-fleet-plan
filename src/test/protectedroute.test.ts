import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

import { ProtectedRoute } from "@/components/shared/ProtectedRoute";

function renderWithRouter(allowedRoles: string[], initialRoute = "/test") {
  return render(
    createElement(MemoryRouter, { initialEntries: [initialRoute] },
      createElement(Routes, null,
        createElement(Route, { path: "/login", element: createElement("div", null, "Login Page") }),
        createElement(Route, { path: "/admin", element: createElement("div", null, "Admin Page") }),
        createElement(Route, { path: "/sprzedawca", element: createElement("div", null, "Sprzedawca Page") }),
        createElement(Route, {
          path: "/test",
          element: createElement(ProtectedRoute, { allowedRoles: allowedRoles as any },
            createElement("div", null, "Protected Content")
          ),
        }),
      )
    )
  );
}

const baseAuth = (overrides: any) => ({
  user: null,
  profile: null,
  roles: [],
  primaryRole: "",
  loading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  ...overrides,
});

describe("ProtectedRoute", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows loading screen when loading", () => {
    mockUseAuth.mockReturnValue(baseAuth({ loading: true }));
    renderWithRouter(["admin"]);
    expect(screen.getByText("Ładowanie…")).toBeInTheDocument();
  });

  it("redirects to /login when no user", () => {
    mockUseAuth.mockReturnValue(baseAuth({}));
    renderWithRouter(["admin"]);
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("redirects to /login when roles are empty", () => {
    mockUseAuth.mockReturnValue(baseAuth({
      user: { id: "123" },
      profile: { id: "123", full_name: "Test", roles: [], branch: null },
    }));
    renderWithRouter(["admin"]);
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("renders children when user has allowed role", () => {
    mockUseAuth.mockReturnValue(baseAuth({
      user: { id: "123" },
      profile: { id: "123", full_name: "Test", roles: ["admin"], branch: null },
      roles: ["admin"],
      primaryRole: "admin",
    }));
    renderWithRouter(["admin"]);
    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  it("redirects to primaryRole route when role not allowed", () => {
    mockUseAuth.mockReturnValue(baseAuth({
      user: { id: "123" },
      profile: { id: "123", full_name: "Test", roles: ["sprzedawca"], branch: null },
      roles: ["sprzedawca"],
      primaryRole: "sprzedawca",
    }));
    renderWithRouter(["admin"]);
    expect(screen.getByText("Sprzedawca Page")).toBeInTheDocument();
  });
});
