import { HttpClient, qs } from "./http"
import type {
  CielSDKConfig,
  DiscoverQuery,
  DiscoveredWorkflow,
  WorkflowDetail,
  ListWorkflowsParams,
  ListWorkflowsResponse,
  ExecuteOptions,
  ExecutionResult,
} from "./types"
import { CielSDKError } from "./types"

export class CielSDK {
  private http: HttpClient
  private privateKey: string | undefined
  private network: string
  private paymentFetch: typeof fetch | null = null

  constructor(config: CielSDKConfig) {
    this.http = new HttpClient(config.apiUrl, config.timeout)
    this.privateKey = config.privateKey
    this.network = config.network ?? "base-sepolia"
  }

  // ── Discovery (no auth needed) ──

  async discover(query?: DiscoverQuery): Promise<DiscoveredWorkflow[]> {
    const params = query ? {
      category: query.category,
      chain: query.chain,
      capability: query.capability,
    } : undefined

    return this.http.request<DiscoveredWorkflow[]>(
      `/api/discover${qs(params)}`,
    )
  }

  async getWorkflow(id: string): Promise<WorkflowDetail> {
    return this.http.request<WorkflowDetail>(`/api/workflows/${id}`)
  }

  async listWorkflows(params?: ListWorkflowsParams): Promise<ListWorkflowsResponse> {
    return this.http.request<ListWorkflowsResponse>(
      `/api/workflows${qs(params as Record<string, string | number | boolean | undefined>)}`,
    )
  }

  // ── Execution (requires privateKey for x402 payment) ──

  async execute(workflowId: string, _options?: ExecuteOptions): Promise<ExecutionResult> {
    const pFetch = await this.getPaymentFetch()

    const workflow = await this.getWorkflow(workflowId)
    const endpoint = workflow.x402Endpoint
    if (!endpoint) {
      throw new CielSDKError("WORKFLOW_NOT_PUBLISHED", "Workflow has no x402 endpoint — it may not be published")
    }

    const res = await pFetch(endpoint, {
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new CielSDKError("EXECUTION_FAILED", `Execution failed (${res.status}): ${text.slice(0, 200)}`, res.status)
    }

    const data = await res.json() as Record<string, unknown>
    const result = data.result as Record<string, unknown> | undefined
    const payment = data.payment as Record<string, unknown> | undefined

    return {
      executionId: typeof data.executionId === "string" ? data.executionId : "",
      workflowId,
      success: data.success === true,
      result: result ?? null,
      duration: typeof data.duration === "number" ? data.duration : 0,
      payment: payment ? {
        txHash: typeof payment.txHash === "string" ? payment.txHash : undefined,
        amountUsdc: typeof payment.amountUsdc === "number" ? payment.amountUsdc : undefined,
      } : undefined,
    }
  }

  // ── Lazy x402 setup ──

  private async getPaymentFetch(): Promise<typeof fetch> {
    if (this.paymentFetch) return this.paymentFetch

    if (!this.privateKey) {
      throw new CielSDKError(
        "PAYMENT_NOT_CONFIGURED",
        "privateKey is required in CielSDKConfig for execute(). Discovery methods work without it.",
      )
    }

    try {
      const [
        { createPublicClient, http },
        { baseSepolia },
        { wrapFetchWithPayment, x402Client },
        { ExactEvmScheme, toClientEvmSigner },
        { privateKeyToAccount },
      ] = await Promise.all([
        import("viem"),
        import("viem/chains"),
        import("@x402/fetch"),
        import("@x402/evm"),
        import("viem/accounts"),
      ])

      const account = privateKeyToAccount(this.privateKey as `0x${string}`)
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      })
      const signer = toClientEvmSigner(account, publicClient)
      const client = new x402Client()
      client.register(this.network, new ExactEvmScheme(signer))

      this.paymentFetch = wrapFetchWithPayment(fetch, client)
      return this.paymentFetch
    } catch (err) {
      if (err instanceof CielSDKError) throw err
      throw new CielSDKError(
        "PAYMENT_DEPS_MISSING",
        "x402 payment dependencies not installed. Run: npm install viem @x402/fetch @x402/evm",
      )
    }
  }
}
