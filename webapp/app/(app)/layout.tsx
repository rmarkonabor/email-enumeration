import NavBar from "@/components/NavBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NavBar />
      <main className="max-w-5xl mx-auto px-6 py-10">{children}</main>
    </>
  );
}
