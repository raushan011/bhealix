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
   - `read_discounts`
   - `write_discounts`

   > **`write_discounts` is what lets a partner create their own coupon code.** With it, a code a partner
   > mints in the partner portal is created in Shopify the same second and works at the checkout
   > immediately. Without it the code is still reserved to that partner — orders carrying it are still
   > attributed and still paid — but somebody has to create the discount in Shopify by hand before a
   > customer can use it. The CRM shows those codes as *Awaiting setup* on the Coupons screen rather
   > than pretending they work.
   >
   > If you already have a working connection, adding these two scopes needs a **release** and then
   > **Reconnect with Shopify** — Shopify only re-asks at the approval screen, so an existing
   > connection keeps whatever it was granted until somebody goes through it again.

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

### Two percentages that are not the same number

Each rule now carries a second figure, **customer gets**, beside the rate:

| | What it means | Who it is for |
|---|---|---|
| **Rate** | 30% | the share of the sale paid to the **partner** |
| **Customer gets** | ₹800 off, or 10% off | what the coupon takes off at the **checkout** |

They are routinely different, and the CRM has never needed the second one until now — it read what
Shopify charged and worked backwards. It needs it now because a partner minting their own code means the
CRM **creates** the discount rather than only reading it, and it cannot invent what the discount
should be.

> **Fill this in before partners start signing up.** A rule left at zero still pays commission exactly as
> before, but codes created under it are reserved and marked *Awaiting setup* instead of being made
> in Shopify. Nothing breaks; somebody just has to finish each one by hand.

## 6. Add your partners

There are two ways in, and they end at the same record.

**You add them: Partners → Add partner.** Give the name and a code — `RAUSHAN`. Add how they are paid
(UPI ID or bank details); this is copied onto their payout advice. Coupons are entered by hand here,
which means they must already exist in Shopify — this route reads codes, it does not create them.

**They add themselves: `/partner/register`.** Send them the link. They give their name, email, phone
and the code they want at the front of their coupons, and the application lands in **Waiting for a
decision** at the top of your Partners screen. See *The partner portal*, below.

> **Codes must match Shopify exactly.** That is still true, and it is what the two new scopes are
> for: a code a partner mints is created in Shopify by the CRM, so the two cannot drift. A code *you*
> type in on the Add partner form is not — create it in Shopify as you do today, and import it into the
> Fastrr checkout as you do today.

## 7. Run the first sync

Press **Sync now** on the overview.

It reads Shopify back 90 days by default (Settings → *first sync reaches back*), attributes anything
carrying one of your coupons, then asks Shiprocket about the parcels.

**Read the report it gives you.** It says how many orders it saw, how many it attributed, and — the
line that matters — any coupon code shaped like a partner's that belongs to nobody here. That is almost
always a code created in Shopify and never added to the CRM, and it means those orders are earning
nobody anything.

After that a nightly pass keeps it current (see *Scheduling*, below).

---

## What to check on the first real order

Worth doing once, deliberately, before you trust the numbers:

1. Take one recent order placed with a partner's code. Find it under **Orders**.
2. Confirm the **coupon code** shown is the partner's, and the partner's name is beside it.
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
negative adjustment on a later run, so the partner can see why their figure moved.

Anything that matured but was missed by an earlier run is swept into the next one, so nothing gets
stranded.

## The seven-day hold, and the hole it leaves

The hold exists because a delivered parcel can still come back. Seven days covers most of it, not all
of it. If a return lands after a commission has been paid, the order appears under **Needs reversal**
on the dashboard and nothing is deducted automatically — money already sent is recovered by
agreement, and a background job editing an approved payout is not that. Add it as a negative
adjustment on the next run.

Shortening the hold pays partners sooner and makes this more likely. Lengthening it does the reverse.

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

## The partner portal

Partners have their own application at **`/partner`**, on their own phone, behind their own sign-in.
Send them `/partner/register` and they do the rest.

### What a partner can do

- **Apply** — name, email, phone, and the code they want at the front of their coupons. The form
  suggests one from their name and refuses anything that would not work as half a discount code.
- **Create their own coupon codes.** They choose which of your published offers to take a code under
  and, optionally, add a word of their own: `PRIYA30`, or `PRIYAKIT30`. They cannot choose what the
  discount is — that is your rule — and they cannot mint a code that does not start with their own
  partner code, so nobody can create `DIWALI30` and collect on your campaign.
- **Follow every order their code brought in**, as a sequence rather than a status: placed → paid →
  dispatched (with the courier and waybill) → delivered → commission clears on a named date → paid.
  A parcel that came back closes the remaining steps off rather than leaving them looking pending.
- **See what they are owed**, split five ways — still on its way, clearing, ready to be paid, on the
  current run, already paid — instead of one friendly total that includes money on a parcel in
  transit.
- **See what they have been paid**, with the orders behind each payment as they stood on the day.
  Draft runs are never shown: a draft can still change, and a number that goes down after a partner has
  seen it costs more than the early sight was worth.
- **Keep their own payment details** — UPI or bank, and their PAN — and change their password.

### What has to happen before they can earn

**Nothing is granted by registering.** A new application is `Pending`: they can sign in and see that
they are waiting, and that is all. They cannot create a coupon, no order can be attributed to them,
and no money can accrue. A coupon code is an instruction to pay a named person a share of every
order carrying it — if filling in a form produced one, the first bot to find the URL would be on the
payroll.

**Partners → Waiting for a decision** is where you approve or turn one down. Turning one down asks
for a reason, and the reason is shown to them.

