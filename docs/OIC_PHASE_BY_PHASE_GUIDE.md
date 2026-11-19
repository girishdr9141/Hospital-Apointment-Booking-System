# CarePulse OPD — Full-Application ORDS ↔ OIC Migration Guide (5 Phases)

CarePulse OPD now supports switching **100% of upstream Oracle calls** between **Oracle APEX ORDS** (`ORDS_BASE_URL`) and **Oracle Integration Cloud** (`OIC_BASE_URL`) from the top header bar (`ORDS | OIC` for `ADMIN` and `SUPER_ADMIN`).

You can either:
- **Build phase-by-phase**: In the top header, click **OIC Phases** and check only the phase(s) you have built in OIC so far. Those resources route through OIC while unbuilt phases stay on ORDS.
- **Full-application OIC mode**: Keep all 5 phases checked and flip the header toggle to **OIC** to run the entire hospital portal through OIC.

---

## OIC Setup Prerequisites (One-Time)

1. **Create a REST Adapter Connection in OIC** pointing to your ORDS base URL:
   - Connection Name: `CarePulse_ORDS_Conn`
   - Connection URL: `https://<your-adb-host>/ords/nov_2026_batch/girish_opd_api/v1`
   - Security Policy: `No Security Policy` (or whatever your ORDS module uses)
2. **Create a REST Trigger Connection in OIC** (`CarePulse_OIC_Trigger`) with **Basic Authentication** (or OAuth).
3. **Configure `.env` in CarePulse OPD** (copy from `.env.example`):
   ```env
   OIC_BASE_URL=https://<your-oic-host>/ic/api/integration/v1/flows/rest/CAREPULSE_OPD_API/1.0
   OIC_USERNAME=<your_oic_username>
   OIC_PASSWORD=<your_oic_password>
   ```
   > **Single Unified Integration Pattern (Recommended for Trainers):**
   > In OIC, you can build **one** multi-resource REST Trigger integration (`CAREPULSE_OPD_API`, version `1.0`) with the resources below, or one integration per phase sharing the same base URL prefix!
   > Every response forwarded from OIC is automatically normalized by CarePulse (`{ items: [...] }` or `[...]`) and tagged with `X-Backend: oic` and `X-Backend-Phase: phase1..5` response headers.

---

## Phase 1 · Core Catalog & Rules (Start Here)

Build these 3 read/write resources first because they have zero dependencies on patients or slots:

| Method | OIC Trigger Resource | ORDS Backend Call | Notes |
| --- | --- | --- | --- |
| `GET` | `/departments` | `GET /departments/?limit=500` | Pass query param `limit` (default `500`) |
| `GET` | `/departments/{id}` | `GET /departments/{id}` | Template param `id` |
| `POST` | `/departments` | `POST /departments/` | Body: `{ department_name, description }` |
| `PUT` | `/departments/{id}` | `PUT /departments/{id}` | Body: `{ department_name, description }` |
| `DELETE` | `/departments/{id}` | `DELETE /departments/{id}` | Deactivates department (`IS_ACTIVE='N'`) |
| `GET` | `/consultation-types` | `GET /consultation-types/?limit=500` | Plus `POST`, `PUT /{id}`, `DELETE /{id}` |
| `GET` | `/cancellation-rules` | `GET /cancellation-rules?limit=500` | Returns `{ items: [...] }` |

**Verify Phase 1:** Open **OIC Phases** → check only **Phase 1** → click **Test Phase** → switch header toggle to **OIC** → open **Departments** & **Consultation Types** and inspect `X-Backend: oic` in browser DevTools.

---

## Phase 2 · Auth, Doctors & Patients

| Method | OIC Trigger Resource | ORDS Backend Call | Notes |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | `POST /auth/login` | Body: `{ email, identifier, password }` |
| `POST` | `/auth/register` | `POST /auth/register` | Patient registration payload |
| `GET` | `/doctors` | `GET /doctors?limit=500` | Returns `{ items: [...] }` |
| `POST` | `/doctors` | `POST /doctors` | Body: `{ department_id, first_name, last_name, specialization, consultation_fee, tele_consult_flag }` |
| `PUT` | `/doctors/{id}` | `PUT /doctors/{id}` | Update doctor profile |
| `DELETE` | `/doctors/{id}` | `DELETE /doctors/{id}` | Deactivate doctor |
| `GET` | `/patients` | `GET /patients?limit=500` | Forward optional `?email=`, `?phone=`, `?gender=` |
| `GET` | `/patients/{id}` | `GET /patients/{id}` | Single patient lookup |
| `POST` | `/patients` | `POST /patients` | Create patient |
| `PUT` | `/patients/{id}` | `PUT /patients/{id}` | Update patient |

