import { redirect } from "next/navigation";
import { getAdminUserId } from "@/lib/admin";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const adminId = await getAdminUserId();
  if (!adminId) redirect(`/${locale}/profil`);

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] md:pt-6">
      {children}
    </div>
  );
}
