import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { isPublicDemoMode } from "@/lib/auth/demo-mode";

export const metadata: Metadata = { title: "Create account" };
export default function CreateAccountPage() {
  if (isPublicDemoMode()) redirect("/sign-in?signup=disabled");
  return <AuthCard mode="create-account" signUpEnabled />;
}
