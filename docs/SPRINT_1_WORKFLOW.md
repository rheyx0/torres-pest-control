# Torres Pest Control System — Sprint 1 Workflow Documentation

## 1. Purpose and Sprint 1 scope

This document describes the workflow that is currently implemented in the Torres Pest Control System. The system supports the early operational work of a pest-control business: secure sign-in, staff access management, client records and supporting documents, and control of chemicals, equipment, and consumable materials.

Sprint 1 does **not** yet implement appointment scheduling, technician dispatch, service reports, quotations/invoices, payments, pest-treatment usage deductions, or live business analytics. The dashboard shows the intended appointment and business-performance areas, but its appointment data is currently empty. Staff should therefore use the completed Sprint 1 modules as the source of truth for accounts, client profiles, files, and stock-in records.

## 2. System workflow at a glance

```text
Sign in
  → role is identified
  → permitted dashboard/navigation is shown
  → user works only in allowed modules

Client workflow
  → search for an existing client
  → create a profile if needed
  → record contact, site type, source, and pest concern
  → view or update the profile when permitted
  → upload/view/download supporting documents

Inventory workflow
  → create an item profile at zero stock
  → record each delivery using Stock In
  → system increases quantity and writes a movement record together
  → monitor low-stock indicator
  → disable obsolete/unavailable items without erasing history
```

## 3. Roles and access

All three roles can sign in, use the dashboard, view their own profile, change their own password in Settings, and log out. The sidebar hides modules a role cannot view, and protected routes block navigation to restricted pages in the normal application interface.

| Module / action | Administrator | Staff | Technician |
|---|---:|---:|---:|
| Dashboard | View | View | View |
| Own profile and password | View/edit | View/edit | View/edit |
| Settings | View | View | View |
| User accounts | View, create, edit, deactivate/reactivate, reset passwords | No access | No access |
| Client profiles | View, create, edit, delete | View, create, edit; no delete | View only |
| Client documents | View, upload, delete | View, upload, delete | View, upload; no delete |
| Inventory | View, create, edit, delete, stock in, enable/disable, view history | View only | View only |
| System activity logs | View | No access | No access |

### 3.1 Administrator workflow

Administrators manage the system. They create staff and technician accounts, maintain account details, reset passwords, and mark accounts active or inactive. The system prevents deactivation of the last active administrator so that the business is not locked out of administration.

Administrators can create and maintain client profiles and client documents. They also have full inventory access: create item profiles, maintain profile information, record deliveries through Stock In, inspect stock history, and enable or disable an item. Deletion is available in the permission matrix, but items with movement history are protected by the database relationship and should be disabled instead to preserve the audit trail.

### 3.2 Staff workflow

Staff are the front-office and client-record role. They can search the client list, create client profiles, update client information, and upload or remove client documents. This supports intake of new residential or commercial pest-control inquiries and maintenance of the records used by the business.

Staff can view inventory so they can check whether common treatments, materials, or equipment are available. They cannot create, edit, stock in, disable, or delete inventory items. They cannot view or manage accounts, and cannot access activity logs.

### 3.3 Technician workflow

Technicians have the most limited operational access. They can view clients and inventory and upload documents to a client record, for example a site photo, signed form, inspection attachment, or treatment-related file. They cannot create or edit client profiles, delete documents, change stock, maintain inventory items, or access user accounts and logs.

This supports field visibility while limiting changes to customer records and stock control to the appropriate office/management roles.

## 4. Authentication and account management

### 4.1 Sign-in and session flow

1. The user enters email and password on the login page.
2. The system validates the credentials and loads the corresponding account profile.
3. A session is saved in the browser and the application loads the user’s permitted navigation.
4. The user may update their own name and email from **My Profile**. Role and account status are read-only on that page.
5. In **Settings**, the user must provide their current password before choosing a new password.
6. Logging out clears the local session and client state from the active application view.

### 4.2 Account creation and controls

Only administrators create accounts. The create-account form contains:

| Field | Why it is included |
|---|---|
| Full Name | Identifies the person in the account list and activity messages. |
| Phone | Provides an internal contact method for the employee. |
| Email | Is the sign-in username and contact address. It is validated for format and checked for uniqueness across administrator, staff, and technician accounts. |
| Temporary Password | Gives the new user an initial credential. It must be at least six characters and include both a letter and a number. |
| Role | Assigns the fixed Sprint 1 permission set: Administrator, Staff, or Technician. |

Administrators can edit accounts, reset a user password, and toggle account status. Inactive accounts remain in the record for audit and continuity purposes; they are not silently removed.

## 5. Client profile workflow

### 5.1 Create and search

1. A permitted user opens **Client Profiles**.
2. They search by client name, phone, email, address, classification, or pest concern, and may filter by classification.
3. If the client does not exist, an administrator or staff member selects **Create Client Profile**.
4. The form validates required information before save: client name, address, and at least one contact method (phone or email). Email, if supplied, must be valid.
5. On successful save, the system opens the new client profile.

### 5.2 Client fields and business purpose

