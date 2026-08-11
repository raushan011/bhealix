# Sales CRM — setting it up

Everything the application needs is built. What is left is the part that lives in other people's
systems: a Shopify app, a Shiprocket API user, and the coupon codes themselves. This is that list, in
the order to do it.

Allow about twenty minutes.

---

## 1. Shopify: find your shop address

The CRM needs the **`.myshopify.com`** address, not your storefront domain. `www.bhealix.com` is the
customer-facing name pointed at the shop; the API only answers to the underlying one.

Two ways to find it:

- Look at the URL while you are in the Shopify admin: `admin.shopify.com/store/`**`your-handle`** —
  your shop address is `your-handle.myshopify.com`.
- Or **Settings → Domains**, where it is listed as the permanent domain.

Paste it into **Shop address**. (Pasting the whole URL is fine — it is reduced to the host.)

## 2. Shopify: create an app in the Dev Dashboard

> **Legacy custom apps are gone.** Shopify stopped allowing new ones on **1 January 2026** — the kind
> that handed you an `shpat_` token to paste into a box. Guides telling you to go to *Settings → Apps
> and sales channels → Develop apps* and press *Create an app* are describing a button that is no
> longer there; existing apps still work. Everything new is a **Dev Dashboard** app, which connects
> by approval rather than by a pasted token. The CRM does that handshake for you.

1. Go to **`dev.shopify.com`** → your organisation → **Apps** → **Create app**. Call it
   *BHEALIX Sales CRM*.
2. In the app's configuration, set the **Admin API scopes**:
   - `read_orders`
   - `read_products`

   > **Orders older than 60 days need `read_all_orders`**, which Shopify grants on request. Without
   > it a first sync reaching back 90 days quietly returns only the last 60 — the sync report's order
   > count is what shows you.

   > **Customer names and cities need protected customer data access**, requested in the same place.
   > Without it those fields come back empty. Nothing about the money depends on it: attribution is by
   > discount code and commission is by line total, so orders and payouts are correct either way —
   > the customer column is simply blank.
3. Set **both** URLs. The CRM's settings screen prints them with a copy button beside each:

   | | |
   |---|---|
   | **App URL** | `https://your-crm-address` |
   | **Redirect URL** | `https://your-crm-address/api/sales/shopify/callback` |

   > **They must share a host.** A new app's App URL defaults to `https://example.com`, and leaving it
   > there produces this at the approval screen, before anything of ours runs:
   >
   > ```
   > Oauth error invalid_request:
   > The redirect_uri and application url must have matching hosts
   > ```
   >
   > Setting only the redirect URL is not enough. Set both.

   Shopify will not accept a plain `http://localhost` for either — see *Connecting from a laptop*.
4. Turn **embedded** off. This CRM is its own site, not a panel rendered inside the Shopify admin;
   an embedded app is expected to load in an iframe and authenticate differently.
5. **Release a version**, or none of steps 2–4 are in force. The Versions page should show your new
   version as *Active* with the App URL you just set — if it still says `https://example.com`, the
   release did not happen.
6. From the app's **Settings** page, copy the **Client ID** and the **client secret**.

## 2a. Connecting from a laptop

Shopify only redirects back to an HTTPS address, so `http://localhost:3000` cannot complete the
handshake. Two ways round it:

- **Connect from the deployed site.** Simplest: set it up once wherever the CRM is hosted. The access
  token is stored in the database, so a local copy pointed at the same database is connected too.
- **Or tunnel.** `cloudflared tunnel --url http://localhost:3000` (or ngrok) gives an HTTPS address.
  Put that address in `NEXT_PUBLIC_APP_URL`, register its `/api/sales/shopify/callback` as the
  redirect URL, and connect through it.

Shiprocket has no such constraint — it works from localhost today.

## 3. Shiprocket: create an API user

Shiprocket refuses API logins from your ordinary account, so this must be a separate user.

1. Shiprocket panel → **Settings → API → Configure**.
2. **Create an API user** with its own email and password. Keep them.

## 4. Enter both in the CRM

Sign in as the administrator → you will be asked **Doctor CRM or Sales CRM** → choose **Sales CRM** →
**Settings**.

