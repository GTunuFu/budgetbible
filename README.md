# Budget Bible

A personal budget dashboard that replaces the Budget Bible spreadsheet. It installs on your iPhone home screen.

- **SimpleFIN sync.** A daily, read-only pull of balances and transactions from your banks and cards.
- **Purchase-date budgeting.** Every purchase counts on the day you *bought* it. When a pending charge posts days later, or posts with a tip added, the app links the two instead of moving or double-counting the charge. If it isn't sure, it asks you with a "Same purchase?" card.
- **Swipe review.** New purchases show up as cards. Tap a category to file one, or swipe right to accept the suggested category. The app learns your merchants: after 3 confirmations it files that merchant automatically.
- **Recurring detection.** Subscriptions that charge about monthly are found automatically, and the app asks you to confirm each one.
- **Your own categories.** It starts with none. Type a new one right on a swipe card, or pick one you've made. Rename, merge or delete them in Settings.
- **Irregular income.** Built for freelance and startup pay. File deposits under income categories, and each month is planned around your 3-month average, last month, your leanest month, or a baseline you set. Freelance (1099) income has a tax set-aside taken off first. Home shows what you've earned against what the month costs, plus your runway in months.
- **Safe to spend.** Calculated as planned income − bills − recurring − what you've already spent this month, with a daily pace.
- **Payoff planner.** Two modes: "debt-free by X months → you need $Y/mo", or "I can pay $Y/mo → you're free in X months". It supports highest-APR-first and smallest-first, and checks the plan against your income.

## Deploy (about 15 minutes)

1. **Vercel → Add New → Project**, then import `budgetbible`.
2. Before the first deploy, open **Storage → Create → Neon (Postgres)** and connect it to the project. This sets `DATABASE_URL` for you.
3. Under **Settings → Environment Variables**, add:
   | Name | Value |
   |---|---|
   | `APP_PASSWORD` | the password you'll type to open the app |
   | `AUTH_SECRET` | 32+ random characters (`openssl rand -base64 32`) |
   | `CRON_SECRET` | another random string |
4. Deploy. Tables are created automatically on first load.
5. **SimpleFIN.** Sign up at https://beta-bridge.simplefin.org ($1.50/mo) and add your banks. Then choose **New app connection**, copy the setup token, open the app's **Accounts** tab, and paste it. The app pulls the last 90 days.
6. **Settings.** Enter your monthly bills and pick how income is planned. The first time money comes in, file it under a new income category on its swipe card.
7. **iPhone.** Open the site in Safari, tap **Share → Add to Home Screen**.

The daily sync runs at about 7:17am ET (see `vercel.json`). The **Sync now** button pulls on demand. SimpleFIN asks apps to stay under 24 pulls a day.

## Security notes
- Every page and API route requires your password. Sessions last 60 days.
- The SimpleFIN access key is encrypted with AES-256-GCM, using a key derived from `AUTH_SECRET`. If you change `AUTH_SECRET`, you'll need to reconnect SimpleFIN.
- No financial data lives in this repo. It's all in your Postgres database.

## Local dev
```
cp .env.example .env.local   # fill in
npm install && npm run dev
```
`scripts/test-sync.ts` runs the pending→posted matching engine against a local database with fake transactions.
