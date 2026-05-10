import { NextResponse } from "next/server";
import {
  checkRenderStoreHealth,
  getHostedRenderConfigError,
  getRenderStoreConfigError,
  getRenderStoreMode,
  isBlobRenderStoreEnabled,
  readLatestRenderWorkerHeartbeat,
} from "@/lib/render-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

const getWorkerStaleMs = () => {
  const value = Number(process.env.RENDER_WORKER_HEALTH_STALE_MS);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 2 * 60 * 1000;
};

export async function GET() {
  const configError = getHostedRenderConfigError() ?? getRenderStoreConfigError();
  if (configError) {
    return NextResponse.json(
      {
        ok: false,
        store: {
          mode: getRenderStoreMode(),
          ok: false,
          error: configError,
        },
        worker: {
          ok: false,
          latest: null,
        },
      },
      { status: 503, headers: noStoreHeaders },
    );
  }

  const store = await checkRenderStoreHealth().catch((error: unknown) => ({
    mode: getRenderStoreMode(),
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));

  const latestWorker = await readLatestRenderWorkerHeartbeat().catch(() => null);
  const workerAgeMs = latestWorker ? Date.now() - Date.parse(latestWorker.updatedAt) : null;
  const requiresWorker = isBlobRenderStoreEnabled();
  const workerOk = !requiresWorker || (workerAgeMs !== null && workerAgeMs <= getWorkerStaleMs());
  const ok = store.ok && workerOk;

  return NextResponse.json(
    {
      ok,
      store,
      worker: {
        ok: workerOk,
        staleAfterMs: getWorkerStaleMs(),
        ageMs: workerAgeMs,
        latest: latestWorker,
      },
    },
    { status: ok ? 200 : 503, headers: noStoreHeaders },
  );
}
