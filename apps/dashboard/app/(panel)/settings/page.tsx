import { connection } from "next/server";
import { Suspense } from "react";
import { SettingsForm } from "../../../components/panel/settings-form";
import { FormSkeleton, PageSkeleton } from "../../../components/panel/skeletons";
import { db } from "@factory/storage/client";
import { load, machinesQuery } from "../../../lib/live-queries";
import { readSettings } from "@factory/core/settings";

async function Panel() {
  // Without a search param to make the page dynamic, Next would try to prerender it and log the cookie read as an error.
  await connection();
  // load checks the owner before anything is read.
  const machines = await load(machinesQuery());
  const saved = await readSettings(db);
  return <SettingsForm machines={machines} saved={saved} />;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Settings"><FormSkeleton /></PageSkeleton>}>
      <Panel />
    </Suspense>
  );
}
