import { app } from "./app.ts";
import { env } from "./config/env.ts";

const server = app.listen(env.PORT, () => {
  console.info(`Listed API em http://localhost:${env.PORT}`);
});
