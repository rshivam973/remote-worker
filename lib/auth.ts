import { auth } from "@clerk/nextjs/server";

export async function currentUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}
