"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/utils";

interface Clip {
  id: string;
  start_time: number;
  end_time: number;
  duration: number;
  clip_url: string | null;
  thumbnail_url: string | null;
  status: string;
  source: { id: string; title: string | null; channel_title: string | null; youtube_url: string | null } | null;
}

export function ClipsView({ projectId }: { projectId: string }) {
  const q = useQuery<{ clips: Clip[] }>({
    queryKey: ["project-clips", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}/clips`).then((r) => r.json()),
    refetchInterval: 5000,
  });
  const clips = q.data?.clips ?? [];
  if (clips.length === 0) return <p className="text-sm text-muted-foreground">No clips yet.</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {clips.map((c) => (
        <Card key={c.id}>
          <CardContent className="p-3 space-y-2">
            <div className="aspect-video bg-muted border border-border rounded overflow-hidden">
              {c.clip_url ? (
                <video src={c.clip_url} controls preload="metadata" className="w-full h-full object-cover" poster={c.thumbnail_url ?? undefined} />
              ) : c.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbnail_url} alt="" className="w-full h-full object-cover" />
              ) : null}
            </div>
            <div className="text-xs space-y-1">
              <div className="truncate">{c.source?.title ?? "—"}</div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{formatDuration(c.start_time)} → {formatDuration(c.end_time)}</span>
                <Badge variant="outline">{Math.round(c.duration)}s</Badge>
              </div>
              {c.source?.youtube_url && (
                <a href={c.source.youtube_url} target="_blank" rel="noreferrer" className="underline text-muted-foreground">source</a>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
