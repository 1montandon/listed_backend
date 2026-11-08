import type { RequestHandler, Response } from "express";
import { ACCESS_TOKEN_LIFETIME_SECONDS } from "../../shared/auth/access-token.ts";
import { HttpError } from "../../shared/http/http-error.ts";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "./auth.cookies.ts";
import { loginBodySchema, registerBodySchema } from "./auth.schema.ts";
import { AuthService, type AuthResult } from "./auth.service.ts";

export class AuthController {
  constructor(private readonly service: AuthService) {}

  private sendSession(response: Response, result: AuthResult, status = 200): void {
    setRefreshCookie(response, result.refreshToken);
    response.status(status).json({
      user: result.user,
      accessToken: result.accessToken,
      tokenType: "Bearer",
      expiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
    });
  }

  // Campos de função preservam `this` quando o Express recebe o handler.
  readonly register: RequestHandler = async (request, response) => {
    const body: unknown = request.body;
    const result = await this.service.register(registerBodySchema.parse(body));
    this.sendSession(response, result, 201);
  };

  readonly login: RequestHandler = async (request, response) => {
    const body: unknown = request.body;
    const result = await this.service.login(loginBodySchema.parse(body));
    this.sendSession(response, result);
  };

  readonly refresh: RequestHandler = async (request, response) => {
    const oldToken = readRefreshCookie(request);
    if (!oldToken) {
      throw new HttpError(401, "INVALID_REFRESH_TOKEN", "Sessão expirada ou inválida.");
    }

    try {
      const result = await this.service.refresh(oldToken);
      this.sendSession(response, result);
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        clearRefreshCookie(response);
      }
      throw error;
    }
  };

  readonly logout: RequestHandler = async (request, response) => {
    await this.service.logout(readRefreshCookie(request));
    clearRefreshCookie(response);
    response.status(204).end();
  };
}