| Field | Why it is included for a pest-control service |
|---|---|
| Client Name | Identifies the customer, company, property manager, or account holder. |
| Email | Supports quotation, booking, follow-up, and documentation communication. |
| Phone | Provides a direct contact method for visit coordination and urgent pest concerns. At least phone or email is required. |
| Address | Identifies the treatment site and is required for pest-control work, site visits, route planning, and record accuracy. |
| Source | Records where the lead came from: Walk-in, Referral, Website Contact Form, Phone Call, Email, Facebook, Google Business Profile, or Other. This helps assess marketing and referral performance later. |
| Classification | Describes the site type: Residential, Commercial, Hospitality, Warehouse/Storage, Industrial, Agricultural, Educational, Medical Facility, Government Office, Religious Institution, Military Facility, Science Laboratory, Dock/Port Facility, Boat/Ship/Vessel, Vacant Lot, or Other. Pest risk, site rules, treatment method, documentation, and future pricing differ by property type. |
| Classification Other | Required when Classification is Other, so the unlisted site type is not lost. |
| Pest Concern | Records the primary issue, such as termites, rodents, cockroaches, bed bugs, ants, mosquitoes, flies, fleas/ticks, snakes, birds, or general pest control. It helps staff locate similar cases and will support future service planning. |
| Status | Stored as Active or Archived. The current Sprint 1 client form does not expose a status-control workflow, but the field preserves the ability to retain inactive client records rather than deleting them. |
| Created At / Updated At | Automatic timestamps that show when the record was created and last changed. |

### 5.3 Client documents

From an existing client profile, permitted users can work with attached documents.

- Allowed formats: PDF, DOC, DOCX, JPG, and PNG.
- Maximum upload size: 2 MB.
- Examples of useful documents: signed service agreement, site inspection photos, pest findings, treatment certificate, floor plan, customer authorization, or compliance document.
- Documents are held in a private Supabase Storage bucket. Preview/download links are generated only when requested and expire after 60 seconds.
- Administrators and staff can upload and remove files. Technicians can upload but cannot remove files.
- The system stores the original filename, MIME type, byte size, storage path, client association, and upload timestamp.

## 6. Inventory workflow

Inventory is designed for the materials a pest-control operation must control: treatment chemicals, reusable field equipment, and consumable or protective materials.

### 6.1 Core control principle

New items always start with a quantity of **0**. Quantity is not editable in the item form. Instead, an administrator records every incoming delivery through **Stock In**. Stock In writes a movement-history row and increases the item quantity in one database transaction. This prevents a displayed quantity from being changed without a matching history record.

Current Sprint 1 inventory tracks **stock received only**. It does not yet deduct chemicals/materials when used at a service, transfer inventory between locations, record returns, or support stock adjustment/stock-out workflows. Those should be added before inventory can represent full field consumption.

### 6.2 Inventory item types

| Type | What belongs in it | Why it is separate |
|---|---|---|
| Chemical | Insecticides, rodenticides, fumigants, and other treatment products. | Chemicals need safety, hazard, expiry, and receipt information that does not apply to tools or supplies. |
| Equipment | Sprayers, foggers, bait stations, ladders, traps, and other reusable assets. | Equipment needs asset identification, condition, and maintenance tracking rather than chemical expiry information. |
| Material | PPE, gloves, masks, packaging, baits, labels, accessories, and general supplies. | Consumables benefit from category and description, without unnecessary chemical or maintenance fields. |

### 6.3 Basic inventory fields

| Field | Why it is included |
|---|---|
| Item Name | Human-readable identification of the chemical, tool, or material. Required for selection, lookup, and stock history. |
| Type | Selects Chemical, Equipment, or Material and determines which type-specific fields apply. The type cannot be changed after creation, protecting the meaning of the item’s history. |
| Quantity | Current on-hand quantity. It starts at zero and can only increase through Stock In in Sprint 1. It is protected from direct edits so every change is traceable. |
| Unit | Specifies how quantity is measured, for example L, kg, pcs, bottles, boxes, or units. This gives quantity and reorder level a meaningful business unit. |
| Cost per Unit | Purchase cost of one unit. It supports the displayed total inventory value: quantity × unit cost. |
| Supplier | Identifies the source of the item for purchasing follow-up, reordering, quality investigation, or supplier comparison. |
| Storage Location | States where the item is held, for example Storage Room A, chemical cabinet, vehicle bay, or warehouse shelf. This improves safe retrieval and physical stock checks. |
| Reorder Level | The minimum acceptable quantity. When current quantity is at or below this value, the item is marked Low Stock, prompting replenishment before a treatment is delayed. |
| Status | Active or Disabled. Disabled retains the item and its history but blocks Stock In and removes it from normal day-to-day use until re-enabled. |
| Created At / Updated At | Automatic timestamps for record traceability and maintenance of the profile. |

### 6.4 Chemical fields

Chemical records show the basic fields plus the following:

