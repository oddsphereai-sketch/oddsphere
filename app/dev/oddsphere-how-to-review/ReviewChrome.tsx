"use client";

export default function ReviewChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style jsx global>{`
        body > nav,
        body > footer {
          display: none;
        }
      `}</style>
      {children}
    </>
  );
}
