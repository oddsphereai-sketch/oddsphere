import { Suspense, type ReactNode } from "react";
import LabAppNav from "./LabAppNav";
import { UserTimeZoneProvider } from "./UserTimeZone";

export default function ProductAppFrame({ children }: { children: ReactNode }) {
  return (
    <UserTimeZoneProvider>
      <Suspense fallback={null}>
        <LabAppNav />
      </Suspense>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <Suspense fallback={<div className="py-16 text-center text-gray-400">Loading...</div>}>
          {children}
        </Suspense>
      </main>
    </UserTimeZoneProvider>
  );
}
