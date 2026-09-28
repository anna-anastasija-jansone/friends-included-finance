# Friends Included finance system

This is the Day 4 homework application for Friends Included Ltd. It is a small Vercel serverless application: no paid AI service is used.

## What it does

- accepts sales and expenses from the website and the Telegram webhook through the same server-side validation and calculation functions;
- stores source records in Supabase, including original proposals, final approvals, Telegram chat IDs, sync state, and notification state;
- calculates project and company results, including cent-safe commission rounding;
- updates one Google Sheets row per reference and can retry an incomplete sync;
- supports the five fictional demonstration roles, with permissions enforced by the API;
- gives Svetlana a manager area for Telegram account links, commission approval, allocation decisions, and retries.

## 1. Create Supabase

1. Create a new Supabase project.
2. Open **SQL Editor**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), and run it.
3. In Project Settings > API, copy the project URL and **service_role** key to Vercel environment variables. The key is server-side only; never place it in browser code.

## 2. Create Google Sheets

1. Create a spreadsheet with tabs named `Sales` and `Expenses`.
2. In Google Cloud, create a service account, enable the Google Sheets API, and create a JSON key.
3. Share the spreadsheet with the service-account email as **Editor**, and share it with your instructor as **Viewer**.
4. Add compact JSON key text to `GOOGLE_SERVICE_ACCOUNT_JSON` and the ID from the spreadsheet URL to `GOOGLE_SHEETS_ID`.

The application writes a header and then finds every row by reference. Approvals and sync retries update that row rather than appending another.

## 3. Deploy to Vercel

1. Create a GitHub repository, commit this project, and import it into Vercel.
2. Add every value from `.env.example` to Vercel Environment Variables. Use a strong `SETUP_SECRET`.
3. Deploy. Open the site and use **Set up demonstration roster** once, entering the setup secret. This creates the five fictional employees in Supabase.

## 4. Connect Telegram

1. Create a bot with BotFather and start a private chat with it.
2. Set its webhook to `https://YOUR-VERCEL-URL/api/telegram` and include Vercel's header secret (`X-Telegram-Bot-Api-Secret-Token`) with your `TELEGRAM_WEBHOOK_SECRET`.
3. In the site, switch to Svetlana and use **Telegram account links** to connect each Telegram numeric user ID to a fictional employee.

The bot accepts these commands:

```
/sale S01|Olivia Rose|A|One proud uncle and an emotional grandmother|1000|50|30|20
/expense E01|Rented suit and fake pearl necklace for the relatives|Materials|120|A
```

Sales command columns are reference, customer, A/B, description, amount, Richard %, Anastasia %, Jean-Claude %. Expense columns are reference, description, Materials/Travel/Other, amount, A/B/Company overhead.

## 5. Complete the homework tests

Clear practice records before Test 1. Use the bot for S01 and E01; use website demonstration roles for the remaining supplied records. Then make the stated Svetlana decisions. The dashboard is calculated from stored data, so it will show the supplied Test 1 and Test 2 answers only after the correct records and decisions exist.

## Local checks

Use Node 20 or newer:

```
npm test
```

Tests cover split validation, commission cent rounding, approval idempotency, and the published cumulative Test 2 figures.
