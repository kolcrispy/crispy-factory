import { attachDatabasePool, waitUntil } from "@neon/functions";
import { db } from "@factory/storage/client";
import handler, { setBackgroundHandler } from "./index";

attachDatabasePool(db.$client);
setBackgroundHandler(work => waitUntil(work()));

export default handler;
