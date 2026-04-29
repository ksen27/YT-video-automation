"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useState } from "react";

const Schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  transcript: z.string().max(50_000).optional(),
});
type Values = z.infer<typeof Schema>;

export function NewProjectForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(Schema),
    defaultValues: { title: "", transcript: "" },
  });

  async function onSubmit(values: Values) {
    setServerError(null);
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setServerError(j.error ?? `Failed (${r.status})`);
      return;
    }
    const j = await r.json();
    router.push(`/projects/${j.project.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" {...register("title")} placeholder="e.g. Inside Margot Robbie's Career" />
        {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
      </div>
      <div className="sm:row-span-2 space-y-1.5">
        <Label htmlFor="transcript">Transcript (optional)</Label>
        <Textarea id="transcript" rows={6} {...register("transcript")} placeholder="Paste a script now or later." />
      </div>
      <div className="flex items-end gap-3">
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating..." : "Create project"}</Button>
        {serverError && <p className="text-xs text-destructive">{serverError}</p>}
      </div>
    </form>
  );
}
