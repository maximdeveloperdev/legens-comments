"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeTrackerLog } from "@/lib/action-log";
import { clearSession, createSession, getSession } from "@/lib/session";
import { verifyTotpCode } from "@/lib/totp";

export type AuthState = {
  error?: string;
  twoFactor?: boolean;
};

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");

  if (!email || !password) {
    return { error: "Введите email и пароль" };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { error: "Неверный email или пароль" };
  }

  if (!user.active) {
    return { error: "Аккаунт отключён" };
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return { error: "Неверный email или пароль" };
  }

  if (user.twoFactorEnabled) {
    if (!user.twoFactorSecret) {
      return { error: "2FA настроена некорректно. Обратитесь к админу." };
    }

    if (!code) {
      return { twoFactor: true };
    }

    if (!verifyTotpCode(user.email, user.twoFactorSecret, code)) {
      return { error: "Неверный код", twoFactor: true };
    }
  }

  await createSession({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  await writeTrackerLog({
    userName: user.name,
    action: "Вошёл",
    detail: user.email,
  });

  redirect("/constructor");
}

export async function logout() {
  const session = await getSession();
  if (session) {
    await writeTrackerLog({
      userName: session.name,
      action: "Вышел",
      detail: session.email,
    });
  }
  await clearSession();
  redirect("/");
}
