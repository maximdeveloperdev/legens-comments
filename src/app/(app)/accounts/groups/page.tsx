import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function AccountGroupsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Управление группами</CardTitle>
          <CardDescription>Группы аккаунтов.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Пока без задач.</p>
        </CardContent>
      </Card>
    </div>
  )
}
