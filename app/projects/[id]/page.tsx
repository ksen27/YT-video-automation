import { ProjectWorkspace } from "./workspace";

// Next.js 16 — params is async on pages too.
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectWorkspace projectId={id} />;
}
