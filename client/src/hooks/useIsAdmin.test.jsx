import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { apiFetch } from "../api/config";
import { useIsAdmin, __resetAdminCache } from "./useIsAdmin";

vi.mock("../api/config", () => ({ apiFetch: vi.fn() }));

function Probe() {
  const { isAdmin, checked } = useIsAdmin();
  return <span>{checked ? (isAdmin ? "admin" : "not admin") : "checking"}</span>;
}

beforeEach(() => {
  __resetAdminCache();
  apiFetch.mockReset();
});

afterEach(() => {
  __resetAdminCache();
});

describe("useIsAdmin", () => {
  it("asks the server once, however many components use it", async () => {
    // The hook used to re-check on every mount, so an ordinary user logged a 403
    // on each navigation — console noise that buried real errors.
    apiFetch.mockResolvedValue({ ok: true });

    render(
      <>
        <Probe />
        <Probe />
        <Probe />
      </>
    );

    await waitFor(() => expect(screen.getAllByText("admin")).toHaveLength(3));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not ask again on a later mount", async () => {
    apiFetch.mockResolvedValue({ ok: true });

    const first = render(<Probe />);
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());
    first.unmount();

    render(<Probe />);
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("treats a rejected check as 'not an admin' rather than an error", async () => {
    // 403 is the expected answer for a normal user, not a failure.
    apiFetch.mockRejectedValue(new Error("403"));

    render(<Probe />);

    await waitFor(() => expect(screen.getByText("not admin")).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not sign the user out when the probe is unauthorized", async () => {
    apiFetch.mockResolvedValue({ ok: false });

    render(<Probe />);
    await waitFor(() => expect(screen.getByText("not admin")).toBeInTheDocument());

    // auth:false keeps a 401 on this probe from triggering the session-expired
    // redirect — a guest is not logged out for failing an admin check.
    expect(apiFetch).toHaveBeenCalledWith("/api/admin/me", { auth: false });
  });
});
