import { Router } from "express";
import { prisma } from "../../db/prisma.ts";
import { withUser } from "../../shared/http/with-user.ts";
import { UsersController } from "./users.controller.ts";
import { UsersRepository } from "./users.repository.ts";
import { UsersService } from "./users.service.ts";

const repository = new UsersRepository(prisma);
const service = new UsersService(repository);
const controller = new UsersController(service);
export const usersRouter = Router();

usersRouter.get("/me", withUser(controller.getMe));
usersRouter.patch("/me", withUser(controller.updateMe));
