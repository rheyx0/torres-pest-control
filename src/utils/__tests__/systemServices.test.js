// Migration 084: the built-in services are found by their tag, not their name.
import { findSystemService, servicePlays } from "../systemServices";
import { findFollowUpService, isInspectionVisit } from "../sprint4";

test("found by the tag, whatever the name", () => {
  const services = [
    { id: "a", name: "Site Monitoring", systemKey: "CHECKUP", isActive: true },
    { id: "b", name: "Follow-up Visit (old)", isActive: true },
    { id: "c", name: "Return Visit", systemKey: "FOLLOW_UP", isActive: true },
  ];
  expect(findSystemService(services, "CHECKUP").id).toBe("a");
  expect(findFollowUpService(services).id).toBe("c");
  expect(servicePlays(services[1], "FOLLOW_UP", services)).toBe(false); // untagged once tags exist
});

test("before 084 (no tags at all) the name still works", () => {
  const services = [{ id: "x", name: "Follow-up Visit", isActive: true }, { id: "y", name: "Checkup", isActive: true }];
  expect(findFollowUpService(services).id).toBe("x");
  expect(findSystemService(services, "CHECKUP").id).toBe("y");
});

test("an inspection visit is known by the built-in Inspection service", () => {
  expect(isInspectionVisit({ serviceType: "Site Survey" }, [{ name: "Site Survey", systemKey: "INSPECTION" }])).toBe(true);
  expect(isInspectionVisit({ serviceType: "Termite" }, [{ name: "Termite" }])).toBe(false);
});
