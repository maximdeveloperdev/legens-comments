
import { getTranslations } from "@/lib/i18n-server"
import { DateTime } from "@/components/time-zone-provider"
import { prisma } from "@/lib/db"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default async function FbAutouploadUploadsPage() {
  const t = await getTranslations()

  const uploads = await prisma.fbAutouploadUpload.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      group: { select: { name: true } },
    },
  })

  return (
    <div className="flex flex-1 flex-col gap-5 p-4 md:p-6">
      <h1 className="text-3xl font-normal tracking-normal text-foreground">
        {t("Заливы")}</h1>

      <div className="overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="border-b bg-transparent hover:bg-transparent">
              <TableHead className="w-24 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                ID
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                {t("Название")}</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                {t("Группа")}</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                {t("Статус")}</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                {t("Дата")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {uploads.length ? (
              uploads.map((upload) => (
                <TableRow key={upload.id} className="h-16 hover:bg-transparent">
                  <TableCell className="text-muted-foreground">
                    {upload.id}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {upload.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {upload.group?.name ?? t("Без группы")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {upload.status}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <DateTime value={upload.createdAt.toISOString()} options={{ day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }} />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow className="h-24 hover:bg-transparent">
                <TableCell
                  colSpan={5}
                  className="text-center text-sm text-muted-foreground"
                >
                  {t("Заливов пока нет")}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
