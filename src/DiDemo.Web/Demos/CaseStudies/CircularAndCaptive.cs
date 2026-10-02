using DiDemo.Web.Infrastructure;

namespace DiDemo.Web.Demos.CaseStudies;

// =====================================================================
// 3a. Circular dependency:  OrderService -> InventoryService -> OrderService
// =====================================================================

// #region snippet:circular-broken
// "Inventory needs to know how many orders are pending, so let's just inject OrderService..."
public interface ICircularOrders { string Place(); }
public interface ICircularInventory { int PendingOrders(); }

public class CircularOrderService(ICircularInventory inventory) : ICircularOrders
{
    public string Place() => $"Order placed ({inventory.PendingOrders()} pending)";
}

public class CircularInventoryService(ICircularOrders orders) : ICircularInventory
{
    public int PendingOrders() => orders.Place().Length; // needs OrderService... which needs us
}
// #endregion

// #region snippet:circular-fixed
// The shared need ("how many orders are pending?") is extracted into its own small abstraction.
// The arrow now points one way:  OrderService -> InventoryService -> PendingOrderQuery
public interface IPendingOrderQuery { int Count(); }
public class PendingOrderQuery : IPendingOrderQuery { public int Count() => 3; }

public class LeanInventoryService(IPendingOrderQuery pending) : ICircularInventory
{
    public int PendingOrders() => pending.Count();
}
// #endregion

// =====================================================================
// 3b. Captive dependency:  Singleton CartCache -> Scoped UserContext
// =====================================================================

// #region snippet:captive-broken
public interface IUserContext { Guid Id { get; } string User { get; set; } }
public class UserContext : IUserContext
{
    public Guid Id { get; } = Guid.NewGuid();
    public string User { get; set; } = "anonymous";
}

// A cache is a "nice" singleton... but it injects a SCOPED service.
// The singleton lives forever, so it keeps ONE UserContext forever (captive dependency).
public class CartCache(IUserContext user)
{
    public string Owner => user.User;
    public Guid ContextId => user.Id;
}
// registered as:  services.AddSingleton<CartCache>();   <-- the bug
// #endregion

// #region snippet:captive-fixed
// Fix: give CartCache the SAME lifetime as what it depends on (or shorter-lived dependencies only).
//   services.AddScoped<CartCache>();
// Rule of thumb: a service may only depend on services with an equal or LONGER lifetime.
// #endregion
