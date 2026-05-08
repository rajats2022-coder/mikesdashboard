# Integration Plan

The dashboard is production-shaped now: it loads from `GET /api/leads`, posts manual entries to `POST /api/leads`, and only uses browser `localStorage` as an offline fallback if the live endpoint is unavailable.

## Recommended Lead Payload

```json
{
  "section": "catering",
  "customer": "Customer Name",
  "phone": "(984) 000-0000",
  "email": "customer@example.com",
  "source": "Website form",
  "value": 0,
  "nextAction": "2026-05-10",
  "details": "Customer request details, event notes, order items, or follow-up context.",
  "metadata": {
    "eventDate": "2026-05-10",
    "guests": 0,
    "items": []
  }
}
```

## Valid Values

`section`:

- `catering`
- `frozen`
- `merch`

`status` defaults to `new` if omitted. Valid dashboard values:

- `new`
- `contacted`
- `quoted`
- `booked`
- `done`

The Supabase submissions table stores status as `new`, `contacted`, `completed`, or `archived`; `/api/leads` maps those into dashboard stages.

## Connection Order

1. Add production Supabase env vars to the live host.
2. Run the existing S4 AI Agency Supabase migration.
3. Add Mike and S4 admin emails to `dashboard_users`.
4. Point website forms/orders to the server routes.
5. Test one real submission and confirm it appears in the dashboard.
6. Add reminder automation for leads with `nextAction <= today` and `status !== done`.

## Suggested Database Fields

The current Supabase-backed source of truth is `client_form_submissions`:

- `id`
- `client_id`
- `form_type`
- `customer_name`
- `customer_email`
- `customer_phone`
- `message`
- `order_interest`
- `event_date`
- `status`
- `created_at`

## Failure Handling

- If an incoming payload has an unknown `section`, default to `catering`.
- If `status` is missing, default to `new`.
- If `nextAction` is missing, use the event/submission date when available.
- Never put the Supabase service role key in frontend JavaScript.
