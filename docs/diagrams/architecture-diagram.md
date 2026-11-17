# Current System Architecture

```mermaid
flowchart LR
    U["Patients, doctors, receptionists,<br/>admins and super admins"]

    subgraph APP["Web application"]
        UI["React + TypeScript UI<br/>Role dashboards and modules"]
        CLIENT["apiClient.ts<br/>HTTP requests and session token"]
        UI --> CLIENT
    end

    subgraph SERVER["Node.js / Express — server.ts"]
        API["Application API<br/>Auth, appointments, shifts,<br/>clinical records, RBAC"]
        GUARD["Session validation<br/>Role permissions and data scoping"]
        PROXY["Authenticated ORDS proxy<br/>/api/ords/*"]
        API --> GUARD
        GUARD --> PROXY
    end

    subgraph LOCAL["Local JSON persistence — data/"]
        RBAC["RBAC settings and audit logs"]
        CLINICAL["Clinical records and prescriptions"]
        SUPPORT["Shift data, appointment metadata,<br/>patient regions, notification acknowledgements,<br/>analytics seed data"]
    end

    subgraph ORACLE["Oracle Cloud"]
        ORDS["Oracle REST Data Services (ORDS)<br/>girish_opd_api"]
        DB[("Oracle database<br/>GIRISH_* tables")]
        ORDS --> DB
    end

    U --> UI
    CLIENT -->|"Same-origin /api/*"| API
    API <-->|"Read/write selected app data"| LOCAL
    PROXY <-->|"ORDS_BASE_URL"| ORDS
    API -->|"Serves Vite middleware in development<br/>or built dist/ files in production"| UI
```

The Express server is the app's backend-for-frontend: the browser calls it, and it checks sessions and permissions before serving local data or forwarding allowed requests to Oracle ORDS. Oracle is the primary store for core hospital records; selected RBAC, clinical, and supporting data are stored in local JSON files.
