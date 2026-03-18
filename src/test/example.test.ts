import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

import { ProtectedRoute } from "@/components/shared/ProtectedRoute";
import { RootRedirect } from "@/components/shared/RootRedirect";

function renderProtected(allowedRoles: string[], initialRoute = "/test") {
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

function renderRootRedirect() {
  return render(
    createElement(MemoryRouter, { initialEntries: ["/"] },
      createElement(Routes, null,
        createElement(Route, { path: "/", element: createElement(RootRedirect) }),
        createElement(Route, { path: "/login", element: createElement("div", null, "Login Page") }),
        createElement(Route, { path: "/admin", element: createElement("div", null, "Admin Page") }),
        createElement(Route, { path: "/sprzedawca", element: createElement("div", null, "Sprzedawca Page") }),
      )
    )
  );
}

const baseAuth = (overrides: any = {}) => ({
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
    renderProtected(["admin"]);
    expect(screen.getByText("Ładowanie…")).toBeInTheDocument();
  });

  it("redirects to /login when no user", () => {
    mockUseAuth.mockReturnValue(baseAuth());
    renderProtected(["admin"]);
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("redirects to /login when roles are empty", () => {
    mockUseAuth.mockReturnValue(baseAuth({
      user: { id: "123" },
      profile: { id: "123", full_name: "Test", roles: [], branch: null },
    }));
    renderProtected(["admin"]);
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("renders children when user has allowed role", () => {
    mockUseAuth.mockReturnValue(baseAuth({
      user: { id: "123" },
      profile: { id: "123", full_name: "Test", roles: ["admin"], branch: null },
      roles: ["admin"],
      primaryRole: "admin",
    }));
    renderProtected(["admin"]);
    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  it("redirects to primaryRole route when role not allowed", () => {
    mockUseAuth.mockReturnValue(baseAuth({
      user: { id: "123" },
      profile: { id: "123", full_name: "Test", roles: ["sprzedawca"], branch: null },
      roles: ["sprzedawca"],
      primaryRole: "sprzedawca",
    }));
    renderProtected(["admin"]);
    expect(screen.getByText("Sprzedawca Page")).toBeInTheDocument();
  });
});

describe("RootRedirect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to /login when not authenticated", () => {
    mockUseAuth.mockReturnValue(baseAuth());
    renderRootRedirect();
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("redirects to /login when no roles", () => {
    mockUseAuth.mockReturnValue(baseAuth({ user: { id: "1" } }));
    renderRootRedirect();
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("redirects to admin when primaryRole is admin", () => {
    mockUseAuth.mockReturnValue(baseAuth({
      user: { id: "1" }, roles: ["admin"], primaryRole: "admin",
    }));
    renderRootRedirect();
    expect(screen.getByText("Admin Page")).toBeInTheDocument();
  });

  it("shows loading screen while loading", () => {
    mockUseAuth.mockReturnValue(baseAuth({ loading: true }));
    renderRootRedirect();
    expect(screen.getByText("Ładowanie…")).toBeInTheDocument();
  });
});
