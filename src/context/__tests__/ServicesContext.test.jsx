import { act, render, screen, waitFor } from "@testing-library/react";
import { ServicesProvider, useServicesContext } from "../ServicesContext";
import * as serviceCatalogService from "../../services/serviceCatalogService";

const mockAuth = { session: { token: "t" }, sessionVerified: true, currentUser: { name: "Admin", role: "ADMIN" } };
jest.mock("../AuthContext", () => ({ useAuthContext: () => mockAuth }));
jest.mock("../../services/serviceCatalogService");
jest.mock("../../services/logService", () => ({ addLog: jest.fn(), LOG_TYPES: {} }));

const service = { id: "s1", name: "Termite Control", materials: [] };

beforeEach(() => {
  serviceCatalogService.fetchServices.mockResolvedValue({ services: [service], error: null });
  serviceCatalogService.updateService.mockResolvedValue({ service, error: null });
  serviceCatalogService.createService.mockResolvedValue({ service, error: null });
  serviceCatalogService.saveServiceMaterials.mockResolvedValue({ error: null });
});

let context;
function Probe() {
  context = useServicesContext();
  const material = context.services[0]?.materials?.[0];
  return <p>{material ? `mode=${material.billingMode}` : "none"}</p>;
}

// Regression: saving kept only item and quantity, so "Charge extra" read as
// Included until a reload and never reached the invoice.
test("saving a service keeps each material's Charge extra setting", async () => {
  render(<ServicesProvider><Probe /></ServicesProvider>);
  await waitFor(() => expect(screen.getByText("none")).toBeInTheDocument());
  await act(async () => {
    await context.saveService("s1", { name: "Termite Control", materials: [{ itemId: "i1", defaultAmount: 1, billingMode: "EXTRA_CHARGED" }] });
  });
  expect(screen.getByText("mode=EXTRA_CHARGED")).toBeInTheDocument();
});
