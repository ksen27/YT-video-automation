import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewProjectForm } from "./new-project-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

async function loadProjects(): Promise<ProjectRow[]> {
  if (!isSupabaseConfigured()) return [];
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from("projects")
    .select("id, title, status, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return [];
  return (data ?? []) as ProjectRow[];
}

function statusVariant(s: string): "default" | "secondary" | "success" | "warning" | "destructive" {
  if (s === "completed") return "success";
  if (s === "failed") return "destructive";
  if (s === "ready_for_review") return "warning";
  if (s === "draft") return "secondary";
  return "default";
}

export default async function DashboardPage() {
  const projects = await loadProjects();
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Create a project, paste a script, and generate a video.</p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>New project</CardTitle>
          <CardDescription>Start from a script or empty draft.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewProjectForm />
        </CardContent>
      </Card>

      {!isSupabaseConfigured() && (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Supabase not configured</CardTitle>
            <CardDescription>
              Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local. See <Link className="underline" href="/settings">settings</Link>.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Recent projects</h2>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="block">
                <Card className="hover:bg-accent/40 transition-colors">
                  <CardHeader>
                    <CardTitle className="truncate">{p.title}</CardTitle>
                    <CardDescription>{new Date(p.created_at).toLocaleString()}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Badge variant={statusVariant(p.status)}>{p.status.replace(/_/g, " ")}</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
