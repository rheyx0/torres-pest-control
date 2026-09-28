// Service catalog (migration 047). Same shape as the other providers:
// Supabase-backed, async mutators that resolve to `true` or an error string.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as serviceCatalogService from "../services/serviceCatalogService";
import { useAuthContext } from "./AuthContext";

const ServicesContext = createContext(null);

const byOrder = (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

export function ServicesProvider({ children }) {
  const { session, sessionVerified } = useAuthContext();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await serviceCatalogService.fetchServices();
    if (result.error) setError(result.error);
    else setServices(result.services);
    setLoading(false);
    return result;
  }, []);

  useEffect(() => {
    if (!session || !sessionVerified) {
      setServices([]);
      setError("");
      return;
    }
    refresh();
  }, [session, sessionVerified, refresh]);

  // A re-read row does not carry the payment-check exemption (066, read on its
  // own), so a replacement keeps the one it had unless it names its own.
  const replaceOne = (service) =>
    setServices((current) => {
      const previous = current.find((entry) => entry.id === service.id);
      const merged = { ...service, skipPaymentCheck: service.skipPaymentCheck ?? Boolean(previous?.skipPaymentCheck) };
      return [...current.filter((entry) => entry.id !== service.id), merged].sort(byOrder);
    });

  // Saves the row, then its materials list. The materials are written by
  // their own RPC, so the row is re-read afterwards to pick them up.
  const saveService = useCallback(async (id, { materials, skipPaymentCheck, ...fields }) => {
    const saved = id
      ? await serviceCatalogService.updateService(id, fields)
      : await serviceCatalogService.createService(fields);
    if (saved.error) return saved.error;

    if (materials) {
      const materialsResult = await serviceCatalogService.saveServiceMaterials(saved.service.id, materials);
      if (materialsResult.error) {
        replaceOne(saved.service);
        return `The service was saved, but its materials were not: ${materialsResult.error}`;
      }
    }
    // The payment-check exemption (066) is its own admin RPC.
    const previous = services.find((entry) => entry.id === saved.service.id);
    let exempt = Boolean(previous?.skipPaymentCheck);
    if (skipPaymentCheck !== undefined && Boolean(skipPaymentCheck) !== exempt) {
      const flag = await serviceCatalogService.setServicePaymentCheck(saved.service.id, skipPaymentCheck);
      if (flag.error) {
        replaceOne({ ...saved.service, skipPaymentCheck: exempt });
        return `The service was saved, but "Can be booked without payment" was not: ${flag.error}`;
      }
      exempt = Boolean(skipPaymentCheck);
    }
    // billingMode (060) is kept too: dropping it made every material read as
    // Included until a reload, so "Charge extra" never reached the invoice.
    replaceOne({
      ...saved.service,
      skipPaymentCheck: exempt,
      materials: materials
        ? materials.map((m) => ({ itemId: m.itemId, defaultAmount: Number(m.defaultAmount), billingMode: ["EXTRA_CHARGED", "CHARGE_ALL"].includes(m.billingMode) ? m.billingMode : "INCLUDED" }))
        : saved.service.materials,
    });
    return true;
  }, [services]);

  const setServiceActive = useCallback(async (id, isActive) => {
    const result = await serviceCatalogService.setServiceActive(id, isActive);
    if (result.error) return result.error;
    replaceOne(result.service);
    return true;
  }, []);

  const deleteService = useCallback(async (id) => {
    const result = await serviceCatalogService.deleteService(id);
    if (result.error) return result.error;
    setServices((current) => current.filter((entry) => entry.id !== id));
    return true;
  }, []);

  const value = useMemo(
    () => ({ services, loading, error, refresh, saveService, setServiceActive, deleteService }),
    [services, loading, error, refresh, saveService, setServiceActive, deleteService]
  );

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServicesContext() {
  const context = useContext(ServicesContext);
  if (!context) throw new Error("useServicesContext must be used inside ServicesProvider");
  return context;
}
