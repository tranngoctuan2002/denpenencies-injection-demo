# Officely: presenting the DI case studies (≈30 min)

Start from a clean state: dev panel → **Reset shop data**, every case study **Fixed**, validation **on**.

| Time | Step |
|---|---|
| 0–3 | **Tour the store.** Add a mug and a hoodie, pay with Stripe, open Orders (Paid, cancellable for 15 s, then Shipped) and Inbox. Point at `ShopRegistration.AddShop()`: every service is registered once, with a lifetime. |
| 3–10 | **1 · Payment providers are hard-wired** |
| 10–15 | **2 · Orders and notifications depend on each other** |
| 15–21 | **3 · OrderService registered as a Singleton** |
| 21–26 | **4 · The shared team cart loses updates under load** |
| 26–30 | **Takeaways** in the dev panel, then questions |
| +12 | Optional, for a 45-minute slot: **5 · Scoped DbContext**, **6 · DbContext thread safety**, **7 · background job** (about 4 minutes each) |

## 1 · Payment providers are hard-wired (tight coupling, strategy selection)
1. Deploy **Broken**. Pay with **MoMo**: HTTP 500, `NotSupportedException`. Pay with Stripe: it works.
2. **Explain → Code**: `TightlyCoupledOrderService` calls `new StripePaymentProcessor()` inside an if/else.
3. *Ask:* "Product wants a fourth provider next sprint. What changes in each version?"
   *Answer:* broken means editing OrderService and its tests; fixed means one new class and one registration line.
4. Deploy **Fixed** and pay with MoMo. Try an unregistered provider through the API (`POST /api/checkout` with `"paymentProvider":"applepay"`): a clean 400 listing the supported providers.
5. *Principle:* DI supplies the implementations; the resolver decides which one to use.

## 2 · Orders and notifications depend on each other (circular dependency)
1. Deploy **Broken** with validation on: the store shows **"Officely failed to start"**, with the real `InvalidOperationException` cycle path.
2. Turn validation **off** (the Production default): the store starts, but Orders and checkout return HTTP 500. Same bug, found later.
3. *Ask:* "NotificationService needed one thing from OrderService. What was it, and who already had it?"
   *Answer:* the customer's e-mail address. OrderService had it, so it puts it in the `OrderCompleted` event.
4. Deploy **Fixed**. **Explain → Dependency graph**: the red cycle edge is gone.
5. *Caveat:* in-process dispatch is not durable. A crash after payment loses the e-mail; reliable delivery needs an outbox or a broker.

## 3 · OrderService registered as a Singleton (captive dependency)
1. Validation on, deploy **Broken**: startup fails with "Cannot consume scoped service 'ShopDbContext' from singleton 'IOrderService'".
2. Validation **off**, deploy again. Place an order and wait ~20 s (the 15 s cancellation window, then the next worker run): the Inbox says **"has shipped"**, while Orders still says **Paid** and keeps saying it.
3. *Why:* the Singleton captured one `ShopDbContext` forever. It tracks the order and returns its cached copy. It is also shared by concurrent requests and never disposed.
4. *Ask:* "FulfilmentWorker is a Singleton too. Why is it allowed to use ShopDbContext?"
   *Answer:* it doesn't keep one. It creates a scope for each run (`CreateAsyncScope`) and disposes it.
5. Deploy **Fixed** and turn validation back on.

## 4 · The shared team cart loses updates under load (race condition)
1. Deploy **Broken**. Add items by hand: everything looks fine.
2. **Simulate 100 buyers**: 100 real HTTP requests, all 204, and the mug quantity ends far below 100.
3. *Ask:* "Would registering the cart as Scoped fix it?"
   *Answer:* no. Every request would get its own empty cart. Lifetime decides how many instances exist, not thread safety.
4. Deploy **Fixed** and simulate again: nothing lost. With a database, use transactions, atomic updates or optimistic concurrency.

The team cart lives in memory, so every redeploy from the dev panel empties it, as a real deployment would.

## 5 · Every service gets its own DbContext (read and write with a Scoped DbContext)
1. The Shop page shows the Hoodie at **5 in stock**. Deploy **Broken**: no startup error, because validation sees nothing wrong.
2. Put 6 hoodies in the cart and pay: the order goes through. The Shop page still says **5 in stock**.
3. *Why:* `StockService` only tracks the stock change, and the order service's single `SaveChangesAsync` is meant to commit it together with the order. As Transient, each service has its own context, so nobody saves the stock.
4. *Ask:* "Would validation have caught this?" *Answer:* no. A Transient service inside a request is legal; the bug is about which changes belong to one unit of work.
5. Deploy **Fixed** and buy one hoodie: the stock drops.

## 6 · Cart lines are loaded in parallel on one DbContext (is DbContext thread-safe?)
1. Deploy **Broken**. With one product in the team cart, the cart page works.
2. Add a second product: HTTP 500, "A second operation was started on this context instance before a previous operation completed".
3. *Ask:* "The DbContext is Scoped. Isn't that safe?" *Answer:* Scoped means one per request, and every task you start inside that request shares it. A DbContext does one operation at a time.
4. Deploy **Fixed** (one query for all lines) and add two products again: it works. For real parallel work, use `IDbContextFactory` and give each task its own context.

## 7 · The fulfilment worker keeps one DbContext forever (Singleton background job)
1. Validation on, deploy **Broken**: startup fails, "Cannot consume scoped service 'ShopDbContext' from singleton 'IHostedService'".
2. Validation **off**, deploy again. Place an order, wait about 6 s, then press **Cancel** on the Orders page before the countdown ends.
3. Wait for the countdown: the order flips from **Cancelled** to **Shipped**, and the Inbox shows "cancelled" followed by "has shipped".
4. *Why:* the worker's captured DbContext tracked the order as Paid on an earlier run. It keeps handing back that stale copy, then saves it over the cancellation.
5. Deploy **Fixed** (a scope per run) with validation on and repeat: the order stays Cancelled.

## Final distinction
Dependency Injection helps construct and manage object graphs. Good architecture determines whether those dependencies are appropriate. Thread safety, transactional consistency, and reliable delivery require additional design decisions.
