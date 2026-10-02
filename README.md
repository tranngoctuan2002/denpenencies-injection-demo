# Dependency Injection live demo (ASP.NET Core / .NET 10)

One realistic feature - **Place Order** - used to show the DI technique, the three lifetimes and seven case studies.

## Prerequisites (new machine)
- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) (`dotnet --version` should print 10.x)
- Docker Desktop, running (needs ~3 GB free disk for the SQL Server image, **x64 / amd64 image** - on Apple Silicon enable Rosetta emulation in Docker Desktop)
- Ports **1433** (SQL Server) and **5000** (app) free

### About .NET versions (read this if the machine already has .NET 8)
This demo targets **net10.0**. A machine with only the .NET 8 SDK cannot build it
(`NETSDK1045: The current .NET SDK does not support targeting .NET 10.0`), so install the .NET 10 SDK.

- .NET SDKs install **side by side**; installing 10 does not remove or replace 8. Check with `dotnet --list-sdks`.
- The `dotnet` command always uses the **newest installed SDK** unless a `global.json` says otherwise. The newest SDK
  still builds and runs `net8.0` projects, so existing .NET 8 projects keep working. They only get the newer tooling
  (occasionally new analyzer warnings).
- If you want an existing .NET 8 project to keep using the 8 SDK exactly, put a `global.json` next to its `.sln`:
  ```json
  { "sdk": { "version": "8.0.100", "rollForward": "latestFeature" } }
  ```
  (use the 8.x version shown by `dotnet --list-sdks`). This repo deliberately has **no** `global.json`.
- Can't install a new SDK at all (locked-down machine)? Retarget instead: set `net8.0` in both `.csproj` files and pin
  `Microsoft.EntityFrameworkCore.SqlServer` / `.Design` to `8.*`. This path is untested.
- To undo the install later: uninstall "Microsoft .NET SDK 10.x" in Windows *Apps* (or `winget uninstall Microsoft.DotNet.SDK.10`).

## Run it
```bash
git clone <your-repo-url> && cd DIDEMO
docker compose up -d                      # SQL Server 2022; wait until `docker ps` shows (healthy)
dotnet run --project src/DiDemo.Web       # opens http://localhost:5000 (Development => scope validation ON)
dotnet test                               # unit tests with NSubstitute mocks (no database needed)
```
The app waits for SQL Server (up to ~80 s), creates the schema and seeds products on first start.
**Reset data** in the shop page re-seeds. `docker compose down -v` throws the database away.

The SA password in `docker-compose.yml` / `appsettings.Development.json` is a throw-away, local-only demo value.

## Troubleshooting
| Symptom | Fix |
|---|---|
| App log keeps saying "SQL Server not ready" | Container still booting - check `docker ps` for `(healthy)`; first start takes ~30-60 s |
| `Login failed for user 'sa'` | An old volume has another password: `docker compose down -v` then `up -d` |
| Port 1433 or 5000 in use | Stop the other process, or change the port mapping / `applicationUrl` |
| DbContext case shows no failures | Run it again; the `WAITFOR` query keeps calls overlapping, it should fail every time |

## Pages
Every page is split 50/50: **context and controls** on the left, **what happened** on the right.
Each page follows the same four steps: **Context → Try it → What happened → Why it matters**.

**Live progress.** Every click plays out while you watch (the red "● LIVE" tag in *What happened*):
- *streamed from the server as it happens:* the order steps (page 3), the DbContext task bars (C) and the race counters (D, sampled every 40 ms);
- *played back one step at a time, in their real order:* the container building the dependency tree (it shows ✓ created / ♻ reused), a request being served (2, B), the app starting (B, E), job ticks (E), registering and looking up senders (G), and the mock calls, assertions and verdict (F).

The **Animation** switch in the top-right corner (Normal / Fast / Off) scales or removes the pauses; it is remembered in the browser. Use *Fast* or *Off* when you are short on time.

| Page | What it shows |
|---|---|
| 1 · What is DI? | Switching the payment provider (Stripe → PayPal) in four versions of one checkout, with the cost of the switch as a code diff |
| 2 · How long does an object live? | A checkout flow of three services; each receives the same three helpers (Transient, Scoped, Singleton). You see which are the same object and which differ, inside one request and between two |
| 3 · A bigger flow | Place an order against SQL Server; the dependency tree is annotated with the objects actually used (hover a chip to light up the shared ones) |
| A · Circular dependency | **You** pick what InventoryService asks for; the dependency tree shows the loop (red) live, then you start the app |
| B · Captive dependency | **You** pick the CartCache lifetime and the ValidateScopes switch, start the app, and log users in one by one; a request table shows the one cache object serving every request, and what each user sees |
| C · One DbContext, many tasks | **You** choose how to load the prices (one by one, all at once on one DbContext, all at once with a factory) and how many; a swim-lane timeline shows the tasks |
| D · Race condition in a singleton | **You** choose `count++` / `Interlocked` / `lock` and turn the number of concurrent requests up from 1; counted vs lost updates, with every run listed |
| E · Scoped service in a background job | **You** choose how the job gets its service, start the app and click "Tick"; a tick table shows whether each tick gets a fresh object |
| F · Testing with mocks | **You** pick a scenario and write your own assertions ("must be called" / "must never be called"); the real OrderService runs against fakes and you get PASS or FAIL |
| G · Many implementations | **You** choose which senders to register, their order, `TryAdd` and how to ask; registration cards show who gets handed out |

Cases B and E keep a small "running app" on the server between clicks (see `Demos/CaseStudies/Labs.cs`), because those bugs only appear after several requests or ticks.

Code panels ("Show the code") show the real source, taken from `// #region snippet:<name>` blocks in the `.cs` files, so slides and code cannot drift.

## Suggested talk order
1. **What is DI?** Run versions A to C with Stripe, then switch to PayPal and run again. Read "What would switching cost?" for each version.
2. **Lifetimes:** send two requests. The three services share one RequestLog (Scoped) and one ShopCounter (Singleton) but each has its own PriceCalculator (Transient); the next request has a new log and the same counter.
3. **A bigger flow:** place two orders; hover a chip to light up every place that received the same object.
4. **When it goes wrong (A to E):** make the mistake yourself, then fix it. A: pick the loop. B: Singleton, start, log three users in; then switch to Scoped. C: "one after another", then "all at once". D: 1 request, then 16. E: constructor injection, tick, then the scope factory.
5. **Bonus:** F (run the real OrderService against fakes, then `dotnet test`) and G (many implementations).
