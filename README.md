# Deltapath API Mapper

Local web application that authenticates with a Deltapath UC 5.3.1 REST server and maps accessible API areas as an interactive flowchart.

## Read-only guarantee

- The discovery list contains only GET list/view endpoints.
- The app does not call create, update, delete, restart, reboot, backup, restore, or configuration endpoints.
- The runtime rejects any discovery probe whose method is not GET.
- It requests a temporary API token, probes the server, and attempts to expire that token immediately afterward.

## Run

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

Credentials are transmitted only to the configured Deltapath server through the local backend and are never written to disk or included in exported JSON.
