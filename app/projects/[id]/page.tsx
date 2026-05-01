import { ProjectWorkspace } from "./workspace";

// Next.js 16 — params and searchParams are async on pages.
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const autoAnalyze = sp.analyze === "1";
  return <ProjectWorkspace projectId={id} autoAnalyze={autoAnalyze} />;
}
