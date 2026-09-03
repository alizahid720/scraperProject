# LeadForge

LeadForge is a private business lead collection dashboard built with Next.js. It searches Google Places, stores collected leads in Neon Postgres, filters results by date and validation status, removes duplicates, and exports `.xlsx` workbooks.

## Vercel setup

1. Import this repository into Vercel.
2. Connect a Neon Postgres database from the Vercel Marketplace.
3. Add `GOOGLE_MAPS_API_KEY` as a Vercel environment variable.
4. Redeploy. The `leads` table and indexes are created automatically on the first API request.

## Local development

Copy `.env.example` to `.env.local`, configure the required values, then run:

```bash
npm install
npm run dev
```

Required environment variables:

- `DATABASE_URL`
- `GOOGLE_MAPS_API_KEY`
- `ABSTRACT_PHONE_API_KEY` (AbstractAPI Phone Validation API key)

Environment files are ignored and must never be committed.
