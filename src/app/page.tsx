import { redirect } from "next/navigation"
import { LoginForm } from "@/components/login-form"
import { getActiveSession } from "@/lib/session"

export default async function HomePage() {
  const user = await getActiveSession()
  if (user) {
    redirect("/constructor")
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  )
}
