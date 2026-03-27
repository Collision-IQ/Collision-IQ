import { PrismaClient } from "@prisma/client"

type PrismaGlobal = typeof globalThis & {
  prisma?: PrismaClient
  prismaInstanceId?: number
  prismaConnectPromise?: Promise<void>
  backgroundTaskPromises?: Map<string, Promise<unknown>>
}

const globalForPrisma = globalThis as PrismaGlobal

async function connectPrismaClient(prisma: PrismaClient) {
  globalForPrisma.prismaConnectPromise ??= prisma
    .$connect()
    .then(() => {
      console.info("[prisma] dev connect ok", {
        instanceId: globalForPrisma.prismaInstanceId,
        pid: process.pid,
      })
    })
    .catch((error) => {
      console.error("[prisma] dev connect failed", {
        instanceId: globalForPrisma.prismaInstanceId,
        pid: process.pid,
        error: error instanceof Error ? error.message : String(error),
      })
      globalForPrisma.prismaConnectPromise = undefined
      throw error
    })

  return globalForPrisma.prismaConnectPromise
}

function createPrismaClient() {
  const prisma = new PrismaClient({
    log: ["error"],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  })

  const instanceId = (globalForPrisma.prismaInstanceId ?? 0) + 1
  globalForPrisma.prismaInstanceId = instanceId

  const originalDisconnect = prisma.$disconnect.bind(prisma)
  prisma.$disconnect = async () => {
    console.warn("[prisma] disconnect called", {
      instanceId,
      pid: process.pid,
      nodeEnv: process.env.NODE_ENV,
      stack: new Error().stack?.split("\n").slice(1, 5).join(" | "),
    })
    return originalDisconnect()
  }

  console.info("[prisma] client created", {
    instanceId,
    pid: process.pid,
    nodeEnv: process.env.NODE_ENV,
  })

  return { prisma, instanceId }
}

function installPrismaClient(prisma: PrismaClient, instanceId: number) {
  globalForPrisma.prisma = prisma
  globalForPrisma.prismaInstanceId = instanceId
  globalForPrisma.prismaConnectPromise = undefined
  return prisma
}

const existingPrisma = globalForPrisma.prisma
const existingInstanceId = globalForPrisma.prismaInstanceId

if (existingPrisma) {
  console.info("[prisma] client reused", {
    instanceId: existingInstanceId,
    pid: process.pid,
    nodeEnv: process.env.NODE_ENV,
  })
}

const created = existingPrisma ? null : createPrismaClient()

export const prisma = existingPrisma ?? created!.prisma

if (process.env.NODE_ENV !== "production") {
  installPrismaClient(prisma, existingInstanceId ?? created!.instanceId)

  void connectPrismaClient(prisma)
}

export function ensureSingleWorker(name: string) {
  globalForPrisma.backgroundTaskPromises ??= new Map()
  const existing = globalForPrisma.backgroundTaskPromises.get(name)

  if (existing) {
    console.info("[background-worker] duplicate start prevented", {
      name,
      pid: process.pid,
    })
    return { started: false, done: existing }
  }

  console.info("[background-worker] start", {
    name,
    pid: process.pid,
  })

  let resolveDone: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })

  globalForPrisma.backgroundTaskPromises.set(name, done)

  const stop = () => {
    if (globalForPrisma.backgroundTaskPromises?.get(name) === done) {
      globalForPrisma.backgroundTaskPromises.delete(name)
    }

    console.info("[background-worker] stop", {
      name,
      pid: process.pid,
    })
    resolveDone()
  }

  return { started: true, stop, done }
}

export function getActivePrismaForBackgroundWork(label: string) {
  const activePrisma = globalForPrisma.prisma ?? prisma

  console.info("[background-prisma] resolve active client", {
    label,
    instanceId: globalForPrisma.prismaInstanceId,
    pid: process.pid,
    nodeEnv: process.env.NODE_ENV,
  })

  return activePrisma
}
