import rateLimit from "express-rate-limit"
import { ErrorCodes } from "../types/errors"

const rateLimitMessage = {
  error: {
    code: ErrorCodes.RATE_LIMITED,
    message: "Too many requests, please try again later",
  },
}

export const generateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
})

export const executeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
})

export const simulateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
})

export const defaultLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
})

export const discoverLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
})

export const publishLimiter = rateLimit({
  windowMs: 60_000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
})