1. Shop address: `yourshop.myshopify.com` (paste the admin URL if easier — the handle is read out of it).
2. Paste the app's **Client ID** and **client secret**, then press **Connect with Shopify**. Shopify
   asks you to approve the scopes and sends you back; the access token is issued from that and stored
   encrypted. Press **Save & test** afterwards to confirm it names your shop.
3. Enter the Shiprocket API user's email and password. Press **Save & test**.

If you already hold an `shpat_` token from a legacy custom app, the *"I already have an shpat\_ token"*
section on that screen still accepts it — nothing downstream cares which way the token arrived.

**Save & test** stores the form and then tries the credentials, in that order — so what is tested is
always what is stored. The secret fields clear themselves afterwards, because a blank one means
"leave what is held alone" rather than "erase it".

Both credentials are encrypted before they are stored, and neither is ever sent back to a browser
afterwards. The screen will show that one is held and let you replace it.

## 5. Check the commission rules

The two rules you already run on are there by default:

| Suffix | Called | Rate | Applied to |
|---|---|---|---|
| `30` | Pigmentation kit | 30% | the lines that coupon discounted |
| `10` | Single product | 10% | the lines that coupon discounted |

"Applied to" is the part worth understanding. Shopify records, per line item, how much each discount
code took off it — so *the lines the coupon worked on* is a fact on the order, not a list you have to
maintain. Your `10` code that only works on one product pays on that product automatically.

Worked through, so you can check it against a real order:

```
Kit, MRP                     2,299
RAUSHAN30 takes off            800
Customer pays                1,499
Commission, 30% of 1,499    ₹449.70 → ₹450
```

Below that: **hold after delivery** (7 days) and **payout day** (Monday). Both are editable, and
changing a rate re-prices every commission not already on a payout run — it will tell you how many.

## 6. Add your reps

**Sales team → Add rep.**

Give the name and a code — `RAUSHAN`. The form shows you, live, the coupon codes it will create:
`RAUSHAN10` and `RAUSHAN30`. Add how they are paid (UPI ID or bank details) — this is copied onto
their payout advice.

> **These codes must match Shopify exactly.** The CRM does not create discount codes; it reads the
> ones on incoming orders. Create `RAUSHAN10` and `RAUSHAN30` in Shopify as you do today, and import
> them into the Fastrr checkout as you do today. The CRM's job starts when an order arrives carrying
> one.

## 7. Run the first sync

Press **Sync now** on the overview.

It reads Shopify back 90 days by default (Settings → *first sync reaches back*), attributes anything
carrying one of your coupons, then asks Shiprocket about the parcels.

**Read the report it gives you.** It says how many orders it saw, how many it attributed, and — the
line that matters — any coupon code shaped like a rep's that belongs to nobody here. That is almost
always a code created in Shopify and never added to the CRM, and it means those orders are earning
nobody anything.

After that a nightly pass keeps it current (see *Scheduling*, below).

---

## What to check on the first real order

Worth doing once, deliberately, before you trust the numbers:

1. Take one recent order placed with a rep's code. Find it under **Orders**.
2. Confirm the **coupon code** shown is the rep's, and the rep's name is beside it.
3. Confirm the **commission**: it prints as `30% of ₹1,499` so you can check the base, not just the
   total.
4. If the row says *"Shopify reported no per-line discount for this coupon, so the whole order was
   used as the base"* — tell me. It means Fastrr is pushing the discount to Shopify in a form that
   carries no line allocation, and the base should be narrowed to named products instead. The
   commission is still calculated, and the warning is there so it is never silent.
5. Confirm the **delivery state** matches what Shiprocket shows. If every order sits on `Awaiting`
   while Shiprocket clearly has them, the join is failing — see *When deliveries do not appear*.

## The life of one commission

```
order arrives with RAUSHAN30      →  Pending    (nothing owed yet)
Shiprocket says DELIVERED         →  Maturing   (owed, clears in 7 days)
7 days pass                       →  Payable    (swept into the next run)
payout run generated              →  In payout  (figure frozen)
run marked paid                   →  Paid
```

