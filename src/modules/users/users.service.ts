import { HttpError } from "../../shared/http/http-error.ts";
import { UsersRepository, type UserProfile } from "./users.repository.ts";
import type { UpdateProfileInput } from "./users.schema.ts";

export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async getProfile(userId: string): Promise<UserProfile> {
    const profile = await this.repository.findProfileById(userId);
    if (!profile) {
      throw new HttpError(401, "UNAUTHORIZED", "Conta não encontrada.");
    }
    return profile;
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserProfile> {
    const profile = await this.repository.updateProfileName(userId, input.name);
    if (!profile) {
      throw new HttpError(401, "UNAUTHORIZED", "Conta não encontrada.");
    }
    return profile;
  }
}
