# Torres Pest Control — Full System Checklist

Every function in the system, in the order a real business day would use them.
Each part has numbered steps, what you should see (✅), and a short **Study** note
that explains the rule behind it, so you can answer the panel.

**Where to do it:** do the full run on your **local copy** (`npm run local`, then
`npm start`, then http://localhost:3000). It has the same defense clients, and
anything you create while testing stays off the live site. Payments and invoices
can never be deleted, only reversed or voided, so test records on live would stay forever.
Do Part 2 (forgot password) on the live site only.

**Local logins:** `admin`, `staff`, `technician` (password = `LOCAL_ADMIN_PASSWORD` in `.env.local`).
**Live logins:** your admin account, `pestStaff` (Patricia Santos), `pestTech` (Paolo Esteban).

**Test client:** wherever a step says "the test client", use one you create in Part 6
(name it **Checklist Test Client**), so the defense clients stay as they are.

Tick each box as you go: `[ ]` → `[x]`.

---

## Part 1 — Logging in and staying logged in

- [ ] 1. Open the site while logged out. ✅ You land on the login page.
- [ ] 2. Log in with a wrong password. ✅ A clear error message; you stay on the login page.
- [ ] 3. Log in as **admin**. ✅ You land on **Today**. The bottom-left shows your name and "Admin".
- [ ] 4. Refresh the page (F5). ✅ You are still logged in.
- [ ] 5. Click your name (bottom-left) → **Log out**. ✅ Back to the login page.
- [ ] 6. Type a page address directly, e.g. `/billing`, while logged out. ✅ You are sent to the login page.

**Study:** the system does not use Supabase's login. `check_login()` checks the username
and password against the app's own accounts and gives the browser a session token.
Every request carries that token, and the database checks it before showing any data.
The app re-checks the session every 3 seconds, so a deactivated account is thrown out almost at once.

---

## Part 2 — Forgot password (live site only)

- [ ] 1. On the login page click **Forgot password**.
- [ ] 2. Enter the email of the account that owns the Resend key. ✅ "If an account exists for that email, we've sent a temporary password to it."
- [ ] 3. Check that inbox. ✅ An email with a temporary password.
- [ ] 4. Log in with it. ✅ It works; set a new one in **Settings → Change Password**.
- [ ] 5. Try another account's email. ✅ The same message, no email, and that account's old password still works.

**Study:** the message is the same whether or not the email exists, so no one can use it to
find out who has an account. The function sends the email **first** and changes the password
**only if the email was sent**, so nobody is locked out. In test mode Resend only delivers to
the address that owns the Resend account; a verified domain would let it send to everyone.

---

## Part 3 — Your own account

- [ ] 1. Click your name (bottom-left) → **My account** (or open `/account`). ✅ Your name, email, phone and role.
- [ ] 2. Change your phone to an invalid one (e.g. `123`). ✅ Refused: it must be 11 digits starting with 09.
- [ ] 3. Upload a profile picture (PNG or JPG under 2 MB). ✅ It appears in the sidebar and the top bar.
- [ ] 4. Try a file over 2 MB. ✅ Refused with a size message.
- [ ] 5. **Settings → Change Password**: enter a wrong current password. ✅ Refused.
- [ ] 6. Enter the right current password and a new one without a number (e.g. `abcdef`). ✅ Refused: at least 6 characters with a letter and a number.
- [ ] 7. Change it properly, log out, and log in with the new password. ✅ Works.

**Study:** changing a password checks the current one first and then ends every other session
of that account, so a stolen login stops working.

---

## Part 4 — Things on every page

- [ ] 1. **Search box** (top, or Ctrl+K): type `Lorna`. ✅ Lorna Villanueva shows; click it to open her profile.
- [ ] 2. Search a reference, e.g. `TPC-V-` and a number, or `TPC-C-`. ✅ The matching visit or client.
- [ ] 3. **Bell icon** (top right). ✅ The notification list opens; clicking one opens the visit.
- [ ] 4. **+ New visit** (top right). ✅ The New appointment window opens from any page.
- [ ] 5. **Sidebar badges**: hover the number next to **Schedule**. ✅ A summary of upcoming visits by   status and kind.
- [ ] 6. Hover the badge next to **Inventory** and **Billing**. ✅ Low stock / payments due.
- [ ] 7. Make the browser narrow (or open on a phone). ✅ The sidebar becomes bottom tabs; nothing scrolls sideways.
- [ ] 8. Open any "…" menu at the bottom of a list. ✅ It opens fully, never cut off.

---

## Part 5 — Accounts (admin only)

- [ ] 1. **Accounts**. ✅ Every account with reference (TPC-S-…, TPC-T-…), role, status, phone and last login.
- [ ] 2. Use **Search**, **Role** and **Status** filters. ✅ The list narrows.
- [ ] 3. **Create Account**: fill in a Staff account with an email already in use. ✅ Refused: email taken.
- [ ] 4. Use a username already in use. ✅ Refused.
- [ ] 5. Create it properly (name, email, username, phone, role Staff, starting password). ✅ It appears with status **Pending**.
- [ ] 6. Log in as that new account in a private window. ✅ Works; its status becomes **Active**.
- [ ] 7. Back as admin: "…" → **Edit user**, change the name. ✅ Saved, with a confirmation message.
- [ ] 8. Change its role from Staff to Technician. ✅ Moved; it keeps its history.
- [ ] 9. Try to change an account to Admin. ✅ Refused: moving into or out of Admin is not allowed.
- [ ] 10. "…" → **Reset password**. ✅ A new password is set; the person's sessions end.
- [ ] 11. "…" → **Deactivate** while that account is logged in elsewhere. ✅ Within about 3 seconds it is thrown out and cannot log in again.
- [ ] 12. "…" → **Activate**. ✅ It can log in again.
- [ ] 13. Hover a user's picture → change it. ✅ The admin can change anyone's avatar.
- [ ] 14. Hover a user's picture → click the small **download** icon. ✅ That person's profile picture downloads (greyed out when they have no picture).
- [ ] 15. Log in as `staff`. ✅ No **Accounts** in the menu, and `/users` sends you back.

**Study:** an account's role is which table it sits in (admins, staff or technicians), so a role
change moves the row and keeps its ID. Passwords are stored hashed; a technician with live visits
cannot be moved. Deactivating ends every session.

---

## Part 6 — Clients

- [ ] 1. **Clients**. ✅ The list with reference, classification, contact and status.
- [ ] 2. Search by name, phone and email; filter by classification and status (Active / Archived). ✅ Works.
- [ ] 3. **New client**: leave the name empty. ✅ Refused.
- [ ] 4. Phone `0917123` (too short). ✅ Refused: 11 digits starting with 09.
- [ ] 5. Email `lorna.villanueva@example.com` (already Lorna's). ✅ Refused, naming Lorna Villanueva.
- [ ] 6. Classification **Other** with nothing in "Please specify". ✅ Refused.
- [ ] 7. Create **Checklist Test Client** properly (Residential, source Referral, address, service notes). ✅ Saved with a reference TPC-C-….
- [ ] 8. Open it → **Edit**, change the address. ✅ Saved.
- [ ] 9. **Archive** it. ✅ It moves to Archived and disappears from booking lists.
- [ ] 10. **Restore** it. ✅ Back to Active.
- [ ] 11. As `staff`: ✅ you can archive and restore, but there is no permanent delete.
- [ ] 12. As admin: ✅ **Delete permanently** exists (do not use it on real clients).

**Study:** every client must have their own email because quotes, invoices and receipts are emailed.
Archived clients keep their history; only an admin can delete permanently.

### 6b — The client profile (open **Lorna Villanueva**)

- [ ] 1. Top of the page: ✅ "Right now" says where the client stands (e.g. checkup booked, warranty running).
- [ ] 2. **Timeline** tab. ✅ Inspection → quotation → down payment → treatment → invoice → payment → checkup, in order.
- [ ] 3. **Visits** tab. ✅ Every visit with status; click one to open it.
- [ ] 4. **Documents** tab: upload a PDF under a category (e.g. Permits). ✅ It appears under that category.
- [ ] 5. Click the file. ✅ It opens (a short-lived private link).
- [ ] 6. Upload a file over 10 MB, or a .exe. ✅ Refused.
- [ ] 7. Delete the file you uploaded. ✅ Gone.
- [ ] 8. **Billing** tab. ✅ Balance owed (₱0 for Lorna) and her quotes, invoices and payments.
- [ ] 9. On the test client's Billing tab, switch **"Can be booked without payment"** on and off. ✅ Saved (office only).
- [ ] 10. **Monitoring** tab (open **Kusina ni Lola Restaurant**). ✅ Pest activity drops from High to Medium; open issues are listed.
- [ ] 11. **Print** the Site Monitoring Report. ✅ A printable report opens.
- [ ] 12. **Warranty** box (back on Lorna). ✅ 12 months, Oct 16, 2026 – Oct 16, 2027, quarterly checkups; "Visits under this warranty" lists each period and the booked checkup.

---

## Part 7 — Services and rates (Setup → Services)

- [ ] 1. **Services**. ✅ Each service with price, category (Chemical / Non-chemical) and materials.
- [ ] 2. **Checkup**, **Follow-up Visit** and **Inspection** show **Built-in**. ✅ No Retire or Delete; name and category locked; Checkup price stays ₱0.
- [ ] 3. **Add service** → Flat price, e.g. "Ant Control" ₱2,500, Chemical. ✅ Saved.
- [ ] 4. Add a per-sqm service: rate ₱150 and a minimum charge. ✅ Saved; the price is area × rate, never below the minimum.
- [ ] 5. Add materials: one **Included** (with a default amount), one **Extra charged**, one **Charge all**. ✅ Saved.
- [ ] 6. Make a service **Non-chemical** and try to add a chemical. ✅ Refused.
- [ ] 7. Set a **Follow-up price** and a **Deposit %**. ✅ Saved.
- [ ] 8. Tick **"Can be booked without payment"**. ✅ Saved.
- [ ] 9. **Retire** your new service. ✅ It disappears from booking lists but stays on old records.
- [ ] 10. Try to **Delete** a service that a visit or quote has used (e.g. General Pest Control). ✅ Refused: retire it instead.
- [ ] 11. **Rates**: change Transportation per km and Labor per technician per day. ✅ Saved; new quotes use them.

**Study:** a visit keeps the service name as booked, so renaming or retiring a service never changes history.
Included = free up to the default amount; Extra charged = only what is used above it; Charge all = every unit used.

---

## Part 8 — Inventory

### 8a — Items
- [ ] 1. **Inventory → Items**. ✅ Every item with stock, unit, status, value and the "Watch" column (low, expiring).
- [ ] 2. **Add item** of each type: Chemical (chemical type, hazard), Equipment (serial number, condition, maintenance dates), Material (category). ✅ Saved.
- [ ] 3. Add an item with the same name and type as an existing one. ✅ Refused as a duplicate.
- [ ] 4. Set a **customer price**: Fixed, then Markup %. ✅ The margin shows.
- [ ] 5. Set Date received in the future. ✅ Refused.
- [ ] 6. "…" → **Edit**. ✅ Saved; a chemical's expiry is read-only (it comes from its batches).
- [ ] 7. "…" → **Disable**, then **Enable**. ✅ A disabled item cannot be stocked in or out.
- [ ] 8. "…" → **Delete** on your new item. ✅ Removed.
- [ ] 9. Click an item row. ✅ Its details, its **batches**, and its recent movements.

### 8b — Receive a delivery (Stock In)
- [ ] 1. **Stock In** on a chemical without a lot number. ✅ Refused unless "No lot number printed" is ticked.
- [ ] 2. Expiry earlier than the delivery date. ✅ Refused.
- [ ] 3. Enter gallons for an item kept in litres, with a cost per gallon. ✅ Converted to litres and cost per litre (4 decimal places accepted).
- [ ] 4. Leave out the purchase reference or the branch. ✅ Refused.
- [ ] 5. Save a proper delivery. ✅ Stock goes up; a new batch (TPC-B-…) with your lot and expiry appears.

### 8c — Stock out and technicians
- [ ] 1. **Stock out** to a technician with two items. ✅ Both the staff member and the technician must sign on the pads.
- [ ] 2. Save it. ✅ The handover slip can be printed; the stock appears under **With technicians**.
- [ ] 3. Choose a visit on Stock out. ✅ Its services' materials are filled in.
- [ ] 4. Pick a specific batch, then let it choose. ✅ Without a choice it takes the soonest-expiring batch first, skipping expired ones.
- [ ] 5. Ask for more than is on the shelf. ✅ Refused.
- [ ] 6. **With technicians** tab → **Return** part of it with a reason (Leftover, Not needed, Visit cancelled, Other + note). ✅ Back on the shelf, into the same batch.
- [ ] 7. **Report lost / damaged** (Lost, Stolen, Damaged + note). ✅ Closed without returning to the shelf; counted in the missing/damaged totals.
- [ ] 8. **Correct Stock** with a reason. ✅ The level changes and the correction is recorded.

### 8d — Batches
- [ ] 1. Open a chemical's batches. ✅ Each batch: reference, lot, expiry, quantity left.
- [ ] 2. **Edit** a batch's lot or expiry. ✅ Saved.
- [ ] 3. **Split** the opening batch into a real lot. ✅ Two batches; the total is unchanged.
- [ ] 4. **Write off** an expired batch. ✅ Its leftover leaves the shelf with reason Expired.

### 8e — History
- [ ] 1. **History** tab. ✅ Every movement: deliveries, use on visits, checkouts, returns, losses, corrections.
- [ ] 2. Use the reason chips, the item filter, the date range and the search box (try `PO-2026-0905` or a lot number). ✅ The list narrows.
- [ ] 3. Find the delivery **PO-2026-0905**. ✅ Termidor SC, Demand CS 2.5 and the others, with lots and expiry.

**Study:** checking stock out to a technician is **custody**, not use: it leaves the shelf but is still
the company's. A visit's materials are taken first from what the crew is holding, then from the shelf.
The shelf total always equals the sum of the batches. No movement can be future-dated or impossibly large.

---

## Part 9 — Schedule

### 9a — Seeing the schedule
- [ ] 1. **Schedule**. ✅ The **Upcoming** strip: counts by status and "No technician"; clicking one filters the list.
- [ ] 2. Switch **Month / Week / Day / List**. ✅ Each view shows the visits.
- [ ] 3. **Technician filter** and **More filters** (status, Unassigned). ✅ The view narrows.
- [ ] 4. Find **Mintal Rice Mill**. ✅ Three days in a row (Day 1 of 3 …), one job.
- [ ] 5. Find **Lorna Villanueva**'s checkup. ✅ Marked with a blue warranty badge.

### 9b — Booking
- [ ] 1. **New appointment** for the test client with a paid service, no quote. ✅ Blocked by the payment check; it offers "Still make appointment without an approved quotation", which needs a reason.
- [ ] 2. Give a reason and book. ✅ Booked; the reason goes to the Activity log.
- [ ] 3. Book **Inspection** for the test client. ✅ Allowed without payment.
- [ ] 4. Try a date in the past. ✅ Refused.
- [ ] 5. Pick a technician who already has a visit at that time. ✅ Warned/refused as a clash.
- [ ] 6. Pick a technician who is **out** on that day. ✅ Disabled in the picker.
- [ ] 7. Book with **two services**. ✅ One visit listing both.
- [ ] 8. Book a **recurring plan** (e.g. Monthly, 4 visits). ✅ The dates are listed before saving; all are booked together.
- [ ] 9. Book a **multi-day job** (e.g. 2 days). ✅ Two visits, price on Day 1 only.
- [ ] 10. Book with no technician. ✅ Saved as **Unassigned**; it shows on Today's Unassigned list.
- [ ] 11. Open **Bajada Dental Clinic**'s quote → **Book visit**. ✅ The booking is prefilled and linked to the quote.
- [ ] 12. For **Lorna**, open New appointment. ✅ It asks "What kind of visit?": Paid visit, Warranty checkup or Warranty re-treatment.

### 9c — An appointment's details (open **Ramon Garcia**'s follow-up)
- [ ] 1. **Overview**. ✅ Client, services, crew, price, status, "Follow-up of" the treatment visit, and what it is billed under.
- [ ] 2. Change status Pending → Confirmed → Reschedule. ✅ Each change is listed in **Status history**.
- [ ] 3. Try to change a **Completed** visit's status. ✅ Refused.
- [ ] 4. Choose **Cancel** with a reason. ✅ Shown as Cancelled everywhere.
- [ ] 5. Edit the crew and the time. ✅ Saved with a confirmation; clashes are refused.
- [ ] 6. On a completed visit, **Book follow-up**. ✅ Prefills the Follow-up Visit service and its price.
- [ ] 7. On a plan visit (**Kusina ni Lola**), open the **Plan** section. ✅ Change future visits, add a visit, cancel the rest, or **Don't renew**.
- [ ] 8. On a multi-day job, **Finish job here** / finish a day. ✅ The job's days move together.

### 9d — Report (the test client's visit)
- [ ] 1. **Report** tab: tick the services performed, write findings and recommendations, set pest activity and open issues, a follow-up date. ✅ Saved.
- [ ] 2. On an **Inspection**: enter the area in sqm and recommended services. ✅ "Create quote from inspection" appears afterwards.
- [ ] 3. **Stock-Out** tab: the service's materials are prefilled; "used first" shows stock the crew holds. ✅ Saved; stock goes down.
- [ ] 4. Add photos / attachments. ✅ Listed under their category.
- [ ] 5. Customer and technician **signatures**, then submit. ✅ Status becomes **Completed**.
- [ ] 6. A follow-up date with a quote in place. ✅ The follow-up is booked automatically, and a message says so.
- [ ] 7. The completed visit is now read-only. ✅ "Correct this visit" exists for office accounts.
- [ ] 8. **Print service report**. ✅ Letterhead, services, findings, materials with lot numbers, signatures, warranty box.

### 9e — Technician unavailable
- [ ] 1. **Technician unavailable** → pick a technician and two days, reason Sick. ✅ It lists their visits in those days with a suggested cover for each.
- [ ] 2. Accept the plan. ✅ Visits move to the cover; the technician shows as **Out** on those days.
- [ ] 3. End the absence early. ✅ They can be booked again.

**Study:** one check, `assert_technicians_available`, guards every booking path: no clash and nobody who is out.
A completed visit no longer holds the technician's time. Plans are booked in one transaction, so either all dates are booked or none.

---

## Part 10 — Today (the dashboard)

- [ ] 1. As admin, **Today**. ✅ The dispatch board: a lane per technician with today's visits.
- [ ] 2. **Needs attention**. ✅ Reports owed, follow-ups due, checkups due, payments due or overdue, who is out today.
- [ ] 3. **Unassigned** list. ✅ Cabantian Townhomes HOA (tomorrow).
- [ ] 4. Drag an unassigned visit onto a technician's lane. ✅ Assigned; dropping on someone who is out is refused.
- [ ] 5. Open the folded sections **This week**, **Billing**, **Cost & stock**. ✅ Figures show; the choice stays folded/open next time.

---

## Part 11 — The technician's day (log in as `technician`, or `pestTech` on live)

- [ ] 1. ✅ A simple phone view of **today's visits** in order, with address and notes.
- [ ] 2. The menu has no Billing, Reports, Services, Accounts or Activity log. ✅ Correct.
- [ ] 3. Open today's visit → **Start visit**. ✅ Only works on the visit's own day; status becomes **In progress**.
- [ ] 4. **Treatment**: tick the services, record materials used. ✅ "Used first" shows what you are holding.
- [ ] 5. **Findings**: pest activity, open issues, recommendations, follow-up date.
- [ ] 6. **Photos**: add treatment proof.
- [ ] 7. **Sign**: customer and technician sign.
- [ ] 8. **Finish job**. ✅ Completed; the office sees it at once.

(If the technician has no visit today, first assign them to one as admin.)

---

## Part 12 — Billing

### 12a — All billing
- [ ] 1. **Billing** opens on **All billing**. ✅ Every quote, invoice, contract and payment in one table; chips filter by kind.
- [ ] 2. **Money summary** (folded). ✅ Totals collected, outstanding, overdue.

### 12b — Quotations
- [ ] 1. **New quote** for the test client: a flat service. ✅ Totals update as you type.
- [ ] 2. Add a per-sqm service and an area. ✅ Priced area × rate.
- [ ] 3. Add **Transportation** (km) and **Labor** (technicians × days). ✅ Rates from Services.
- [ ] 4. A service with **Charge all** materials. ✅ "Materials charged by use (estimate)" and "Estimated total" show, but are not in the saved total.
- [ ] 5. Discount ₱ then %; VAT **Added**, **Inclusive**, **None**. ✅ The totals change correctly.
- [ ] 6. Down payment None / ₱ / %. ✅ The amount shows.
- [ ] 7. Warranty: months and checkups Monthly / Quarterly. ✅ Saved.
- [ ] 8. Save as **Draft** → **Send**. ✅ Status Sent.
- [ ] 9. Edit a Sent quote and save. ✅ Goes back to Draft.
- [ ] 10. **Revise**. ✅ A new draft copy linked to the old one.
- [ ] 11. **Reject** one with a note. ✅ Rejected.
- [ ] 12. **Approve** another. ✅ Approved.
- [ ] 13. A Sent quote past its "valid until" date. ✅ Shows as **Expired**.
- [ ] 14. Delete an unused draft. ✅ Allowed; a used or sent quote cannot be deleted.
- [ ] 15. **Print** and **Email** (opens a Gmail draft and the PDF window). ✅ Letterhead, lines, totals, warranty box, "One-time service".
- [ ] 16. From Lorna's inspection, **Create quote from inspection**. ✅ The area and recommended service are prefilled; the inspection shows as included at no charge.

### 12c — Down payments
- [ ] 1. On the approved quote, **Book visit** before paying. ✅ Refused: the down payment is due.
- [ ] 2. **Record down payment** by Cash, GCash (reference no.), Bank transfer. ✅ Receipt TPC-R-… issued.
- [ ] 3. Record one by **Check** (number, bank, date). ✅ Status **Pending**; it does not count until Cleared.
- [ ] 4. Mark it **Cleared**. ✅ Now it counts and booking is allowed.
- [ ] 5. Mark another check **Bounced** without a note. ✅ Refused; with a note it stops counting.
- [ ] 6. **Book visit** now. ✅ Allowed and linked.

### 12d — Invoices
- [ ] 1. **Ready to invoice from contracts**. ✅ Kusina ni Lola's next visit appears when due.
- [ ] 2. **New invoice** from an approved quote with a completed visit. ✅ Prefilled: quote lines, materials used ("(included)" at ₱0 or charged), the down payment deducted.
- [ ] 3. Tick a visit with no quote. ✅ Billed at the visit's booked price.
- [ ] 4. Try to bill a visit already on an invoice. ✅ Not offered (a visit is billed once).
- [ ] 5. Try to bill a warranty visit. ✅ Not offered (warranty visits are free).
- [ ] 6. Issue it. ✅ TPC-INV-…, due date from the terms.
- [ ] 7. **Record payment** part of it. ✅ **Partly paid** (see Ramon Garcia).
- [ ] 8. Pay more than is due. ✅ Refused.
- [ ] 9. Pay the rest. ✅ **Paid** (see Lorna).
- [ ] 10. Check **Kusina ni Lola**'s second invoice. ✅ **Overdue**.
- [ ] 11. **Void** an invoice with a payment still on it. ✅ Refused. Void one without payments, with a reason (admin only). ✅ Voided; its visits can be billed again.
- [ ] 12. **Reverse** a payment with a reason (admin only). ✅ It stops counting; it is never deleted.
- [ ] 13. As `staff`: ✅ no Void and no Reverse buttons.
- [ ] 14. Print the invoice and a receipt. ✅ Both print.

### 12e — Contracts
- [ ] 1. Open **Kusina ni Lola**'s contract. ✅ Terms, 6 visits, ₱3,500 per visit, per-visit billing, down payment paid.
- [ ] 2. **New contract** for the test client (services, frequency, visit count or end date, price per visit, billing schedule, inclusions, cancellation terms, down payment, warranty). ✅ Saved as Draft.
- [ ] 3. **Print contract**. ✅ Terms and two signature lines.
- [ ] 4. **Activate** without the signed copy. ✅ Refused.
- [ ] 5. Upload the signed copy, then Activate. ✅ Active; the copy also appears in the client's Documents → Contracts.
- [ ] 6. **Book visits** before the down payment. ✅ Refused. After paying it: ✅ a recurring plan is prefilled and linked.
- [ ] 7. **Cancel contract** with a reason. ✅ Future visits cancelled; it will not ask to renew.

**Study:** totals are worked out on the server, so the app cannot send a wrong total. Paid / Partly paid /
Overdue are worked out from the payments, never typed in. Money records are never deleted: an invoice is voided
and a payment is reversed, each with a reason. A quotation is a one-time job; a contract is for repeating visits.

---

## Part 13 — Warranty page

- [ ] 1. **Warranty**. ✅ Every warranty: client, source (quote or contract), dates, checkup frequency, what is booked.
- [ ] 2. Open **Lorna**'s. ✅ Quarterly periods; the first has its checkup booked, the others "Not booked".
- [ ] 3. **Book** a checkup for the second period. ✅ Booked at ₱0.
- [ ] 4. Try a second checkup in the same period. ✅ Refused (one per period).
- [ ] 5. Try a date outside the warranty. ✅ Refused.
- [ ] 6. **Free re-treatment** without a reason. ✅ Refused; with a reason it is booked at ₱0 (re-treatments are unlimited).
- [ ] 7. **Book follow-up**. ✅ Opens New appointment for that client; under a running warranty it becomes the free re-treatment.
- [ ] 8. **Edit warranty**: shorten it so it ends before a booked checkup. ✅ Refused, naming the visit.
- [ ] 9. Change the checkup frequency while checkups are booked. ✅ Refused.
- [ ] 10. Shorten or remove it properly. ✅ Needs a reason; the before/after dates show; the change is logged.
- [ ] 11. **Mintal Rice Mill**'s warranty. ✅ Not started yet: it starts when the 3-day job is finished.

**Study:** a quotation's warranty starts on the day the job was completed (for a multi-day job, the last day);
a contract's starts when it is activated. Checkups split the warranty into monthly or quarterly periods, one checkup each.
Warranty visits are always ₱0 and are never invoiced; the database refuses anything else.

---

## Part 14 — Reports (admin and staff, read only)

- [ ] 1. **Reports → Sales & collections**, pick a date range. ✅ Invoiced, collected, outstanding, by client.
- [ ] 2. **Stock usage**. ✅ What was used, on which visits, cost.
- [ ] 3. **Technician performance**. ✅ Visits done per technician.
- [ ] 4. **Export CSV** and **PDF** on each. ✅ Both download/print.
- [ ] 5. As `technician`: ✅ no Reports.

---

## Part 15 — Activity log (admin only)

- [ ] 1. **Activity log**. ✅ Logins, logouts, account changes, client changes, stock changes, booking overrides, warranty edits, each with who, role and when.
- [ ] 2. Filter and search. ✅ Works.
- [ ] 3. As `staff`: ✅ no Activity log.

**Study:** entries are written by the server, which takes the person from the session, so nobody can log as someone else.
The log cannot be edited or deleted (append-only).

---

## Part 16 — Who can do what (log in as each role)

| Check | Admin | Staff | Technician |
|---|---|---|---|
| Accounts, Activity log | ✅ | ❌ | ❌ |
| Clients: add, edit, archive | ✅ | ✅ | view only |
| Delete a client for good | ✅ | ❌ | ❌ |
| Inventory: stock in, add items, corrections | ✅ | ✅ | view only |
| Schedule: book, edit | ✅ | ✅ | edit own visits / reports |
| Billing: quotes, invoices, payments | ✅ | ✅ | ❌ |
| Void invoice, reverse payment | ✅ | ❌ | ❌ |
| Services and rates | ✅ | ✅ | ❌ |
| Reports | ✅ | ✅ | ❌ |

- [ ] Log in as each role and confirm every row above.
- [ ] As `technician`, type `/billing` and `/users` in the address bar. ✅ Sent back.

**Study:** permissions live in two places: the menu hides what a role cannot use, and the database itself
refuses it (row-level security). Hiding a button alone is not security; the database rule is.

---

## Part 17 — Security checks

- [ ] 1. Log in with the same staff account on two browsers. ✅ The first is logged out (one device per account), except the shared test accounts pestStaff and pestTech.
- [ ] 2. Deactivate an account that is logged in. ✅ Out within about 3 seconds.
- [ ] 3. Change a password. ✅ Every other session of that account ends.
- [ ] 4. Open a document link, wait a few minutes, open it again. ✅ The old link has expired (files are private; links are made when you click).

---

## Part 18 — The local backup (for the defense day)

- [ ] 1. Terminal 1: `npm run local` (leave it open).
- [ ] 2. Terminal 2: `npm start`. ✅ The browser opens http://localhost:3000.
- [ ] 3. Log in as `admin`. ✅ The defense clients are there.
- [ ] 4. Forgot password. ✅ Shows "ask an administrator" (no internet email locally).

---

## Lines to remember for the panel

- **"Where is the data kept?"** Supabase (PostgreSQL). Every change goes through database functions that check permissions and rules, so the app cannot break them.
- **"What if two people book the same technician?"** One check guards every booking: no clash and nobody who is out.
- **"Can money records be deleted?"** No. Invoices are voided and payments reversed, each with a reason, and both stay on record.
- **"How do you know which chemical was used where?"** Every delivery is a batch with its lot number and expiry; every use records the batch, so a recall can be traced to the visits.
- **"What is a warranty checkup?"** A free visit inside the warranty, one per monthly or quarterly period; re-treatments are free and unlimited but need a reason.
