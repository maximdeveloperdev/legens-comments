import { prisma } from "@/lib/db"
import { BindingsForm, type CountryOption } from "./bindings-form"

export default async function FbAutouploadBindingsPage() {
  const countries = await prisma.country.findMany({
    orderBy: { nameRu: "asc" },
    select: {
      code: true,
      nameRu: true,
    },
  })

  const countryOptions: CountryOption[] = countries.map((country) => ({
    label: country.nameRu,
    value: country.code,
  }))

  return <BindingsForm countries={countryOptions} />
}
