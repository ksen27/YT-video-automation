"use client";

import { Bell, Search } from "lucide-react";

export function TopHeader() {
  return (
    <header className="h-14 shrink-0 border-b border-border bg-bg-elevated/60 backdrop-blur supports-[backdrop-filter]:bg-bg-elevated/40">
      <div className="flex h-full items-center gap-3 px-6">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle" />
          <input
            placeholder="Search projects…"
            className="w-full h-8 pl-8 pr-3 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <button
          aria-label="Notifications"
          className="grid place-items-center h-8 w-8 rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
        >
          <Bell className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
