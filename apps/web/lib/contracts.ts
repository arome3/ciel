export const REGISTRY_ADDRESS = process.env
  .NEXT_PUBLIC_REGISTRY_ADDRESS as `0x${string}`

export const BASE_SEPOLIA_CHAIN_SELECTOR = 10344971235874465080n

export const REGISTRY_ABI = [
  {
    type: "function",
    name: "publishWorkflow",
    inputs: [
      { name: "name", type: "string" },
      { name: "description", type: "string" },
      { name: "category", type: "string" },
      { name: "supportedChains", type: "uint64[]" },
      { name: "capabilities", type: "string[]" },
      { name: "x402Endpoint", type: "string" },
      { name: "pricePerExecution", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getCreatorWorkflows",
    inputs: [
      { name: "creator", type: "address" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      { name: "ids", type: "bytes32[]" },
      { name: "total", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "WorkflowPublished",
    inputs: [
      { name: "workflowId", type: "bytes32", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "category", type: "string", indexed: false },
    ],
  },
] as const
