import { Suspense } from "react";
import { LoginPageForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageForm />
    </Suspense>
  );
}