### Seeing everything about a partner

**Partners → click a name.** The record is shown in full and unabbreviated: name, code, email,
phone, how they want to be paid, their UPI ID or their complete bank account and IFSC, PAN, when
they applied, when they were approved, whether they signed themselves up, and when they last signed
in. Their coupon codes are listed with whether each one actually exists in Shopify, and every order
and rupee follows underneath.

The bank account is shown in full here, unlike on a payout advice where only the last four digits
appear. Different readers: an advice is a document that gets forwarded and printed, and this screen
belongs to the person who has to check the number before releasing money to it.

### Their password, and why you cannot see it

**You cannot, and neither can anybody else — including whoever holds the database.** What is stored
is a *bcrypt hash*: a one-way transformation with no plaintext behind it to read back. That is the
entire reason a leaked copy of this database is not a leaked set of accounts, and it is the same
choice the staff side has always made. It also matters for the partner personally — people reuse
passwords, and the one on this screen would quite possibly also open their email and their bank.

So the answer to "they are locked out" is to **give them a new one**:

**Partners → the partner → Portal login → Set a new password.** Leave the box empty and a memorable
one is generated — four short words, which survive a bad phone line and a phone keyboard where
`xK7#pQ2!` produces a second call. It is shown **once**, with a copy button. Read it to them, and ask
them to change it from their own profile afterwards.

> **This is also how a partner gets a login at all.** Everybody entered by hand before the portal
> existed has no password, and until now no way to be given one — their sign-in attempts were
> refused as though the password were wrong. The button reads *Create their login* for those people.

Every reset leaves a line in the audit trail naming who did it. The password itself is never written
to the trail, for the reason it is not shown anywhere else either.

### Deleting a partner

**Partners → the partner → Delete permanently**, at the bottom of the screen. It asks you to type
their code — RAUSHAN — because a checkbox gets clicked without being read, and the server checks it
too.

| | |
|---|---|
| **What goes** | the record, their login, and their coupon codes |
| **What stays** | their orders, which keep their name and coupon code so the revenue still reads correctly, and every payout advice already issued, which already carries their details |

Nothing about the money changes. What was earned was earned, and an advice for a payment that really
happened is evidence of it — deleting the person does not unmake either. Orders belonging to a
deleted partner show their name with *(deleted)* beside it rather than going blank.

> **Their codes are not switched off in Shopify by a delete.** Suspend them first if you want the
> discounts to stop working at the checkout — suspension is what talks to the shop, and once the
> record is gone so is the id it needs. The confirmation box says so if any code is still live.

### Suspending somebody

**Partners → the partner → Suspend.** They can no longer sign in, their codes stop attributing new
orders, and — the part nobody would think to do by hand — **their codes are switched off in
Shopify**, so the discount stops working on the storefront instead of quietly taking money off
orders that now credit nobody. Anything already earned is untouched, because it was earned.

If Shopify refuses to switch a code off, the screen says so and names the code. Switch that one off
in the shop yourself.

### Codes that are not in Shopify

**Coupons** counts these separately as *Not in Shopify*, and sorts them to the top. It is the worst
state a code can be in: the partner can see it in their portal and believes it works, while a customer
typing it at the checkout is refused.

Two ways to clear one, both on that row:

- **Create it in Shopify** — the usual fix once the missing scope has been granted or the rule's
  customer discount has been filled in.
- **It already exists there** — the answer when Shopify refused because the code was taken, which
  normally means somebody created it by hand first.

## Who can do what

| | Administrator | HR | Partner (their own portal) |
|---|:-:|:-:|:-:|
| See the Sales CRM, orders, earnings | ✓ | ✓ | own only |
| Add partners, issue coupons, correct a delivery | ✓ | | |
| Approve, turn down or suspend a partner | ✓ | | |
| See a partner's full record and bank details | ✓ | ✓ | own only |
| Set a partner's password / create their login | ✓ | | own only |
| Delete a partner permanently | ✓ | | |
| Create their own coupon code | ✓ | | ✓ once approved |
| Hold the Shopify/Shiprocket credentials and rates | ✓ | | |
| Prepare a payout run | ✓ | ✓ | |
| Approve it, mark it paid, delete a draft | ✓ | | |
| Change where their payout is sent | ✓ | | own only |

Medical representatives and field sales staff cannot reach any of it — the affiliate operation is a
different business from the field one, and `SALES` as a staff role has nothing to do with it.

**A partner is not an employee, and the two never meet.** Affiliates are not in the staff register: they
have no employee id, they never appear in the HR screens, and payroll cannot see them. Their sign-in
is a separate cookie with its own audience, so a partner token is refused by every staff route and a
staff token is refused by every partner route — a partner cannot reach `/admin` or `/employee` however
the role checks downstream are written, because there is no role check to get wrong.

Their standing is re-read from the database on **every** request rather than trusted from the token,
so a suspension takes effect on their next tap rather than whenever their session happens to expire.

## Reference

- How it all fits together: `docs/CODEBASE-MAP.md` §1, §6.15, §7.9, §8.8
- The commission arithmetic, with worked examples: `src/lib/sales/commission.ts` and its test
- Everything the sync does: `src/lib/sales/sync.ts`
- Who may sign in, and what a partner may call a coupon: `src/lib/sales/partners.ts` and its test
- An order told as a sequence: `src/lib/sales/tracking.ts` and its test
- Creating a discount in Shopify: `src/lib/sales/provision.ts`
- Why the affiliate session is a separate cookie: `src/lib/auth/partner.ts`
