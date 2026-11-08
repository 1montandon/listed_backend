import type { AuthenticatedHandler } from "../../shared/http/with-user.ts";
import { updateProfileBodySchema } from "./users.schema.ts";
import { UsersService } from "./users.service.ts";

export class UsersController {
  constructor(private readonly service: UsersService) {}

  readonly getMe: AuthenticatedHandler = async (_request, response, userId) => {
    response.set("Cache-Control", "no-store");
    response.json({ user: await this.service.getProfile(userId) });
  };

  readonly updateMe: AuthenticatedHandler = async (request, response, userId) => {
    const body: unknown = request.body;
    const input = updateProfileBodySchema.parse(body);
    response.set("Cache-Control", "no-store");
    response.json({ user: await this.service.updateProfile(userId, input) });
  };
}
