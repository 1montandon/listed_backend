import type { PrismaClient } from "../../generated/prisma/client.ts";

export interface AuthUserRecord {
  id: string;
  name: string;
  username: string;
  bio: string | null;
  preferredCurrency: string;
  email: string;
  passwordHash: string;
}

interface NewAccount {
  name: string;
  username: string;
  email: string;
  passwordHash: string;
  tokenHash: string;
  expiresAt: Date;
}

const authUserSelect = {
  id: true,
  name: true,
  username: true,
  bio: true,
  preferredCurrency: true,
  email: true,
  passwordHash: true,
} as const;

export class EmailAlreadyExistsError extends Error {}
export class UsernameAlreadyExistsError extends Error {}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

// Só o repository conhece Prisma; o service recebe AuthUserRecord.
export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createAccountWithSession(input: NewAccount): Promise<AuthUserRecord> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { name: input.name, username: input.username, email: input.email, passwordHash: input.passwordHash },
          select: authUserSelect,
        });

        await transaction.refreshSession.create({
          data: { userId: user.id, tokenHash: input.tokenHash, expiresAt: input.expiresAt },
        });

        return user;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const emailOwner = await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
        if (emailOwner === null) throw new UsernameAlreadyExistsError("Username já cadastrado.");
        throw new EmailAlreadyExistsError("E-mail já cadastrado.");
      }
      throw error;
    }
  }

  findAuthUserByEmail(email: string): Promise<AuthUserRecord | null> {
    return this.prisma.user.findUnique({ where: { email }, select: authUserSelect });
  }

  findAuthUserById(id: string): Promise<AuthUserRecord | null> {
    return this.prisma.user.findUnique({ where: { id }, select: authUserSelect });
  }

  async createRefreshSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.refreshSession.create({ data: { userId, tokenHash, expiresAt } });
  }

  // updateMany usa o estado atual como condição: duas renovações concorrentes
  // não conseguem reutilizar o mesmo token.
  rotateRefreshSession(oldHash: string, newHash: string, expiresAt: Date): Promise<string | null> {
    return this.prisma.$transaction(async (transaction) => {
      const session = await transaction.refreshSession.findUnique({
        where: { tokenHash: oldHash },
        select: { id: true, userId: true },
      });

      if (!session) return null;

      const result = await transaction.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      });

      if (result.count !== 1) return null;

      await transaction.refreshSession.create({
        data: { userId: session.userId, tokenHash: newHash, expiresAt },
      });

      return session.userId;
    });
  }

  async revokeRefreshSession(tokenHash: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
