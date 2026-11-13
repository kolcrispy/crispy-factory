import "@factory/platform/environment";
import handler from "./index";

Bun.serve({ port: Number(process.env.PORT ?? 3008), fetch: handler.fetch });
console.log("Factory gateway listening");
