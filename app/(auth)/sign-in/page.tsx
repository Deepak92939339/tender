import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { isPublicDemoMode } from "@/lib/auth/demo-mode";
import { safeReturnTo } from "@/lib/auth/return-to";

export const metadata: Metadata = { title: "Sign in" };
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const query = await searchParams;
  const publicDemo = isPublicDemoMode();
  return (
    <AuthCard
      mode="sign-in"
      returnTo={safeReturnTo(query.returnTo)}
      signUpEnabled={!publicDemo}
      showReviewerAccess={publicDemo}
    />
  );
}
