import * as React from "react";

export interface WorkspaceLayoutProps {
  header?: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
}

export function WorkspaceLayout({ header, children, right }: WorkspaceLayoutProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {header}
      <div className="flex flex-1 min-h-0">
        <main className="flex-1 min-w-0 overflow-y-auto px-6 lg:px-8 py-6">
          {children}
        </main>
        {right && (
          <aside className="hidden xl:flex xl:w-80 shrink-0 flex-col border-l border-border bg-bg-elevated overflow-y-auto">
            {right}
          </aside>
        )}
      </div>
    </div>
  );
}
