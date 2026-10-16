// Typed client for Officely.Api. Errors arrive as RFC 9457 ProblemDetails and become ApiError.

export interface Product {
  id: number
  name: string
  description: string
  emoji: string
  price: number
  stock: number
}

export interface CartLine {
  productId: number
  name: string
  emoji: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export interface Cart {
  lines: CartLine[]
  itemCount: number
  total: number
}

export interface OrderLine {
  productId: number
  productName: string
  unitPrice: number
  quantity: number
}

export type OrderStatus = 'PendingPayment' | 'Paid' | 'Shipped' | 'Cancelled'

export interface Order {
  id: number
  customerEmail: string
  paymentProvider: string
  paymentReference: string | null
  total: number
  status: OrderStatus
  placedAt: string
  shippedAt: string | null
  lines: OrderLine[]
}

export interface Email {
  id: number
  to: string
  subject: string
  body: string
  sentAt: string
}

export type CaseStudy =
  | 'None'
  | 'Payments'
  | 'Notifications'
  | 'Lifetimes'
  | 'Cart'
  | 'UnitOfWork'
  | 'ThreadSafety'
  | 'BackgroundJob'

export interface ShopStatus {
  generation: number
  running: boolean
  broken: CaseStudy
  validation: boolean
  startedAt: string
  startupError: { type: string; message: string; fullText: string } | null
}

export interface GraphNode {
  id: string
  label: string
  service: string | null
  lifetime: string
}

export type EdgeKind = 'injected' | 'enumerable' | 'cycle' | 'captive' | 'new' | 'creates-scope'

export interface Graph {
  nodes: GraphNode[]
  edges: { from: string; to: string; kind: EdgeKind }[]
}

export interface CaseStudyDetails {
  code: { broken: string; fixed: string }
  graphs: { broken: Graph; fixed: Graph }
}

export interface SimulationResult {
  buyers: number
  succeeded: number
  before: number
  expected: number
  actual: number
  lost: number
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly exception?: string,
  ) {
    super(detail ?? title)
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the Officely server', 'Is "dotnet run --project src/Officely.Api" running?')
  }
  const body = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok)
    throw new ApiError(response.status, body?.title ?? `HTTP ${response.status}`, body?.detail, body?.exception)
  return body as T
}

const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  products: () => request<Product[]>('/api/products'),
  cart: () => request<Cart>('/api/cart'),
  addToCart: (productId: number, quantity = 1) => request<void>('/api/cart/items', send('POST', { productId, quantity })),
  setQuantity: (productId: number, quantity: number) => request<void>(`/api/cart/items/${productId}`, send('PUT', { quantity })),
  clearCart: () => request<void>('/api/cart', send('DELETE')),
  checkout: (customerEmail: string, paymentProvider: string) =>
    request<Order>('/api/checkout', send('POST', { customerEmail, paymentProvider })),
  orders: () => request<Order[]>('/api/orders'),
  cancelOrder: (id: number) => request<void>(`/api/orders/${id}/cancel`, send('POST')),
  inbox: () => request<Email[]>('/api/inbox'),

  status: () => request<ShopStatus>('/api/dev/status'),
  switchCaseStudy: (broken: CaseStudy, validation: boolean) => request<void>('/api/dev/case-studies', send('PUT', { broken, validation })),
  caseStudy: (id: CaseStudy) => request<CaseStudyDetails>(`/api/dev/case-studies/${id}`),
  simulateBuyers: (buyers: number, productId: number) =>
    request<SimulationResult>('/api/dev/simulate-buyers', send('POST', { buyers, productId })),
  resetData: () => request<void>('/api/dev/reset-data', send('POST')),
}

export const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** "Officely.Api.Orders.IOrderService" -> "IOrderService": readable in the UI. */
export const shortNames = (text: string) => text.replace(/\bOfficely\.Api\.(?:\w+\.)*/g, '')
