import { statfs } from "fs/promises"
import os from "os"

export type DiskStats = {
  total: number
  used: number
  free: number
  percent: number
}

export type ServerSample = {
  t: number
  cpu: number
  mem: number
  load: number
}

export type ServerMetrics = {
  hostname: string
  platform: string
  arch: string
  release: string
  uptimeSec: number
  node: string
  pid: number
  cpuModel: string
  cpuCores: number
  cpuSpeedMhz: number
  cpuPercent: number
  load1: number
  load5: number
  load15: number
  memTotal: number
  memUsed: number
  memFree: number
  memPercent: number
  processRss: number
  processHeapUsed: number
  processHeapTotal: number
  disk: DiskStats | null
  addresses: string[]
  history: ServerSample[]
}

const HISTORY_LIMIT = 90
const history: ServerSample[] = []

let lastCpu = cpuTimes()

function cpuTimes() {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    const times = cpu.times
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total }
}

function cpuPercent() {
  const current = cpuTimes()
  const idle = current.idle - lastCpu.idle
  const total = current.total - lastCpu.total
  lastCpu = current
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (1 - idle / total) * 100))
}

function platformLabel() {
  const value = os.platform()
  if (value === "darwin") return "macOS"
  if (value === "win32") return "Windows"
  if (value === "linux") return "Linux"
  return value
}

function addresses() {
  const list: string[] = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      if (entry.family !== "IPv4" && Number(entry.family) !== 4) continue
      list.push(entry.address)
    }
  }
  return list
}

async function diskStats(): Promise<DiskStats | null> {
  try {
    const stats = await statfs("/")
    const total = Number(stats.blocks) * Number(stats.bsize)
    const free = Number(stats.bavail) * Number(stats.bsize)
    if (!Number.isFinite(total) || total <= 0) return null
    const used = Math.max(0, total - free)
    return {
      total,
      used,
      free,
      percent: (used / total) * 100,
    }
  } catch {
    return null
  }
}

export async function getServerMetrics(): Promise<ServerMetrics> {
  const cpus = os.cpus()
  const memTotal = os.totalmem()
  const memFree = os.freemem()
  const memUsed = memTotal - memFree
  const cores = Math.max(1, cpus.length)
  const load = os.loadavg()
  const cpu = cpuPercent()
  const memPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0
  const loadPercent = Math.min(100, (load[0] / cores) * 100)
  const usage = process.memoryUsage()

  const sample: ServerSample = {
    t: Date.now(),
    cpu,
    mem: memPercent,
    load: loadPercent,
  }
  const last = history.at(-1)
  if (!last || sample.t - last.t >= 1500) {
    history.push(sample)
    if (history.length > HISTORY_LIMIT) history.shift()
  } else {
    history[history.length - 1] = sample
  }

  return {
    hostname: os.hostname(),
    platform: platformLabel(),
    arch: os.arch(),
    release: os.release(),
    uptimeSec: os.uptime(),
    node: process.version,
    pid: process.pid,
    cpuModel: cpus[0]?.model?.replace(/\s+/g, " ").trim() || "—",
    cpuCores: cores,
    cpuSpeedMhz: cpus[0]?.speed || 0,
    cpuPercent: cpu,
    load1: load[0] ?? 0,
    load5: load[1] ?? 0,
    load15: load[2] ?? 0,
    memTotal,
    memUsed,
    memFree,
    memPercent,
    processRss: usage.rss,
    processHeapUsed: usage.heapUsed,
    processHeapTotal: usage.heapTotal,
    disk: await diskStats(),
    addresses: addresses(),
    history: [...history],
  }
}
