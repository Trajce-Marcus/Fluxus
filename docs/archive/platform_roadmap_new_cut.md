# Platform Operational Reference & Architectural Roadmap

> **ARCHIVED 2026-07-27 — not a current design doc.** This was an independently
> written, outside-in sketch of the platform, reviewed against the real design
> on 2026-07-27. It served its purpose: the review sharpened the
> solution-packaging direction (releases, pinning, connectors) and produced
> [../BLUEPRINT.md](../BLUEPRINT.md), which supersedes this file. Where this
> doc disagrees with BLUEPRINT / ARCHITECTURE / GLOSSARY, they win — notably:
> pages are interpreted, not compiled to Web Components; workflows run
> synchronously through the activity pipeline, not via an async job worker;
> and its "Namespace" concept maps to solution/operation ids.

## I. Architectural Component Matrix

| Structural Domain | Component Name | Functional Responsibility | Execution Layer |
| :--- | :--- | :--- | :--- |
| **User Interface** | **Console** | System administration, third-party development, solution building, client onboarding, and RBAC mapping. | Client-side App |
| | **Runtime** | Lightweight shell application that lazy-loads and renders compiled solution pages for operational end-users. | Client-side App |
| **Data Engine** | **Transactional DB** | Fast-write database storing active data objects dynamically as JSON payloads. | Data Layer |
| | **Reporting DB** | Read-optimized relational database that flattens JSON records into structured tables based on the SDM schema. | Analytical Layer |
| **Business Logic** | **Shared Data Model (SDM)**| The central structural anchor. Manages namespaces, data validation schemas, and automated trigger maps. | Core Engine |
| | **Workflow Engine** | Server-side job worker that listens for events (e.g., state changes) and processes headless, sequential steps. | Server-side Layer |
| | **Platform DSL Engine** | Universal hybrid execution interpreter. Evaluates mathematical expressions, runs logical scripts, and parses data filters. | Hybrid (Client & Server) |

## II. Foundational Design Principles
*   **Dual-Database CQRS Strategy**: Separating rapid-change application logic from heavy data analytical reporting. Live records are handled as flexible JSON inputs via a **Transactional DB**, which are then flattened into a relational schema inside a **Reporting DB** for complex querying, ensuring high-speed writes never conflict with heavy data processing.
*   **Isolated Namespaced Evolution**: To prevent monolithic codebase expansion, each Solution owns its independent, sandboxed SDM. Schema adaptations, field upgrades, and custom business rules are tightly bounded by unique string **Namespaces**, allowing multiple vertical market tools to evolve separately without cross-breaking data structures.
*   **Boundary Contract Integration**: Solutions connect to one another through explicit input/output contracts rather than directly sharing or inheriting database tables. Universal utilities (such as a generic billing engine) expose fixed schema requirements that external operational solutions map data into via automated workflows, preserving total database isolation.
*   **Declarative Record Type Mapping**: Cross-solution boundaries are linked via passive data-translation blueprints focused strictly on **Record Type** formatting. This layer translates data schemas between independent namespaces at the perimeter, while localized workflows handle the actual transactional updates and execution logic internally.
*   **Cross-Solution Pub/Sub Integration**: Independent, distinct vertical solutions communicate asynchronously via an event broker. Headless server-side workflows can broadcast and subscribe to platform-wide telemetry hooks, allowing an operational business unit to securely stitch separate solutions together into a unified operational ecosystem.
*   **Unified Hybrid Platform DSL**: The platform utilizes a specialized Domain-Specific Language (DSL) that serves as a hybrid between declarative query syntax (SQL) and procedural logic scripting (JavaScript). This language serves as the universal engine for evaluating expressions, manipulating variables, updating fields, and executing logical branches natively across both client-side Pages and server-side Workflows.
*   **Decoupled Functional Components**: UI components do not contain localized business logic or explicit database paths. They expose pure data input requirements (Props) and output triggers (Callbacks), rendering them completely environment-agnostic and infinitely reusable across different solutions.
*   **Web Component/React Compilation**: Pages are built using predefined elements that compile down into standalone JavaScript bundles (**React components mapped to Web Components**). The Runtime app acts as a highly scalable, lightweight shell that lazy-loads these static UI bundles on demand.
*   **Decoupled Configuration Layer**: Menus, navigation blocks, and role-based access controls are treated as independent operational metadata. This allows an Organization to completely customize their daily environment layout within the Runtime without altering the underlying Solution code.

## III. Component Lifecycle and Versioning
*   **Decoupled Version Alerts**: When an updated version of a Component becomes available on the platform, its presence is broadcasted systematically within the system interface. 
*   **Owner Autonomy**: The Solution or Page owner retains complete control over the upgrade lifecycle. No automated updates are forced on active layouts; the owner decides whether to adopt the new version or remain on the existing stable release based on their operational readiness.

## IV. Core System Glossary

*   **Platform**: The foundational multi-tenant cloud infrastructure that hosts the development tools, runtime environment, and data storage.
*   **Organization**: A commercial subscriber entity (e.g., a water maintenance enterprise) utilizing the platform to run business operations.
*   **3rd Party Solution Provider**: An independent developer or agency that builds packaged solutions on the platform to monetize via revenue share.
*   **Solution**: A deployable, version-tagged package containing an SDM definition, visual pages, and automated workflows built to solve a specific industry problem.
*   **Operation**: A deployed, sandboxed instance of a specific Solution version assigned to an Organization, wrapped in custom menus and access rules.
*   **Namespace**: A unique system-wide text identifier that sandboxes a Solution’s data schema and workflows, ensuring complete isolation from other installed tools.
*   **Page**: A discrete visual user interface built via predefined layout components, compiling down to a standalone Web Component / React JS bundle.
*   **Component**: An isolated UI block (e.g., Job Scheduler) that handles visual layout and user interactions, exposing only data input properties and callback events with no awareness of the broader platform data structures.
*   **Component Container**: The visual wiring layer inside the Page Builder used to map a Component’s data props and callbacks directly to the variables and fields housed within the Shared Data Model (SDM).
*   **Solution Connector**: A passive data-translation wiring layer inside the Console used exclusively to map and convert record fields between two separate **Record Types** belonging to distinct Solution Namespaces based on an established Boundary Contract.
*   **Boundary Contract**: An explicit, documented data shape exposed by a Solution that outlines the required fields and events another Solution must provide to interact with it safely.
*   **Platform DSL**: A hybrid SQL/JavaScript domain-specific language used within the system to query, filter, and write data blocks or evaluate logic workflows programmatically.
*   **Workflow (WF)**: An automated, non-interactive sequence of server-side operational steps executed asynchronously via system triggers.
*   **Record Type**: A custom data structure blueprint defined within a Solution's SDM (e.g., a "Maintenance Job Ticket").
*   **Record**: A single transactional entry instance, stored initially as raw JSON, representing a live operational data point.
