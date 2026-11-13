"use server";

import { db } from "@factory/storage/client";
import { machines } from "@factory/storage/schema";
import { auth } from "../../lib/auth/server";
import { reportedHarnesses } from "@factory/core/machine";
import { saveSettings as save, writeSettings, type SettingsInput } from "@factory/core/settings";

const user = async () => (await auth.getSession()).data?.user;

export async function saveSettings(input: SettingsInput) {
  return save(
    {
      user,
      harnesses: async () => reportedHarnesses(await db.select().from(machines), Date.now()),
      save: (choice, by) => writeSettings(db, choice, by, new Date()),
    },
    input,
  );
}
