# Integration Plan

The dashboard currently uses browser `localStorage` through `dataAdapter`. When production connections are ready, replace or extend this adapter with API/database calls.

## Recommended Lead Payload

```json
{
  "section": "catering",
  "customer": "Alicia Morgan",
  "phone": "(919) 555-0182",
  "email": "alicia@example.com",
  "source": "Website form",
  "value": 720,
  "nextAction": "2026-05-03",
  "details": "Graduation party in Raleigh. 65 guests. Wants Birria and Pollo Loco.",
  "metadata": {
    "eventDate": "2026-05-10",
    "guests": 65,
    "items": ["Birria", "Pollo Loco", "Dessert empanadas"]
  }
}
```

## Valid Values

`section`:

- `catering`
- `frozen`
- `merch`

`status` defaults to `new` if omitted. Valid values:

- `new`
- `contacted`
- `quoted`
- `booked`
- `done`

## Connection Order

1. Add auth so only Mike/S4 can access the dashboard.
2. Add persistent database table/collection for leads.
3. Replace `dataAdapter.load()` and `dataAdapter.save()` with database calls.
4. Point the public website forms to `POST /api/leads` or a Make/Zapier webhook that writes to the database.
5. Set up Gmail/lead-email parser to send the same payload shape.
6. Add reminder automation for leads with `nextAction <= today` and `status !== done`.

## Suggested Database Fields

- `id`
- `section`
- `status`
- `customer`
- `phone`
- `email`
- `source`
- `value`
- `nextAction`
- `createdAt`
- `details`
- `notes`
- `metadata`

## Failure Handling

- If an incoming payload has an unknown `section`, default to `catering` and add a note for review.
- If `status` is missing, default to `new`.
- If `nextAction` is missing, default to tomorrow.
- Never discard the raw request body; store it in `metadata.raw` for debugging.
