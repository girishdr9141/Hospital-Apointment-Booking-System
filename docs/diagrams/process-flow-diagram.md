# Current User and Appointment Process

```mermaid
flowchart TD
    START([User opens the app]) --> LOGIN["Enter role, full name,<br/>email and password"]
    LOGIN --> POST["React apiClient sends<br/>POST /api/auth/login"]
    POST --> CHECK["Express checks login limits<br/>and resolves the account"]
    CHECK --> IDP{"Can Oracle ORDS<br/>authenticate the account?"}
    IDP -->|"Yes"| VERIFY["Check name, account status,<br/>selected role and local RBAC"]
    IDP -->|"Unavailable / account not found"| BRIDGE["Try configured bridge or<br/>Oracle doctor/patient identity"]
    BRIDGE --> VERIFY
    VERIFY --> VALID{"Login accepted?"}
    VALID -->|"No"| FAIL["Return sign-in error;<br/>record failed attempt"]
    FAIL --> LOGIN
    VALID -->|"Yes"| SESSION["Create signed session;<br/>return user and permissions"]
    SESSION --> DASH["Show dashboard for the user's role"]

    DASH --> TASK["User chooses a role-appropriate action"]
    TASK --> AUTHZ["Express checks session,<br/>RBAC permission and data scope"]
    AUTHZ --> ALLOWED{"Allowed?"}
    ALLOWED -->|"No"| DENY["Return access denied"]
    ALLOWED -->|"Yes"| ROUTE{"Data source?"}
    ROUTE -->|"Oracle-backed"| ORDS["Forward request to Oracle ORDS"]
    ORDS --> DB[("Oracle database")]
    ROUTE -->|"Locally managed"| JSON[("Local JSON data files")]
    DB --> RESULT["Return result to the app"]
    JSON --> RESULT
    RESULT --> DONE([User sees updated screen])

    DASH --> FIND["Patient browses doctors<br/>and available slots"]
    FIND --> SLOT{"Suitable slot available?"}
    SLOT -->|"No"| FIND
    SLOT -->|"Yes"| BOOK["Patient selects slot and consultation mode"]
    BOOK --> BOOKAUTH["Express checks session,<br/>booking permission and patient ownership"]
    BOOKAUTH --> BOOKORDS["Send booking request to Oracle ORDS"]
    BOOKORDS --> HELD[("Oracle creates a held appointment;<br/>booking metadata is saved locally")]
    HELD --> PAYMENT["Receptionist records payment"]
    PAYMENT --> PAYAUTH["Express checks permission"]
    PAYAUTH --> PAYORDS["Record payment through Oracle ORDS"]
    PAYORDS --> PAYOK{"Payment successful?"}
    PAYOK -->|"No"| HOLD["Appointment remains held<br/>until expiry or other action"]
    PAYOK -->|"Yes"| CONFIRM[("Oracle confirms the appointment")]
    CONFIRM --> TOKEN["Reception checks in patient<br/>and issues a queue token"]
    TOKEN --> CONSULT["Doctor updates queue status<br/>and records consultation"]
    CONSULT --> CLINICAL["Clinical service saves medical record<br/>and prescription to local JSON"]
    CLINICAL --> DONE
```

Appointment and payment requests go through the same authenticated and permission-checked backend path as other actions. The app records payments in its Oracle workflow; this diagram does not imply a separate external payment gateway.
