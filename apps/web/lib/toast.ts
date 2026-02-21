import { toast } from "sonner"

const DURATION = 5000

export function toastSuccess(message: string, description?: string) {
  toast.success(message, {
    description,
    duration: DURATION,
    className: "border-l-4 border-green-500",
  })
}

export function toastError(message: string, description?: string) {
  toast.error(message, {
    description,
    duration: DURATION,
    className: "border-l-4 border-red-500",
  })
}

export function toastInfo(message: string, description?: string) {
  toast.info(message, {
    description,
    duration: DURATION,
    className: "border-l-4 border-blue-500",
  })
}

export function toastWarning(message: string, description?: string) {
  toast.warning(message, {
    description,
    duration: DURATION,
    className: "border-l-4 border-yellow-500",
  })
}
