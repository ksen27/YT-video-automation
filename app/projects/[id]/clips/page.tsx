import { ClipsView } from "./clips-view";
import Link from "next/link";

export default async function ProjectClipsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <p className="text-xs text-muted-foreground">
        <Link href={`/projects/${id}`}>← Project</Link>
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">All clips</h1>
      <ClipsView projectId={id} />
    </div>
  );
}
