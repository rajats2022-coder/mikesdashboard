# Mike Nice Command Center

Private operating dashboard for Mike Nice Empanadas.

Live purpose: help Mike organize incoming catering leads, frozen empanada orders, and merch requests in one operating dashboard.

## What Is Included

- Overview dashboard with 3 command panels: Catering, Frozen Empanadas, Merch
- Lead inbox for new notifications
- Follow-up queue based on next action dates
- Separate boards for Catering, Frozen Empanadas, and Merch
- Action stages: New, Contacted, Quoted, Booked, Done
- Add Lead modal
- Lead detail drawer with move forward/back, follow-up, and done actions
- Business settings for SLA, minimum guests, deposit, pickup days, phone, email
- Connections page showing what needs to be wired for production
- Export/import JSON so data can be moved before a real database is attached
- Browser localStorage adapter now, API/database adapter hook ready later
- Auto-refresh loop checks for new orders every 60 seconds, on app focus, and through a manual Refresh button

## Production Readiness Notes

This app is designed so connections can be added without redesigning the UI.

Before giving this to Mike as a real private production dashboard, add:

1. Authentication: Vercel Password Protection, Clerk, Supabase Auth, Firebase Auth, or Cloudflare Access.
2. Database: Supabase, Firebase, Airtable, or a custom backend.
3. Form/webhook wiring from the website booking forms. The dashboard already attempts `GET /api/leads` every 60 seconds and `POST /api/leads` for new leads, then falls back to local storage until that endpoint exists.
4. Email parser or Gmail/Make/Zapier flow for lead notification emails.
5. Optional SMS/email reminder automation for overdue follow-ups.

## Local Run

No build step is required.

```bash
python3 -m http.server 4173
```

Open:

```text
http://127.0.0.1:4173/
```

## Integration Contract

See `docs/INTEGRATIONS.md` for the recommended payload shape and connection plan.