RTO, returned, cancelled, lost, or refunded in full at any point → **Void**, and nothing is owed.

## Paying people

**Payouts → Prepare a payout.** It proposes the period since the last run.

- **Work it out** writes nothing and shows exactly who would be paid what.
- **Generate run** creates it and claims those commissions.
- An administrator **approves**, then **marks it paid** with a date and reference.

Preparing and approving are deliberately different permissions — HR can prepare, only an
administrator releases. Once a run is **paid it cannot be reopened**; a correction is a named
negative adjustment on a later run, so the rep can see why their figure moved.

Anything that matured but was missed by an earlier run is swept into the next one, so nothing gets
stranded.

## The seven-day hold, and the hole it leaves

The hold exists because a delivered parcel can still come back. Seven days covers most of it, not all
of it. If a return lands after a commission has been paid, the order appears under **Needs reversal**
on the dashboard and nothing is deducted automatically — money already sent is recovered by
agreement, and a background job editing an approved payout is not that. Add it as a negative
adjustment on the next run.

Shortening the hold pays reps sooner and makes this more likely. Lengthening it does the reverse.

---

## Automation — what runs by itself

Three things keep this current without anybody uploading anything:

| | When | What |
|---|---|---|
| **Live updates** | Seconds | Shopify tells the CRM the moment an order is placed, changed or cancelled. Subscribed automatically when you connect. |
| **Nightly pass** | 01:30 daily | Pulls anything a live update missed, asks Shiprocket about every parcel still moving, and clears commissions whose hold has elapsed. |
| **Full resync** | On demand | Ignores the last run and reaches back over the whole backfill window. For repairs. |

**Sales settings → Automation** lists the last twenty passes with what each one did, so the schedule
can be seen working rather than assumed. It warns if the most recent scheduled pass is more than a
day and a half old.

The three overlap on purpose. A webhook delivered while the site is redeploying is lost, and the
nightly pass picks it up; the nightly pass failing is visible in that list rather than silent. A
manual upload is only ever needed for orders neither can see.

## Scheduling

`vercel.json` already schedules `GET /api/sales/cron` for 01:30 daily. Set **`CRON_SECRET`** in your
Vercel environment variables to any long random string and Vercel will present it automatically.

That pass syncs and then re-prices everything still open — which matters because a commission becomes
payable by the passage of time, not because anything happened to the order.

If you host somewhere else, call the same URL from any scheduler with
`Authorization: Bearer <CRON_SECRET>`. If you skip it entirely, nothing breaks: payout runs match on
the maturity date rather than on stored status, so they stay correct — the dashboard just shows
figures as of the last manual sync.

## When deliveries do not appear

Shiprocket joins orders on `channel_order_id`, and what it holds there depends on how your store was
connected — `#1042`, `1042`, or the numeric Shopify id are all in use. The CRM tries all three.

If every order stays on `Awaiting` while Shiprocket clearly has them, the join is failing on a fourth
format. Open one order in Shiprocket, look at what it calls the channel order, and tell me — it is a
one-line fix in `matchKeysFor` (`src/lib/sales/shiprocket.ts`).

In the meantime, **Orders → Correct** sets a delivery state by hand. It asks for a reason and records
who did it, and it beats whatever the courier's feed says.

## Who can do what

| | Administrator | HR |
|---|:-:|:-:|
| See the Sales CRM, orders, earnings | ✓ | ✓ |
| Add reps, issue coupons, correct a delivery | ✓ | |
| Hold the Shopify/Shiprocket credentials and rates | ✓ | |
| Prepare a payout run | ✓ | ✓ |
| Approve it, mark it paid, delete a draft | ✓ | |

Medical representatives and field sales staff cannot reach any of it — the affiliate operation is a
different business from the field one, and `SALES` as a staff role has nothing to do with it.

## Reference

- How it all fits together: `docs/CODEBASE-MAP.md` §1, §6.15, §7.9, §8.8
- The commission arithmetic, with worked examples: `src/lib/sales/commission.ts` and its test
- Everything the sync does: `src/lib/sales/sync.ts`
