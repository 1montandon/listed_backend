import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import type { UpdateProfileInput } from "./users.schema.ts";

export class UsernameAlreadyExistsError extends Error {}

export interface UserProfile {
  id: string;
  name: string;
  username: string;
  bio: string | null;
  preferredCurrency: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

const profileSelect = {
  id: true,
  name: true,
  username: true,
  bio: true,
  preferredCurrency: true,
  email: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findProfileById(userId: string): Promise<UserProfile | null> {
    return this.prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserProfile | null> {
    // O Zod permite campos omitidos; o Prisma recebe somente os presentes.
    // null na bio é mantido porque representa a intenção de limpá-la.
    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.username !== undefined) data.username = input.username;
    if (input.bio !== undefined) data.bio = input.bio;
    if (input.preferredCurrency !== undefined) data.preferredCurrency = input.preferredCurrency;
    try {
      return await this.prisma.user.update({ where: { id: userId }, data, select: profileSelect });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new UsernameAlreadyExistsError("Username já cadastrado.");
      }
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
        return null;
      }
      throw error;
    }
  }
}
