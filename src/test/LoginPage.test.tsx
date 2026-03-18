import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockSignIn = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

import LoginPage from "@/pages/LoginPage";

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <LoginPage />
    </MemoryRouter>
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: null,
      profile: null,
      roles: [],
      primaryRole: "",
      loading: false,
      signIn: mockSignIn,
      signOut: vi.fn(),
    });
  });

  it("renders login form", () => {
    renderLoginPage();
    expect(screen.getByText("🚛 TRANSPORT SEWERA")).toBeInTheDocument();
    expect(screen.getByText("Zaloguj się do systemu")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("nazwisko.imie@sewera.pl")).toBeInTheDocument();
    expect(screen.getByText("Zaloguj się")).toBeInTheDocument();
  });

  it("shows error on invalid credentials", async () => {
    mockSignIn.mockRejectedValueOnce(new Error("Invalid login credentials"));

    renderLoginPage();

    fireEvent.change(screen.getByPlaceholderText("nazwisko.imie@sewera.pl"), {
      target: { value: "bad@test.pl" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByText("Zaloguj się"));

    await waitFor(() => {
      expect(screen.getByText("Nieprawidłowy email lub hasło")).toBeInTheDocument();
    });
  });

  it("shows no-roles message when NO_ROLES error", async () => {
    mockSignIn.mockRejectedValueOnce(new Error("NO_ROLES"));

    renderLoginPage();

    fireEvent.change(screen.getByPlaceholderText("nazwisko.imie@sewera.pl"), {
      target: { value: "user@test.pl" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "pass123" },
    });
    fireEvent.click(screen.getByText("Zaloguj się"));

    await waitFor(() => {
      expect(
        screen.getByText("Brak uprawnień — skontaktuj się z administratorem")
      ).toBeInTheDocument();
    });
  });

  it("disables button during login", async () => {
    mockSignIn.mockImplementation(() => new Promise(() => {})); // never resolves

    renderLoginPage();

    fireEvent.change(screen.getByPlaceholderText("nazwisko.imie@sewera.pl"), {
      target: { value: "user@test.pl" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "pass123" },
    });
    fireEvent.click(screen.getByText("Zaloguj się"));

    await waitFor(() => {
      expect(screen.getByText("Logowanie...")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Logowanie..." })).toBeDisabled();
    });
  });
});