**Verify Phase 2:** Enable **Phase 2** in **OIC Phases** → click **Test Phase** → browse **Doctors** and **Patients** and create/update a test patient.

---

## Phase 3 · Schedules & Slot Inventory

| Method | OIC Trigger Resource | ORDS Backend Call | Notes |
| --- | --- | --- | --- |
| `GET` | `/slot_templates` | `GET /slot_templates?limit=500` | Weekly doctor shift templates |
| `POST` | `/slot_templates` | `POST /slot_templates` | Create template |
| `DELETE` | `/slot_templates/{id}` | `DELETE /slot_templates/{id}` | Delete template |
| `GET` | `/slots` | `GET /slots?limit=500` | Published daily slots |
| `POST` | `/slots` | `POST /slots` | Body: `{ template_id, slot_date, start_time, end_time, max_patients_per_slot }` |
| `PUT` | `/slots/{id}` | `PUT /slots/{id}` | Update slot capacity/status |
| `DELETE` | `/slots/{id}` | `DELETE /slots/{id}` | Cancel/close slot |

**Verify Phase 3:** Enable **Phase 3** → click **Test Phase** → open **Slots** and confirm a future doctor slot.

---

## Phase 4 · Appointments, Leaves, Payments & Token Queue

| Method | OIC Trigger Resource | ORDS Backend Call | Notes |
| --- | --- | --- | --- |
| `GET` | `/appointments` | `GET /appointments?limit=500` | List appointments |
| `POST` | `/appointments` | `POST /appointments/` | Body: `{ patient_id, slot_id, booking_source }` |
| `POST` | `/appointments/{id}/confirm` | `POST /appointments/{id}/confirm` | Confirms `HELD` booking |
| `POST` | `/appointments/{id}/cancel` | `POST /appointments/{id}/cancel` | Cancels booking & frees slot |
| `POST` | `/appointments/{id}/outcome` | `POST /appointments/{id}/outcome` | Body: `{ outcome: "COMPLETED" \| "NO_SHOW" }` |
| `POST` | `/appointments/expire-holds` | `POST /appointments/expire-holds` | Releases expired 10-minute holds |
| `GET` | `/leaves` | `GET /leaves?limit=500` | Doctor leave requests |
| `POST` | `/leaves` | `POST /leaves` | Submit doctor leave |
| `POST` | `/leaves/{id}/decide` | `POST /leaves/{id}/decide` | Body: `{ decision, comments, admin_user_id }` |
| `GET` | `/payments` | `GET /payments?limit=500` | Consultation payments |
| `POST` | `/payments` | `POST /payments` | Record payment |
| `GET` | `/token_queue` | `GET /token_queue?limit=500` | OPD queue |
| `POST` | `/token_queue` | `POST /token_queue` | Issue token `{ appointment_id }` |
| `PUT` | `/token_queue/{id}` | `PUT /token_queue/{id}` | Update token status |

**Verify Phase 4:** Enable **Phase 4** → click **Test Phase** → test booking/confirming/cancelling an appointment, checking Token Queue, and viewing Payments.

---

## Phase 5 · Governance, Reports & Logs (100% OIC Coverage)

| Method | OIC Trigger Resource | ORDS Backend Call | Notes |
| --- | --- | --- | --- |
| `GET` | `/users` | `GET /users?limit=500` | Plus `POST /users` |
| `GET` | `/roles` | `GET /roles?limit=500` | Oracle role definitions |
| `GET` | `/permissions` | `GET /permissions?limit=500` | Oracle permission definitions |
| `GET` | `/reports/utilisation` | `GET /reports/utilisation?limit=500` | Doctor slot utilisation metrics |
| `GET` | `/audit-logs` | `GET /audit-logs?limit=500` | Oracle DB audit logs |
| `GET` | `/error-logs` | `GET /error-logs?limit=500` | Oracle PL/SQL error logs |

**Verify Phase 5:** Click **Enable All 5 Phases** → **Test All Read Endpoints** → switch the header toggle to **OIC**. Now 100% of CarePulse OPD runs end-to-end through Oracle Integration Cloud!
