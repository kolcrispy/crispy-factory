"use server";

import { db } from "@factory/storage/client";
import { requestReviewAction, saveJobReview } from "@factory/core/review-actions";
import { getOwner } from "../../lib/auth/server";

export async function reviewAction(input: unknown) {
  return requestReviewAction({ db, user: getOwner }, input);
}

export async function saveReview(input: unknown) {
  return saveJobReview({ db, user: getOwner }, input);
}
