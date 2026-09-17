"use client"

import { useEffect, useState } from "react"
import { Cpu, HardDrive, MemoryStick, Server } from "lucide-react"
import type { ServerMetrics } from "@/lib/server-metrics"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} ГБ`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} МБ`
  if (value >= 1024) return `${(value / 1024).toFixed(0)} КБ`
  return `${value} Б`
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} д ${hours} ч`
  if (hours > 0) return `${hours} ч ${minutes} мин`
  return `${minutes} мин`
}

function formatPct(value: number) {
  return `${value.toFixed(0)}%`
}

function loadColor(percent: number) {
  if (percent >= 80) return "#ef4444"
  if (percent >= 50) return "#f59e0b"
  return "#22c55e"
}

function Meter({ value, color }: { value: number; color: string }) {
  const width = Math.max(0, Math.min(100, value))
  return (
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${width}%`, backgroundColor: color }}
      />
    </div>
  )
}

function LoadChart({
  points,
}: {
  points: { cpu: number; mem: number; load: number }[]
}) {
  const width = 1100
  const height = 240
  const padL = 44
  const padR = 16
  const padT = 18
  const padB = 28
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const series = points.length > 1 ? points : [...points, ...points]

  function path(key: "cpu" | "mem" | "load") {
    if (series.length < 2) return ""
    return series
      .map((point, index) => {
        const x = padL + (index / (series.length - 1)) * innerW
        const y = padT + innerH - (Math.max(0, Math.min(100, point[key])) / 100) * innerH
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(" ")
  }

  function area(key: "cpu" | "mem" | "load") {
    const line = path(key)
    if (!line) return ""
    const lastX = padL + innerW
    const base = padT + innerH
    return `${line} L${lastX.toFixed(1)} ${base} L${padL} ${base} Z`
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-52 w-full md:h-56"
      role="img"
      aria-label="График нагрузки"
    >
      <defs>
        <linearGradient id="load-fill" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.18" />
          <stop offset="50%" stopColor="#eab308" stopOpacity="0.2" />
          <stop offset="80%" stopColor="#f97316" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.32" />
        </linearGradient>
        <linearGradient id="load-stroke" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="50%" stopColor="#eab308" />
          <stop offset="80%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <rect x={padL} y={padT + innerH * 0} width={innerW} height={innerH * 0.2} fill="#ef4444" opacity="0.08" />
      <rect x={padL} y={padT + innerH * 0.2} width={innerW} height={innerH * 0.3} fill="#eab308" opacity="0.07" />
      <rect x={padL} y={padT + innerH * 0.5} width={innerW} height={innerH * 0.5} fill="#22c55e" opacity="0.06" />
      {[0, 25, 50, 75, 100].map((tick) => {
        const y = padT + innerH - (tick / 100) * innerH
        return (
          <g key={tick}>
            <line
              x1={padL}
              x2={width - padR}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
            />
            <text x={8} y={y + 4} className="fill-muted-foreground" fontSize="12">
              {tick}%
            </text>
          </g>
        )
      })}
      <path d={area("load")} fill="url(#load-fill)" />
      <path d={path("load")} fill="none" stroke="url(#load-stroke)" strokeWidth="3.5" strokeLinejoin="round" />
      <path d={path("cpu")} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" />
      <path
        d={path("mem")}
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeDasharray="6 4"
      />
    </svg>
  )
}

export function ServerMonitor({ initial }: { initial: ServerMetrics }) {
  const [data, setData] = useState<ServerMetrics>(initial)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch("/api/server-metrics", { cache: "no-store" })
        if (!res.ok) {
          throw new Error(res.status === 401 ? "Нужно войти в аккаунт" : "Не удалось получить метрики")
        }
        const json = (await res.json()) as ServerMetrics
        if (!cancelled) {
          setData(json)
          setError("")
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Ошибка мониторинга")
        }
      }
    }

    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="grid gap-4">
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardDescription>Процессор</CardDescription>
            <Cpu className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardTitle className="text-2xl tabular-nums">{formatPct(data.cpuPercent)}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.cpuCores} ядер · {data.cpuSpeedMhz} МГц
            </p>
            <Meter value={data.cpuPercent} color="#3b82f6" />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardDescription>Оперативная память</CardDescription>
            <MemoryStick className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardTitle className="text-2xl tabular-nums">{formatPct(data.memPercent)}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatBytes(data.memUsed)} из {formatBytes(data.memTotal)}
            </p>
            <Meter value={data.memPercent} color="#8b5cf6" />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardDescription>Диск</CardDescription>
            <HardDrive className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardTitle className="text-2xl tabular-nums">
              {data.disk ? formatPct(data.disk.percent) : "—"}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.disk
                ? `${formatBytes(data.disk.used)} из ${formatBytes(data.disk.total)}`
                : "Нет данных"}
            </p>
            <Meter value={data.disk?.percent ?? 0} color="#06b6d4" />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardDescription>Нагрузка</CardDescription>
            <Server className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardTitle className="text-2xl tabular-nums">{data.load1.toFixed(2)}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              5 мин {data.load5.toFixed(2)} · 15 мин {data.load15.toFixed(2)}
            </p>
            <Meter
              value={(data.load1 / Math.max(1, data.cpuCores)) * 100}
              color={loadColor((data.load1 / Math.max(1, data.cpuCores)) * 100)}
            />
          </CardContent>
        </Card>
      </section>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>График нагрузки</CardTitle>
          <CardDescription>Обновляется каждые 2 секунды. Пока открыта эта страница.</CardDescription>
        </CardHeader>
        <CardContent className="px-2 pb-4 sm:px-4">
          <LoadChart points={data.history} />
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 px-2 text-xs text-muted-foreground sm:px-0">
            <span className="inline-flex items-center gap-2">
              <span
                className="size-2.5 rounded-full"
                style={{ background: "linear-gradient(180deg, #ef4444, #eab308, #22c55e)" }}
              />
              Нагрузка: зелёный спокойно, жёлтый средне, красный высокая
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: "#3b82f6" }} />
              CPU
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: "#8b5cf6" }} />
              Оператива
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Данные сервера</CardTitle>
          <CardDescription>Хост, система, процесс Node и сеть.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Info label="Хост" value={data.hostname} />
            <Info label="Система" value={`${data.platform} ${data.release} · ${data.arch}`} />
            <Info label="Аптайм" value={formatUptime(data.uptimeSec)} />
            <Info label="CPU" value={data.cpuModel} />
            <Info label="Node" value={`${data.node} · PID ${data.pid}`} />
            <Info
              label="Память процесса"
              value={`RSS ${formatBytes(data.processRss)} · heap ${formatBytes(data.processHeapUsed)} / ${formatBytes(data.processHeapTotal)}`}
            />
            <Info
              label="IP"
              value={data.addresses.length > 0 ? data.addresses.join(", ") : "—"}
            />
            <Info label="Свободная оператива" value={formatBytes(data.memFree)} />
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-all">{value}</dd>
    </div>
  )
}
