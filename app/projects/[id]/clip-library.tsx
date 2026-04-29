"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

export function ClipLibrary({ projectId }: { projectId: string }) {
  const q = useQuery<{ clips: Clip[] }>({
    queryKey: ["project-clips", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}/clips`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const clips = q.data?.clips ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clip library</CardTitle>
        <CardDescription>{clips.length} clips · 4–5s each</CardDescription>
      </CardHeader>
      <CardContent>
        {clips.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clips yet. Run generation to fill this.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {clips.slice(0, 30).map((c) => (
              <div key={c.id} className="space-y-1">
                <div className="aspect-video rounded-md overflow-hidden border border-border bg-muted">
                  {c.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  ) : null}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate">{c.source?.title ?? "—"}</span>
                  <Badge variant="outline">{formatDuration(c.duration)}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
