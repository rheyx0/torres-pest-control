# The Torres Pest Control ERD, explained simply

The [docs/erd](docs/erd) folder holds the entity relationship diagram (ERD) of the Torres Pest Control Management System. This page explains it in plain words. The same diagram is in the Technical Manual, Section 6.1.

| Figure | What it shows |
|---|---|
| [erd-figure-2-complete.jpg](docs/erd/erd-figure-2-complete.jpg) | The whole database: all 31 tables and all 52 links |
| [erd-figure-2a-clients-scheduling.jpg](docs/erd/erd-figure-2a-clients-scheduling.jpg) | Clients and scheduling |
| [erd-figure-2b-billing.jpg](docs/erd/erd-figure-2b-billing.jpg) | Billing |
| [erd-figure-2c-catalog-inventory.jpg](docs/erd/erd-figure-2c-catalog-inventory.jpg) | Service catalog and inventory |
| [erd-figure-2d-accounts.jpg](docs/erd/erd-figure-2d-accounts.jpg) | Accounts and system tables |

## The short version

The database has **31 tables in six areas**: clients, scheduling, billing, the service catalog, inventory, and accounts.

**Appointments are the centre.** Each visit belongs to a client, has a crew of technicians, the services done, one service report with photos, and the stock it used. A visit is booked under a quotation or contract and billed on an invoice. Every stock movement records its batch and its visit, which is how a chemical lot can be traced to the house where it was used.

## How to read the diagram

- **A box is a table.** Each table holds one kind of thing, such as clients, visits or payments.
- **The lines inside a box are its columns.** The primary key (PK) and the foreign keys (FK) are listed first.
- **A primary key** is the unique ID of each row, for example `clients.id`.
- **A foreign key** is a column that stores another table's ID. For example, `appointments.client_id` stores the ID of the client the visit belongs to.
- **A line between two tables** means one of them stores the other's ID.
- **A bar ( | ) means one. A crow's foot (three prongs) means many.** The crow's foot is always on the table that stores the ID. So `clients |──< appointments` reads "one client has many appointments".
- **Bars at both ends** mean one-to-one: a visit has at most one service report.
- **Dashed lines** are links to user accounts. They have no database foreign key, because a person's ID can be in any of the three account tables (admins, staff or technicians).

## The 31 tables

### 1. Clients (2 tables)

| Table | What it holds |
|---|---|
| `clients` | Each customer: name, email (one per client), phone, address, classification and service notes. |
| `client_documents` | Files uploaded for a client: valid ID, property documents, permits, signed contracts. The file itself is in private storage. |

### 2. Scheduling and service (11 tables)

| Table | What it holds |
|---|---|
| `appointments` | Each visit: client, date and time, status, price, and its reference number (TPC-V-00001). **The centre of the diagram.** |
| `appointment_technicians` | The crew of a visit, one row per technician. One of them is the lead. |
| `appointment_services` | The services done on a visit, in order, with the name as it was when booked. |
| `appointment_plans` | Groups visits into a recurring plan (for example monthly) or a multi-day job. |
| `appointment_reports` | The technician's service report: findings, follow-up date and signatures. One per visit. |
| `appointment_report_attachments` | Photos and files attached to a report. |
| `appointment_status_history` | Every status change of a visit, with who changed it and when. |
| `appointment_extras` | Extra work recorded on a visit (an older feature, kept for old invoices). |
| `technician_absences` | Days a technician is out. A technician can't be booked on those days. |
| `notifications` | Messages to users, such as "Service completed for (client)". |
| `treatment_methods` | An old list, kept only so old reports still display. |

### 3. Billing (6 tables)

| Table | What it holds |
|---|---|
| `quotes` | Quotations (TPC-Q-00001): status, totals, VAT, discount, down payment and warranty. |
| `quote_lines` | The items on a quotation: services, materials, transportation and labor. |
| `contracts` | Service contracts for repeated visits (TPC-K-00001): services, frequency, price per visit, billing schedule, down payment and warranty. |
| `invoices` | Invoices (TPC-INV-00001): totals, the down payment deducted, amount due and due date. |
| `invoice_lines` | The items on an invoice. |
| `payments` | Down payments and invoice payments (TPC-R-00001): cash, bank transfer, GCash or check. Never deleted, only reversed. |

### 4. Service catalog (3 tables)

| Table | What it holds |
|---|---|
| `services` | What the company sells: price (flat or per square metre), Chemical or Non-chemical, follow-up price. |
| `service_materials` | The materials a service normally uses, and whether they are included or charged. |
| `app_settings` | Company-wide rates: transportation per km and labor per technician-day. |

### 5. Inventory (3 tables)

| Table | What it holds |
|---|---|
| `inventory` | Each item (chemical, equipment or material) and how much is on the shelf. |
| `inventory_batches` | One row per chemical delivery: lot number, expiry and quantity left (TPC-B-00001). |
| `inventory_movements` | Every stock change: deliveries, stock out, use on a visit, returns, losses and write-offs. |

