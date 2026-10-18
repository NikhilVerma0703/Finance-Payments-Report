import { MobileNav, Sidebar } from "@/components/Sidebar";

/**
 * The application shell. It reads nothing from the request, so it renders once
 * and stays mounted — only the content area changes between sections.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-6 pb-16 pt-6 lg:px-8">
        <MobileNav />
        {children}
      </main>
    </div>
  );
}
