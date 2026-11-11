import type { AuthenticatedHandler } from "../../shared/http/with-user.ts";
import { extractProductSchema } from "./products.schema.ts";
import { ProductsService } from "./products.service.ts";

export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  readonly extract: AuthenticatedHandler = async (request, response) => {
    const body: unknown = request.body;
    const input = extractProductSchema.parse(body);
    response.json(await this.service.extract(input));
  };
}
