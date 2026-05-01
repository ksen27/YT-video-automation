"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { EmptyState } from "@/components/ui/empty-state";
import {
  derivePhase,
  jobsBusy,
  type JobsResp,
  type ProjectResp,
  type TimelineRow,
} from "./_shared";
import { ProjectHeader } from "./_components/project-header";
import { IntakeScreen } from "./_components/intake-screen";
import { AnalysisScreen } from "./_components/analysis-screen";
import { ProcessingScreen } from "./_components/processing-screen";
import { BlockEditorScreen } from "./_components/block-editor-screen";
import { ExportScreen } from "./_components/export-screen";
import { RightPanel } from "./_components/panels/right-panel";

export function ProjectWorkspace({
  projectId,
  autoAnalyze = false,
}: {
  projectId: string;
  autoAnalyze?: boolean;
}) {
  const projectQ = useQuery<ProjectResp>({
    queryKey: ["project", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}`).then((r) => r.json()),
  });

  const jobsQ = useQuery<JobsResp>({
    queryKey: ["project-jobs", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}/jobs`).then((r) => r.json()),
    refetchInterval: (q) => (jobsBusy(q.state.data) ? 2000 : 8000),
  });

  const timelineQ = useQuery<{ items: TimelineRow[] }>({
    queryKey: ["project-timeline", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}/timeline`).then((r) => r.json()),
    refetchInterval: 8000,
  });

  const [phaseOverride, setPhaseOverride] = useState<"export" | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  if (projectQ.isLoading) {
    return (
      <div className="grid place-items-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-fg-muted" />
      </div>
    );
  }

  if (projectQ.isError || !projectQ.data?.project) {
    return (
      <div className="p-8">
        <EmptyState
          title="Project not found"
          description="It may have been deleted, or the link is invalid."
        />
      </div>
    );
  }

  const project = projectQ.data;
  const jobs = jobsQ.data;
  const timelineCount = timelineQ.data?.items.length ?? 0;
  const derived = derivePhase(project, jobs, timelineCount);
  const phase = phaseOverride ?? derived;
  const canExport = derived === "editor" || derived === "export";

  return (
    <WorkspaceLayout
      header={
        <ProjectHeader
          project={project.project}
          phase={phase}
          jobs={jobs}
          exportDisabled={!canExport}
          onExport={() => setPhaseOverride("export")}
        />
      }
      right={
        <RightPanel
          projectId={projectId}
          phase={phase}
          project={project}
          jobs={jobs}
          selectedBlockId={selectedBlockId}
        />
      }
    >
      {phase === "intake" && (
        <IntakeScreen projectId={projectId} project={project.project} />
      )}
      {phase === "analysis" && (
        <AnalysisScreen projectId={projectId} autoStart={autoAnalyze} />
      )}
      {phase === "processing" && (
        <ProcessingScreen projectId={projectId} jobs={jobs} />
      )}
      {phase === "editor" && (
        <BlockEditorScreen
          projectId={projectId}
          selectedId={selectedBlockId}
          onSelect={setSelectedBlockId}
        />
      )}
      {phase === "export" && <ExportScreen projectId={projectId} jobs={jobs} />}
    </WorkspaceLayout>
  );
}