| Field | Why it is included |
|---|---|
| Chemical Type | Categorizes the product as Insecticide, Fungicide, Rodenticide, Herbicide, Fumigant, or Other. This is important for treatment planning, safe handling, and reporting. |
| Expiration Date | Identifies products that must not be used after their approved shelf life. It helps prevent ineffective or unsafe treatment. |
| Safety Level | Stores the organization’s practical handling classification, such as Low, Medium, or High, to guide storage and operational precautions. |
| Hazard Rating | Captures the hazard description/rating needed for quick operational awareness and more complete safety records. |
| Date Received | Records when the chemical entered stock, helping with batch rotation and stock-age review. |

### 6.5 Equipment fields

Equipment records show the basic fields plus the following:

| Field | Why it is included |
|---|---|
| Serial Number | Distinguishes one reusable asset from another for ownership, warranty, repair, and accountability. |
| Condition | Tracks whether the equipment is Active, in Maintenance, Damaged, or Inactive. It helps prevent unsafe or unavailable equipment from being treated as ready. |
| Manufacturer | Identifies the maker for parts, technical support, warranty, and approved maintenance information. |
| Model | Identifies the exact equipment version for compatibility and servicing. |
| Last Maintenance Date | Records the latest maintenance/service date. |
| Next Maintenance Date | Records the planned next service date, helping keep field equipment safe and operational. |

### 6.6 Material fields

Material records show the basic fields plus the following:

| Field | Why it is included |
|---|---|
| Material Category | Groups the material as Protective Gear, Supplies, Tools & Accessories, or Other. This makes the stock list clearer and separates critical PPE from general consumables. |
| Description | Provides free-text detail when the item name and category are insufficient, such as size, specification, intended use, or compatibility. |

### 6.7 Add, stock in, review, and disable workflow

1. **Create item profile:** An administrator selects **Add Inventory Item**, completes basic fields and the fields for its type, then saves. The item starts at zero stock.
2. **Record a delivery:** The administrator selects **Stock In** on an active item.
3. **Complete Stock In fields:**

   | Stock In field | Why it is included |
   |---|---|
   | Amount | Required positive whole number of units received. It is added to current quantity. |
   | Date | Required date the stock was received or recorded, supporting chronological reconciliation. |
   | Reference | Optional supplier purchase order, delivery note, receipt, or internal reference. It links stock to purchasing evidence. |
   | Actor | Automatically supplied from the signed-in user name when available, identifying who recorded the movement. |

4. **Atomic update:** The database rejects invalid amounts, missing items, and disabled items. For a valid request, it inserts the movement and raises item quantity together.
5. **Review:** The **Stock Movement History** tab lists movement date, item, amount, unit, reference, actor, and created timestamp. The item-detail view shows quantity, unit cost, total value, supplier, reorder level, type-specific fields, and timestamps.
6. **Low-stock response:** When quantity is less than or equal to reorder level, the list highlights the item as Low Stock so purchasing can be initiated.
7. **Disable instead of delete:** If an item is obsolete, unsafe, or temporarily unusable, the administrator disables it. Quantity and history remain intact and Stock In is blocked. Re-enable restores normal use. The database prevents hard deletion of an item that has movement history.

## 7. Activity logging and audit notes

The application records sign-in/out, account creation/updates/status changes/password changes, client creation/updates, and document uploads/removals through a system-log service. Only administrators have log-view permission in the role matrix.

Important Sprint 1 limitation: the current activity log is browser local storage, not a shared tamper-resistant database audit trail. It is therefore useful as a UI activity aid but should not be treated as a compliance-grade record.

## 8. Important security and operational limitations

The permissions described above are enforced by the application interface and route guards. The current Supabase SQL policies are intentionally open to the browser roles used by this project, so they do **not** independently enforce the Administrator/Staff/Technician permission matrix against direct database/API use. Before production deployment, implement authenticated user identities and database Row-Level Security policies that map each account to its role and allowed records.

Additional recommended next steps:

1. Add service appointments, inspections, technician assignment, treatment reports, and client service history.
2. Add inventory stock-out/usage records tied to a specific appointment or treatment, returns, corrections with approval, and inter-location transfers.
3. Add chemical batch/lot numbers, label/SDS references, regulatory registration, and expiry alerts where required by local regulation.
4. Store system logs in the database with immutable actor identity and timestamps.
5. Replace open database policies with role-aware server-side policies and avoid storing/handling credentials through browser-accessible patterns.
6. Add purchase orders, supplier receipts, quotation/invoice/payment workflows, and live dashboard analytics once the relevant data is stored.

## 9. Data entities in Sprint 1

| Entity | Purpose | Key relationships |
|---|---|---|
| User accounts | Administrator, Staff, and Technician profiles used for sign-in and permissions. | A user can be the actor on app-level actions and Stock In records. |
| Clients | Customer and treatment-site profile. | One client can have many client documents. |
| Client documents | Metadata for a file held in the private storage bucket. | Belongs to one client; deleting a client removes document metadata. |
| Inventory | Master record for a chemical, equipment asset, or material. | One inventory item can have many stock movement records. |
| Inventory movements | Immutable-style operational log of Stock In entries. | Belongs to one inventory item; prevents deleting an item with recorded movement history. |
| System logs | Browser-local activity entries for user, client, document, and authentication actions. | Not yet a shared database entity. |
