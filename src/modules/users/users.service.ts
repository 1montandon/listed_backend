import { HttpError } from "../../shared/http/http-error.ts";
import { UsersRepository, UsernameAlreadyExistsError, type UserProfile } from "./users.repository.ts";
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
    try {
      const profile = await this.repository.updateProfile(userId, input);
      if (!profile) throw new HttpError(401, "UNAUTHORIZED", "Conta não encontrada.");
      return profile;
    } catch (error) {
      if (error instanceof UsernameAlreadyExistsError) {
        throw new HttpError(409, "USERNAME_ALREADY_EXISTS", "Username já cadastrado.");
      }
      throw error;
    }
  }
}
