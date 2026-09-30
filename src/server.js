import "dotenv/config";
import { createApp } from "./app.js";
import { createRepository } from "./database/repository.js";
import { createStorageService } from "./services/storage.service.js";

const repository = await createRepository();
await repository.initialize();
const storage = createStorageService();
const app = createApp({ repository, storage });
const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => console.log(`Upload & ingestion API listening on :${port}`));

async function shutdown() {
  server.close(async () => {
    await repository.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
