# Current Database ER Diagram

This is a **logical ER diagram** based on the current table inventory, API types, IDs, and joins used in the ORDS scripts. The repository contains handler scripts and migrations rather than the complete table-creation DDL, so confirm actual Oracle constraints before relying on these relationships for database changes.

```mermaid
erDiagram
    GIRISH_DEPARTMENTS {
        NUMBER department_id PK
        VARCHAR2 department_name
    }
    GIRISH_CONSULTATION_TYPES {
        NUMBER consultation_type_id PK
        NUMBER department_id FK
    }
    GIRISH_DOCTORS {
        NUMBER doctor_id PK
        NUMBER department_id FK
        VARCHAR2 first_name
        VARCHAR2 last_name
    }
    GIRISH_DOCTOR_LEAVES {
        NUMBER leave_id PK
        NUMBER doctor_id FK
        NUMBER requested_by FK
        NUMBER approved_by FK
    }
    GIRISH_SLOT_TEMPLATES {
        NUMBER template_id PK
        NUMBER doctor_id FK
        NUMBER consultation_type_id FK
    }
    GIRISH_SLOTS {
        NUMBER slot_id PK
        NUMBER template_id FK
        DATE slot_date
        VARCHAR2 status
    }
    GIRISH_PATIENTS {
        NUMBER patient_id PK
        VARCHAR2 first_name
        VARCHAR2 last_name
        VARCHAR2 email
    }
    GIRISH_APPOINTMENTS {
        NUMBER appointment_id PK
        NUMBER patient_id FK
        NUMBER slot_id FK
        NUMBER rescheduled_from_id FK
        VARCHAR2 status
        VARCHAR2 consultation_mode
    }
    GIRISH_PAYMENTS {
        NUMBER payment_id PK
        NUMBER appointment_id FK
        VARCHAR2 payment_ref
        NUMBER amount
        VARCHAR2 status
    }
    GIRISH_TOKEN_QUEUE {
        NUMBER queue_id PK
        NUMBER appointment_id FK
        NUMBER department_id FK
        NUMBER token_number
        VARCHAR2 status
    }
    GIRISH_CANCELLATION_RULES {
        NUMBER rule_id PK
        VARCHAR2 rule_name
    }
    GIRISH_USERS {
        NUMBER user_id PK
        NUMBER doctor_id FK
        NUMBER patient_id FK
        VARCHAR2 email
        VARCHAR2 full_name
    }
    GIRISH_ROLES {
        NUMBER role_id PK
        VARCHAR2 role_name
    }
    GIRISH_USER_ROLES {
        NUMBER user_id PK, FK
        NUMBER role_id PK, FK
    }
    GIRISH_PERMISSIONS {
        NUMBER permission_id PK
        VARCHAR2 permission_name
    }
    GIRISH_ROLE_PERMISSIONS {
        NUMBER role_id PK, FK
        NUMBER permission_id PK, FK
    }
    GIRISH_APPROVAL_TYPES {
        NUMBER approval_type_id PK
        VARCHAR2 approval_type_name
    }
    GIRISH_APPROVAL_REQUESTS {
        NUMBER request_id PK
        NUMBER approval_type_id FK
        NUMBER requested_by FK
        NUMBER assigned_to FK
        VARCHAR2 target_table
        NUMBER target_record_id
    }
    GIRISH_APPROVAL_HISTORY {
        NUMBER history_id PK
        NUMBER request_id FK
        NUMBER action_by FK
    }
    GIRISH_AUDIT_CONFIG
    GIRISH_AUDIT_LOGS {
        NUMBER audit_id PK
        NUMBER user_id FK
        VARCHAR2 table_name
        VARCHAR2 action_name
    }
    GIRISH_ERROR_LOG
    GIRISH_ERROR_LOGS {
        NUMBER error_id PK
    }

    GIRISH_DEPARTMENTS ||--o{ GIRISH_DOCTORS : has
    GIRISH_DEPARTMENTS ||--o{ GIRISH_CONSULTATION_TYPES : offers
    GIRISH_DOCTORS ||--o{ GIRISH_DOCTOR_LEAVES : requests
    GIRISH_USERS o|--o{ GIRISH_DOCTOR_LEAVES : requests_or_approves
    GIRISH_DOCTORS ||--o{ GIRISH_SLOT_TEMPLATES : defines
    GIRISH_CONSULTATION_TYPES o|--o{ GIRISH_SLOT_TEMPLATES : used_for
    GIRISH_SLOT_TEMPLATES ||--o{ GIRISH_SLOTS : generates
    GIRISH_PATIENTS ||--o{ GIRISH_APPOINTMENTS : books
    GIRISH_SLOTS ||--o{ GIRISH_APPOINTMENTS : is_booked_for
    GIRISH_APPOINTMENTS ||--o{ GIRISH_PAYMENTS : has
    GIRISH_APPOINTMENTS ||--o| GIRISH_TOKEN_QUEUE : enters
    GIRISH_DEPARTMENTS ||--o{ GIRISH_TOKEN_QUEUE : organizes
    GIRISH_APPOINTMENTS o|--o{ GIRISH_APPOINTMENTS : rescheduled_from
    GIRISH_DOCTORS o|--o| GIRISH_USERS : linked_login
    GIRISH_PATIENTS o|--o| GIRISH_USERS : linked_login
    GIRISH_USERS ||--o{ GIRISH_USER_ROLES : assigned
    GIRISH_ROLES ||--o{ GIRISH_USER_ROLES : granted_to
    GIRISH_ROLES ||--o{ GIRISH_ROLE_PERMISSIONS : includes
    GIRISH_PERMISSIONS ||--o{ GIRISH_ROLE_PERMISSIONS : assigned_to
    GIRISH_APPROVAL_TYPES ||--o{ GIRISH_APPROVAL_REQUESTS : categorizes
    GIRISH_USERS ||--o{ GIRISH_APPROVAL_REQUESTS : requests
    GIRISH_USERS o|--o{ GIRISH_APPROVAL_REQUESTS : assigned_to
    GIRISH_APPROVAL_REQUESTS ||--o{ GIRISH_APPROVAL_HISTORY : tracks
    GIRISH_USERS o|--o{ GIRISH_APPROVAL_HISTORY : acts_on
    GIRISH_USERS o|--o{ GIRISH_AUDIT_LOGS : generates
```

`GIRISH_CANCELLATION_RULES`, `GIRISH_AUDIT_CONFIG`, and the two error-log tables are included because they exist in the current database table list; no direct relationship for them is shown where the application scripts do not establish one. Approval request `target_table` and `target_record_id` identify different kinds of records, so they are not modeled as a normal foreign key.
