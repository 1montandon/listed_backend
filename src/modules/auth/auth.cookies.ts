import { parseCookie } from "cookie";
import type { Request, Response } from "express";
import { env } from "../../config/env.ts";
import { REFRESH_LIFETIME_MS } from "./auth.tokens.ts";

const cookieName = "listed_refresh";
const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/v1/auth",
};

export function readRefreshCookie(request: Request): string | undefined {
  return parseCookie(request.headers.cookie ?? "")[cookieName];
}

export function setRefreshCookie(response: Response, token: string): void {
  response.cookie(cookieName, token, { ...cookieOptions, maxAge: REFRESH_LIFETIME_MS });
}

export function clearRefreshCookie(response: Response): void {
  response.clearCookie(cookieName, cookieOptions);
}
