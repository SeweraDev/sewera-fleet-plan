import { describe, it, expect } from "vitest";
import { ROLE_ROUTES, ROLE_LABELS } from "@/types";
import type { UserRole } from "@/types";

describe("Auth types and routing", () => {
  it("ROLE_ROUTES maps all 5 roles to correct paths", () => {
    expect(ROLE_ROUTES.admin).toBe("/admin");
    expect(ROLE_ROUTES.zarzad).toBe("/zarzad");
    expect(ROLE_ROUTES.dyspozytor).toBe("/dyspozytor");
    expect(ROLE_ROUTES.sprzedawca).toBe("/sprzedawca");
    expect(ROLE_ROUTES.kierowca).toBe("/kierowca");
  });

  it("ROLE_ROUTES has exactly 5 entries", () => {
    expect(Object.keys(ROLE_ROUTES)).toHaveLength(5);
  });

  it("ROLE_LABELS has Polish labels for all roles", () => {
    expect(ROLE_LABELS.admin).toBe("Administrator");
    expect(ROLE_LABELS.zarzad).toBe("Zarząd");
    expect(ROLE_LABELS.dyspozytor).toBe("Dyspozytor");
    expect(ROLE_LABELS.sprzedawca).toBe("Sprzedawca");
    expect(ROLE_LABELS.kierowca).toBe("Kierowca");
  });

  it("all ROLE_ROUTES keys have matching ROLE_LABELS", () => {
    const routeKeys = Object.keys(ROLE_ROUTES);
    const labelKeys = Object.keys(ROLE_LABELS);
    expect(routeKeys.sort()).toEqual(labelKeys.sort());
  });
});

describe("Auth logic - primaryRole selection", () => {
  it("selects first role as primaryRole", () => {
    const roles: UserRole[] = ["sprzedawca", "admin"];
    const primaryRole = roles[0] ?? "";
    expect(primaryRole).toBe("sprzedawca");
  });

  it("returns empty string when no roles", () => {
    const roles: UserRole[] = [];
    const primaryRole = roles[0] ?? "";
    expect(primaryRole).toBe("");
  });

  it("correctly determines route from primaryRole", () => {
    const roles: UserRole[] = ["admin"];
    const primaryRole = roles[0] as UserRole;
    expect(ROLE_ROUTES[primaryRole]).toBe("/admin");
  });
});

describe("Auth logic - role matching", () => {
  it("allowedRoles check works for matching role", () => {
    const userRoles: UserRole[] = ["dyspozytor"];
    const allowedRoles: UserRole[] = ["dyspozytor", "admin"];
    const hasRole = userRoles.some((r) => allowedRoles.includes(r));
    expect(hasRole).toBe(true);
  });

  it("allowedRoles check fails for non-matching role", () => {
    const userRoles: UserRole[] = ["kierowca"];
    const allowedRoles: UserRole[] = ["dyspozytor", "admin"];
    const hasRole = userRoles.some((r) => allowedRoles.includes(r));
    expect(hasRole).toBe(false);
  });

  it("allowedRoles check works with multiple user roles", () => {
    const userRoles: UserRole[] = ["sprzedawca", "admin"];
    const allowedRoles: UserRole[] = ["admin"];
    const hasRole = userRoles.some((r) => allowedRoles.includes(r));
    expect(hasRole).toBe(true);
  });

  it("empty roles never matches", () => {
    const userRoles: UserRole[] = [];
    const allowedRoles: UserRole[] = ["admin"];
    const hasRole = userRoles.some((r) => allowedRoles.includes(r));
    expect(hasRole).toBe(false);
  });
});
