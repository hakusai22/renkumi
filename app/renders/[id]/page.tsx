import Link from "next/link";
import { notFound } from "next/navigation";
import { readRenderTask } from "@/lib/render-store";

type RenderPageProps = {
  params: Promise<{ id: string }>;
};

export default async function RenderPage({ params }: RenderPageProps) {
  const { id } = await params;
  const task = await readRenderTask(id);

  if (!task) {
    notFound();
  }

  return (
    <main className="app-shell">
      <div className="render-page">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h1 className="panel-title">渲染任务</h1>
              <p className="panel-subtitle">任务 ID：{task.id}</p>
            </div>
            <span className="pill">{task.status}</span>
          </div>
          <div className="form-stack">
            <div className="status-box">
              <div>创建时间：{task.createdAt}</div>
              <div>更新时间：{task.updatedAt}</div>
              {task.error ? <div>错误：{task.error}</div> : null}
            </div>

            {task.outputUrl ? (
              <>
                <video src={task.outputUrl} controls style={{ width: "100%", borderRadius: 8, background: "#102326" }} />
                <a className="button" href={task.outputUrl} download>
                  下载 MP4
                </a>
              </>
            ) : (
              <div className="status-box">渲染尚未完成。刷新页面或请求 /api/render/status?id={task.id} 查看最新状态。</div>
            )}

            <Link className="button secondary" href="/generate/input">
              重新生成
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
