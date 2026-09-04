// Seed data only. This file provides the initial values that clients,
// inventory, and the activity log fall back to when localStorage is empty —
// it is loaded through the services, not imported by components directly.
//
// ROLE_OPTIONS and clientClassificationOptions used to live here too; they
// are now in src/utils/constants.js so there is one source of truth rather
// than two lists that can drift apart.
//
// Admin/Staff/Technician accounts live in Supabase (see supabase/schema.sql),
// not here — userService fetches them.

export const mockAppointments = [
  {
    id: 1,
    clientName: "Bahay ng Baryo Homes",
    address: "Blk 11, Lot 5, Marfori, Davao City",
    clientType: "Residential (Home, Apartment)",
    pestType: "Termites",
    status: "Pending",
    date: "2026-08-19",
    time: "09:00 AM",
    technician: "Jules Panganiban",
    contactNumber: "09171234567",
    notes: "Client reported mud tubes along the kitchen wall.",
  },
  {
    id: 2,
    clientName: "Golden Harvest Foods",
    address: "Puan, Davao City",
    clientType: "Commercial (Shop, Storefront)",
    pestType: "Rodents",
    status: "Completed",
    date: "2026-08-12",
    time: "01:30 PM",
    technician: "Jules Panganiban",
    contactNumber: "09281234567",
    notes: "Food storage units treated and risk audit completed.",
  },
  {
    id: 3,
    clientName: "Arawan Logistics Center",
    address: "Km. 9, Panacan, Davao City",
    clientType: "Warehouse / Storage",
    pestType: "Cockroaches",
    status: "In Progress",
    date: "2026-08-15",
    time: "08:00 AM",
    technician: "Jules Panganiban",
    contactNumber: "09351234567",
    notes: "Monitoring entry points in warehouse docks.",
  },
  {
    id: 4,
    clientName: "Davao Garden Villas",
    address: "Bajada, Davao City",
    clientType: "Hospitality (Hotel, Resort)",
    pestType: "Bed Bugs",
    status: "Pending",
    date: "2026-08-23",
    time: "10:45 AM",
    technician: "Jules Panganiban",
    contactNumber: "09451234567",
    notes: "Inspection for guest room complaint.",
  },
];

// initialClients moved to supabase/migrations/002-seed-clients.sql —
// client profiles are Postgres rows now, so their seed data lives in SQL.

// initialInventory moved to supabase/migrations/004-seed-inventory.sql —
// inventory is a Postgres table now, so its seed data lives in SQL.

export const initialSystemLogs = [
  { id: "log-1", actor: "Maya Torres", message: "Updated role assignment for Anne Basa.", timestamp: "2026-08-18T08:10:00.000Z", type: "admin" },
  { id: "log-2", actor: "Ren Villanueva", message: "Uploaded inspection report for Bahay ng Baryo Homes.", timestamp: "2026-08-17T13:40:00.000Z", type: "document" },
  { id: "log-3", actor: "Jules Panganiban", message: "Completed rodent control for Golden Harvest Foods.", timestamp: "2026-08-16T16:30:00.000Z", type: "service" },
  { id: "log-4", actor: "System", message: "Inventory alert: Rodent Bait Blocks low on stock.", timestamp: "2026-08-15T09:25:00.000Z", type: "inventory" },
];
