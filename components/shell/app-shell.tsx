import * as React from "react";
import { Sidebar } from "./sidebar";
import { TopHeader } from "./top-header";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex flex-1 min-w-0 flex-col">
        <TopHeader />
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
