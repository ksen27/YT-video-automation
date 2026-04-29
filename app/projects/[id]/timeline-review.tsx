"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

interface TimelineItem {
  id: string;
  clip_id: string | null;
  type: string;
  position: number;
  duration: number;
  script_text: string | null;
  overlay_text: string | null;
  approved: boolean;
}
interface Clip {
  id: string;
  thumbnail_url: string | null;
  source: { title: string | null } | null;
}

export function TimelineReview({ projectId }: { projectId: string }) {
  const qc = useQueryClient();

  const tlQ = useQuery<{ items: TimelineItem[] }>({
    queryKey: ["project-timeline", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}/timeline`).then((r) => r.json()),
    refetchInterval: 5000,
  });
  const clipsQ = useQuery<{ clips: Clip[] }>({
    queryKey: ["project-clips", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}/clips`).then((r) => r.json()),
  });

  const items = tlQ.data?.items ?? [];
  const clips = clipsQ.data?.clips ?? [];
  const clipById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);

  const [editingClipFor, setEditingClipFor] = useState<string | null>(null);

  const patch = useMutation({
    mutationFn: async (body: { items: Array<{ id: string; [k: string]: unknown }>; approve_all?: boolean }) => {
      const r = await fetch(`/api/projects/${projectId}/timeline`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? `failed ${r.status}`);
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-timeline", projectId] }),
  });

  function reorder(itemId: string, dir: -1 | 1) {
    const sorted = [...items].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((i) => i.id === itemId);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swap];
    patch.mutate({
      items: [
        { id: a.id, position: b.position },
        { id: b.id, position: a.position },
      ],
    });
  }

  function removeItem(id: string) {
    patch.mutate({ items: [{ id, delete: true }] });
  }

  function replaceClip(itemId: string, clipId: string) {
    patch.mutate({ items: [{ id: itemId, clip_id: clipId }] });
    setEditingClipFor(null);
  }

  function approveAll() {
    patch.mutate({ items: [], approve_all: true });
  }

  const sorted = [...items].sort((a, b) => a.position - b.position);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Timeline review</CardTitle>
          <CardDescription>{sorted.length} items · approve before rendering.</CardDescription>
        </div>
        <Button
          onClick={approveAll}
          disabled={patch.isPending || sorted.length === 0 || sorted.every((it) => it.approved)}
        >
          Approve all
        </Button>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No timeline yet. Run generation first.</p>
        ) : (
          <ol className="space-y-3">
            {sorted.map((it, idx) => {
              const clip = it.clip_id ? clipById.get(it.clip_id) : null;
              return (
                <li key={it.id} className="flex gap-3 p-3 rounded-md border border-border bg-card">
                  <div className="w-32 aspect-video bg-muted rounded overflow-hidden border border-border">
                    {clip?.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={clip.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">{it.type}</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">#{idx + 1}</Badge>
                      <Badge variant="secondary">{it.type}</Badge>
                      <Badge variant="outline">{Math.round(it.duration)}s</Badge>
                      {it.approved && <Badge variant="success">approved</Badge>}
                    </div>
                    {it.script_text && <p className="text-sm text-muted-foreground line-clamp-2">{it.script_text}</p>}
                    {it.overlay_text && <p className="text-xs italic">overlay: {it.overlay_text}</p>}
                    {editingClipFor === it.id && (
                      <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                        {clips.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => replaceClip(it.id, c.id)}
                            className="aspect-video bg-muted rounded overflow-hidden border border-border hover:border-primary"
                          >
                            {c.thumbnail_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={c.thumbnail_url} alt="" className="w-full h-full object-cover" />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button size="icon" variant="ghost" onClick={() => reorder(it.id, -1)} disabled={idx === 0}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => reorder(it.id, 1)} disabled={idx === sorted.length - 1}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingClipFor(editingClipFor === it.id ? null : it.id)}>
                      {editingClipFor === it.id ? "Cancel" : "Replace"}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => removeItem(it.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
