import type { CaseStudy } from '../api'

export interface CaseStudyInfo {
  id: Exclude<CaseStudy, 'None'>
  number: number
  title: string
  area: string
  tryIt: string[]
  symptom: string
  why: string
  fix: string
  principle: string
  notes: string[]
}

export const caseStudies: CaseStudyInfo[] = [
  {
    id: 'Payments',
    number: 1,
    title: 'Payment providers are hard-wired',
    area: 'Checkout · tight coupling & strategy selection',
    tryIt: [
      'Switch this case study to Broken.',
      'Put something in the team cart and pay with MoMo: HTTP 500.',
      'Pay with Stripe or PayPal: it works, because OrderService has an if-branch for those two.',
    ],
    symptom:
      'The frontend shipped the new MoMo button, but checkout with MoMo fails with NotSupportedException. Supporting it means editing, re-testing and redeploying OrderService.',
    why:
      'OrderService creates its payment processors with `new` and picks one with if/else. It depends on concrete infrastructure classes, so every new provider changes business logic, and a unit test cannot swap in a fake processor.',
    fix:
      'Define IPaymentProcessor and register one implementation per provider. PaymentProcessorResolver receives IEnumerable<IPaymentProcessor> through its constructor and selects one by name: case-insensitive, unknown providers get a clear 400, duplicates fail fast. A new provider is one class and one registration line.',
    principle:
      'Depend on abstractions. DI supplies the implementations; the resolver decides which one to use. Choosing a provider is a separate responsibility from placing an order.',
    notes: [
      'No service locator: the resolver gets its processors through the constructor and never calls IServiceProvider.',
      'Keyed services ([FromKeyedServices("stripe")]) suit a key that is fixed at compile time. Here the provider arrives with each request, so a resolver fits better.',
    ],
  },
  {
    id: 'Notifications',
    number: 2,
    title: 'Orders and notifications depend on each other',
    area: 'Order confirmation e-mail · circular dependency',
    tryIt: [
      'With validation on, switch to Broken: the shop does not start at all.',
      'Turn validation off (the Production default) and switch again: the shop starts.',
      'Open Orders or check out: HTTP 500, "A circular dependency was detected".',
    ],
    symptom:
      'The container cannot build IOrderService. With ValidateOnBuild the deployment fails at startup; without it, every request that needs orders fails.',
    why:
      'OrderService needs NotificationService to send the confirmation, and NotificationService needs IOrderService to look up the customer\'s e-mail. To build either one the container must first build the other. Constructor injection cannot satisfy a cycle, and the cycle signals that each service owns part of the other\'s job.',
    fix:
      'OrderService publishes an OrderCompleted event that already carries the order id, e-mail and total. OrderConfirmationEmailHandler reacts to it and never needs the order service, so every arrow points one way.',
    principle:
      'A circular dependency is a responsibility problem, not a container problem. Pass the data that is needed (in an event or a parameter) instead of injecting the service that owns it.',
    notes: [
      'The dispatcher is in-process. If the process crashes after the payment but before the handler runs, the e-mail is lost. Guaranteed delivery needs a transactional outbox or a message broker; this refactor does not provide that.',
      'Lazy<T> or resolving from IServiceProvider inside a method would hide the cycle, not remove it.',
    ],
  },
  {
    id: 'Lifetimes',
    number: 3,
    title: 'OrderService registered as a Singleton',
    area: 'Orders & fulfilment · captive dependency',
    tryIt: [
      'With validation on, switch to Broken: startup fails with "Cannot consume scoped service".',
      'Turn validation off and switch again: the shop starts.',
      'Place an order and wait about 20 seconds (15 s cancellation window + the next worker run): the Inbox gets "has shipped", but the Orders page keeps saying Paid.',
    ],
    symptom:
      'With validation off, the shop shows stale data: the fulfilment worker shipped the order and e-mailed the customer, but the Orders page shows "Paid" forever.',
    why:
      'A Singleton is created once and keeps its constructor arguments for the life of the app, so it captured one ShopDbContext. That context tracks every order it has seen and returns its cached copy instead of the new database values. It is also shared by concurrent requests although DbContext is not thread-safe, and it never gets disposed.',
    fix:
      'Fix 1: give OrderService the same lifetime as what it uses (Scoped). Fix 2: when the consumer must be a Singleton, like the FulfilmentWorker BackgroundService, inject IServiceScopeFactory, CreateAsyncScope() for each unit of work, resolve ShopDbContext inside it, and let `await using` dispose it.',
    principle:
      'A Captive Dependency is a longer-lived service holding a shorter-lived one beyond its intended lifetime. A Singleton may still use scoped services if it creates the scope, uses them, and disposes the scope.',
    notes: [
      'Turn on ValidateScopes and ValidateOnBuild in every environment. ASP.NET Core enables them only in Development, which is how this bug reaches Production.',
      'Singleton → Transient is not flagged by validation, but the transient is captured the same way.',
    ],
  },
  {
    id: 'Cart',
    number: 4,
    title: 'The shared team cart loses updates under load',
    area: 'Team cart · race condition in a Singleton',
    tryIt: [
      'Switch to Broken. Adding items by hand still works: it only breaks under load.',
      'Click "Simulate 100 buyers": 100 real HTTP requests each add one Team Mug at the same moment.',
      'Compare expected and actual quantity, then open the team cart.',
    ],
    symptom: 'Everyone got HTTP 204, but most of the mugs never made it into the cart. No exception, no log entry.',
    why:
      'The Singleton cart is shared by all request threads. AddAsync reads the quantity, awaits the warehouse stock check, then writes quantity + 1. While one request waits, others read the same old value, so each writes a stale result. ConcurrentDictionary makes each call safe, not the read-modify-write sequence.',
    fix:
      'Do the slow stock check first, then update the quantity under one lock. Every read and write of the quantities uses the same lock.',
    principle:
      'A lifetime decides how many instances exist, not whether they are thread-safe. Shared mutable state needs an explicit owner and explicit synchronization.',
    notes: [
      'Making the cart Scoped would not fix it: each request would get its own empty cart, so the shared data disappears instead of being protected. Keep request-specific state scoped, and never store current-user state in a Singleton.',
      'Once the cart lives in a database, Scoped services still race on the same rows. Use transactions, atomic updates (UPDATE … SET Qty = Qty + 1) or optimistic concurrency (a row version).',
      'The number of lost updates varies between runs and machines. The automated test forces the overlap, so it fails deterministically.',
    ],
  },
  {
    id: 'UnitOfWork',
    number: 5,
    title: 'Every service gets its own DbContext',
    area: 'Checkout & stock · read and write with a Scoped DbContext',
    tryIt: [
      'On the Shop page, note the Hoodie stock: 5.',
      'Switch to Broken. Validation stays quiet: nothing is wrong with the lifetimes as far as the container can tell.',
      'Buy hoodies: the orders go through, but the stock never goes down. Keep buying and you sell hoodies you do not have.',
    ],
    symptom: 'Orders are saved but the stock changes are silently lost, so the shop oversells. No error anywhere.',
    why:
      'StockService only tracks the stock change. OrderService\'s SaveChangesAsync is meant to commit the new order and the lower stock as one unit of work, which only works if both services hold the same ShopDbContext. Registered as Transient, each service gets its own: OrderService saves its own changes, and nobody ever saves StockService\'s.',
    fix:
      'Keep the DbContext Scoped (the AddDbContext default): one instance per request, shared by every service in that request, disposed when the request ends. One SaveChangesAsync then commits everything the request changed, in one transaction.',
    principle: 'A Scoped DbContext is the request\'s unit of work. Its lifetime decides which changes are saved together.',
    notes: [
      'Validation does not flag this: a Transient service inside a request is perfectly legal. The container cannot catch every lifetime mistake.',
      'Two contexts also mean two connections and two transactions: a crash between them leaves half of the work saved.',
      'Two simultaneous checkouts can still sell the last hoodie twice. Protect stock with a database constraint or optimistic concurrency (a row version).',
    ],
  },
  {
    id: 'ThreadSafety',
    number: 6,
    title: 'Cart lines are loaded in parallel on one DbContext',
    area: 'Team cart · is DbContext thread-safe?',
    tryIt: [
      'Switch to Broken.',
      'With one product in the team cart, the cart page works.',
      'Add a second product: the cart page fails with HTTP 500, "A second operation was started on this context instance".',
    ],
    symptom: 'The team cart breaks as soon as it holds two different products. Every test with one product passed.',
    why:
      'To load the page faster, each cart line is looked up in its own task with Task.WhenAll. All the tasks use the request\'s single ShopDbContext. A DbContext runs one operation at a time and is not thread-safe; EF Core sees the second query start while the first is still running and throws.',
    fix:
      'Load every product in one query: one round trip, which is faster anyway. If work really has to run in parallel, give each task its own context from IDbContextFactory<ShopDbContext> and dispose it when the task is done.',
    principle: 'One DbContext = one unit of work = one operation at a time. Never share a DbContext between concurrent tasks or threads.',
    notes: [
      'Scoped does not mean thread-safe: everything inside one request shares the scoped instance, including tasks you start yourself.',
      'EF Core\'s check is best-effort. When it misses, concurrent use corrupts the change tracker silently.',
      'Officely adds 15 ms of simulated latency to every query (SimulatedLatencyInterceptor), so queries behave like a real database server instead of local SQLite, which answers instantly.',
    ],
  },
  {
    id: 'BackgroundJob',
    number: 7,
    title: 'The fulfilment worker keeps one DbContext forever',
    area: 'Fulfilment · a Singleton background job holds a Scoped service',
    tryIt: [
      'With validation on, switch to Broken: startup fails with "Cannot consume scoped service ... from singleton IHostedService".',
      'Turn validation off and switch again: the shop starts, and orders still ship.',
      'Place an order, wait about 6 seconds (the worker has now seen it), then press Cancel on the Orders page before the countdown ends.',
      'Wait for the countdown: the cancelled order ships anyway, and the customer gets "has shipped" right after "cancelled".',
    ],
    symptom: 'A cancelled order was shipped, and its status was overwritten from Cancelled to Shipped.',
    why:
      'A BackgroundService is a Singleton, so the ShopDbContext injected into its constructor lives as long as the app. The worker loaded the order as Paid on an earlier run, and that context keeps handing back its tracked copy instead of the cancelled row in the database. The worker then saves its stale copy over the customer\'s cancellation.',
    fix:
      'Inject IServiceScopeFactory and create a fresh scope for every run with CreateAsyncScope(). Resolve ShopDbContext and IEmailSender inside it; `await using` disposes them when the run ends, so every run reads current data.',
    principle:
      'A Singleton may use scoped services, but only inside a scope it creates and disposes for each unit of work. Never keep them in a field.',
    notes: [
      'The same rule as case 3, and background jobs are where it bites hardest: they live forever and run outside any HTTP request.',
      'The captured context also grows forever, because it tracks every order it has ever loaded, and it is never disposed.',
      'Optimistic concurrency (a row version on Order) would turn the silent overwrite into an error you can handle.',
    ],
  },
]

export const takeaways = [
  'Prefer constructor injection for required dependencies.',
  'Depend on abstractions where they create useful boundaries.',
  'Use a factory or strategy resolver when implementation selection is a distinct responsibility.',
  'Keep the dependency graph understandable and avoid circular dependencies.',
  'Choose service lifetimes based on ownership, state, and intended usage.',
  'Avoid Captive Dependencies.',
  'Use IServiceScopeFactory when a Singleton background worker needs scoped services.',
  'Do not assume a Singleton is thread-safe.',
  'Avoid mutable shared state unless synchronization and ownership are explicit.',
  'Avoid using IServiceProvider as a general-purpose service locator in business logic.',
  'Use interfaces, fakes, and automated tests to verify behavior.',
  'Remember that DI does not replace transaction management, concurrency control, idempotency, or reliable messaging.',
]

export const finalDistinction =
  'Dependency Injection helps construct and manage object graphs. Good architecture determines whether those dependencies are appropriate. Thread safety, transactional consistency, and reliable delivery require additional design decisions.'
