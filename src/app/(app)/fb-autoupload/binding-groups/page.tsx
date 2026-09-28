import { prisma } from "@/lib/db"

import {
  BindingGroupsManager,
  type BindingGroupRow,
} from "./binding-groups-manager"

export default async function FbAutouploadBindingGroupsPage() {
  const groups = await prisma.fbAutouploadBindingGroup.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      _count: {
        select: { bindings: true },
      },
    },
  })

  const rows: BindingGroupRow[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    bindingsCount: group._count.bindings,
  }))

  return <BindingGroupsManager groups={rows} />
}
