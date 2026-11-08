import { createAccessToken } from "../../shared/auth/access-token.ts";
import { HttpError } from "../../shared/http/http-error.ts";
import { AuthRepository, EmailAlreadyExistsError, type AuthUserRecord } from "./auth.repository.ts";
import type { LoginInput, RegisterInput } from "./auth.schema.ts";
import {
  hashPassword,
  hashRefreshToken,
  newRefreshToken,
  refreshExpiration,
  verifyPassword,
} from "./auth.tokens.ts";

type PublicUser = Pick<AuthUserRecord, "id" | "name" | "email">;

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

function toPublicUser(user: AuthUserRecord): PublicUser {
  return { id: user.id, name: user.name, email: user.email };
}

export class AuthService {
  private readonly dummyPasswordHash = hashPassword("senha-que-nao-pertence-a-nenhuma-conta");

  constructor(private readonly repository: AuthRepository) {}

  private async issueSession(user: AuthUserRecord): Promise<AuthResult> {
    const refreshToken = newRefreshToken();
    await this.repository.createRefreshSession(user.id, hashRefreshToken(refreshToken), refreshExpiration());

    return {
      user: toPublicUser(user),
      accessToken: await createAccessToken(user.id),
      refreshToken,
    };
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const refreshToken = newRefreshToken();

    try {
      const user = await this.repository.createAccountWithSession({
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: refreshExpiration(),
      });

      return {
        user: toPublicUser(user),
        accessToken: await createAccessToken(user.id),
        refreshToken,
      };
    } catch (error) {
      if (error instanceof EmailAlreadyExistsError) {
        throw new HttpError(409, "EMAIL_ALREADY_EXISTS", "E-mail já cadastrado.");
      }
      throw error;
    }
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.repository.findAuthUserByEmail(input.email);
    // Também verifica um hash quando o e-mail não existe, para reduzir a
    // diferença de tempo entre conta ausente e senha incorreta.
    const passwordHash = user?.passwordHash ?? (await this.dummyPasswordHash);
    const passwordMatches = await verifyPassword(passwordHash, input.password);

    if (!user || !passwordMatches) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos.");
    }

    return this.issueSession(user);
  }

  async refresh(oldToken: string): Promise<AuthResult> {
    const refreshToken = newRefreshToken();
    const userId = await this.repository.rotateRefreshSession(
      hashRefreshToken(oldToken),
      hashRefreshToken(refreshToken),
      refreshExpiration(),
    );

    if (!userId) {
      throw new HttpError(401, "INVALID_REFRESH_TOKEN", "Sessão expirada ou inválida.");
    }

    const user = await this.repository.findAuthUserById(userId);
    if (!user) {
      throw new HttpError(401, "INVALID_REFRESH_TOKEN", "Sessão expirada ou inválida.");
    }

    return {
      user: toPublicUser(user),
      accessToken: await createAccessToken(user.id),
      refreshToken,
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.repository.revokeRefreshSession(hashRefreshToken(refreshToken));
    }
  }
}
