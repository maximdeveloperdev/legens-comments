import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { getActiveSession } from "@/lib/session"
import { createTotpQr } from "@/lib/totp"
import { ProfileForm } from "./profile-form"

export default async function ProfilePage() {
  const session = await getActiveSession()
  if (!session) {
    redirect("/")
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      name: true,
      email: true,
      role: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      avatarUrl: true,
    },
  })

  if (!user) {
    redirect("/")
  }

  const setup =
    !user.twoFactorEnabled && user.twoFactorSecret
      ? await createTotpQr(user.email, user.twoFactorSecret)
      : null

  return (
    <div className="flex flex-1 items-center justify-center p-4 md:p-6">
      <ProfileForm
        user={{
          name: user.name,
          email: user.email,
          role: user.role,
          twoFactorEnabled: user.twoFactorEnabled,
          avatarUrl: user.avatarUrl,
        }}
        setup={setup}
      />
    </div>
  )
}
