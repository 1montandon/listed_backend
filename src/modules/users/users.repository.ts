import type { PrismaClient } from "../../generated/prisma/client.ts";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

const profileSelect = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findProfileById(userId: string): Promise<UserProfile | null> {
    return this.prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
  }

  async updateProfileName(userId: string, name: string): Promise<UserProfile | null> {
    try {
      return await this.prisma.user.update({ where: { id: userId }, data: { name }, select: profileSelect });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
        return null;
      }
      throw error;
    }
  }
}