### 6. Accounts and system (6 tables)

| Table | What it holds |
|---|---|
| `admins`, `staff`, `technicians` | The user accounts, one table per role. Passwords are stored as bcrypt hashes. |
| `sessions` | Who is logged in. Each login creates a session token. |
| `shared_login_accounts` | Test accounts allowed to be logged in on several devices. |
| `system_logs` | The activity log: who did what and when. It can't be edited or deleted. |

## How the tables are related

### What a client has
One client has many:
- appointments (visits)
- client_documents
- quotes, contracts and invoices
- payments
- appointment_plans

### What a visit has
One appointment has:
- many crew rows (`appointment_technicians`)
- many services done (`appointment_services`)
- **one** service report (`appointment_reports`)
- many photos (`appointment_report_attachments`)
- many status changes (`appointment_status_history`)
- many stock movements (`inventory_movements`)
- many extras and notifications

One appointment belongs to:
- one client
- one plan, if it is part of a recurring plan or multi-day job
- one quotation, if it was booked under one
- one invoice, once it is billed (so a visit is never billed twice)
- one earlier visit, if it is a follow-up (`follow_up_of`)
- one quotation or contract, if it is a free warranty visit

### How billing connects
- A quotation has many lines and can be paid by a down payment. Visits are booked under it, and invoices can be made from it.
- A contract can come from a quotation. It points to its recurring plan and to the signed copy in client_documents.
- An invoice can come from a quotation or a contract. It has many lines and many payments.
- A payment is either a down payment (on a quotation or contract) or a payment on an invoice. A database rule allows only one of these per payment.

### How the catalog and inventory connect
- A service lists its usual materials through `service_materials`, which links services to inventory items.
- Services and items also appear on quote lines and invoice lines.
- An inventory item has many batches and many movements.
- Each movement says which batch it came from and, if it was used on a job, which visit.

### Tables that link to themselves
- `appointments.follow_up_of`: a follow-up points to the visit it checks on.
- `quotes.revision_of`: a revised quotation points to the old one.
- `inventory_batches.split_from`: a batch split into real lots points to the original batch.
- `inventory_movements.checkout_id`: stock used on a visit points back to the hand-over it came from.

### The account links (dashed lines)
- `appointments.technician_id` and `appointment_technicians.technician_id`: the technicians on a visit.
- `technician_absences.technician_id`: whose absence it is.
- `inventory_movements.technician_id`: who received stock.
- `sessions.user_id`: whose login it is.
- `notifications.recipient_id`: who the message is for.

## One job, table by table

| Step | Table it is saved in |
|---|---|
| A new client is added | `clients` |
| Their valid ID is uploaded | `client_documents` |
| A quotation is made | `quotes` and `quote_lines` |
| The down payment is paid | `payments` (pointing to the quote) |
| The visit is booked | `appointments`, `appointment_technicians`, `appointment_services` |
| Stock is handed to the technician | `inventory_movements` (from an `inventory_batches` row) |
| The technician submits the report | `appointment_reports`, `appointment_report_attachments`, `appointment_status_history` |
| Chemicals used are recorded | `inventory_movements` (pointing to the visit and the batch) |
| The invoice is issued | `invoices` and `invoice_lines`; the visit gets its `invoice_id` |
| The client pays | `payments` (pointing to the invoice) |
| A follow-up is booked | a new `appointments` row with `follow_up_of` |

## Why it is designed this way

1. **Three account tables instead of one.** Each role is its own table. A role change moves the row but keeps the same ID, so visits and sessions still point to the same person.
2. **No warranty table.** A warranty belongs to exactly one quotation or contract, so its length and checkup frequency are columns on `quotes` and `contracts`. Warranty visits are normal appointments marked as warranty.
3. **Quotes have lines, contracts don't.** A quotation lists different charges for one job. A contract is one price per visit, and its lines appear on each invoice.
4. **Names saved on the visit.** The service name is saved as it was when booked, so renaming a service later never changes old records.
5. **Some states are calculated, not saved.** Paid, Partly paid, Overdue and Expired are worked out from payments and dates, so they are always correct.
6. **Nothing important is deleted.** Payments are reversed, invoices are voided, and the activity log can't be changed, so there is always a history.
7. **Stock always adds up.** An item's shelf quantity always equals the total of its batches. Every stock change updates both.

## Numbers to remember

- **31 tables**, **52 links**, in **6 areas**
- **Appointments** is the centre
- **One-to-one:** a visit and its service report
- **Many-to-many:** visits and technicians (through `appointment_technicians`), and visits and services (through `appointment_services`)
- **Four self-links:** follow-ups, quote revisions, batch splits and stock drawn from a hand-over

The source files used to draw the diagram are in `docs/erd/`: `draw_erd.py`, `schema-columns.txt` (every column) and `schema-keys.txt` (every key).
