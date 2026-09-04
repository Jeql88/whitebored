// Vitest global setup for the client workspace. Registers @testing-library/jest-dom
// matchers (toBeInTheDocument, toBeDisabled, …) and auto-cleans the rendered DOM
// between tests so component tests stay isolated.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
