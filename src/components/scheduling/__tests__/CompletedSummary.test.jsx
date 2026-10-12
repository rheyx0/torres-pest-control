import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CompletedSummary from "../CompletedSummary";

jest.mock("../../../hooks/useAuth", () => () => ({ currentUser: { role: "STAFF" }, can: () => true }));
jest.mock("../../../hooks/useBilling", () => ({ useOptionalBilling: () => ({ office: true, available: true }) }));

const services = [{ id: "s1", name: "Inspection" }, { id: "s2", name: "Termite Soil Treatment" }];
const inspection = {
  id: "a1", clientId: "c1", status: "Completed", scheduledAt: "2026-10-12T09:00:00", serviceType: "Inspection",
  inspectionAreaSqm: 120, recommendedServiceIds: ["s2"], stockUsed: [],
};

const renderSummary = (appointment, visitServices = [services[0]]) => render(
  <MemoryRouter><CompletedSummary appointment={appointment} visitServices={visitServices} services={services} onCorrect={jest.fn()} /></MemoryRouter>
);

test("a completed inspection shows its results and Create quote from inspection", () => {
  renderSummary(inspection);
  expect(screen.getByText("120 sqm")).toBeInTheDocument();
  expect(screen.getByText("Termite Soil Treatment")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Create quote from inspection/ })).toBeInTheDocument();
});

test("no quote button on an inspection without results, or on another visit", () => {
  const { unmount } = renderSummary({ ...inspection, inspectionAreaSqm: null, recommendedServiceIds: [] });
  expect(screen.queryByRole("button", { name: /Create quote from inspection/ })).not.toBeInTheDocument();
  unmount();
  renderSummary({ ...inspection, serviceType: "General Pest Control", inspectionAreaSqm: null, recommendedServiceIds: [] }, [{ id: "s3", name: "General Pest Control" }]);
  expect(screen.queryByText("Area inspected")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Create quote from inspection/ })).not.toBeInTheDocument();
});
