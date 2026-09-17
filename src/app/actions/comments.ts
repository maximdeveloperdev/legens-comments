"use server";

import { revalidatePath } from "next/cache";
import { CommentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeTrackerLog } from "@/lib/action-log";
import { getActiveSession } from "@/lib/session";

export async function updateCommentStatus(formData: FormData) {
  const session = await getActiveSession();
  if (!session) {
    throw new Error("Unauthorized");
  }

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as CommentStatus;

  if (!id || !Object.values(CommentStatus).includes(status)) {
    return;
  }

  await prisma.comment.update({
    where: { id },
    data: { status },
  });

  const comment = await prisma.comment.findUnique({ where: { id } });
  const statusLabel =
    status === CommentStatus.APPROVED
      ? "Одобрил"
      : status === CommentStatus.REJECTED
        ? "Отклонил"
        : "Изменил статус";
  await writeTrackerLog({
    userName: session.name,
    action: statusLabel,
    detail: comment
      ? `${comment.authorName}: ${comment.body.slice(0, 120)}`
      : id,
  });

  revalidatePath("/queue");
  revalidatePath("/constructor");
  revalidatePath("/stats");
}
