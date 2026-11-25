import { LoginForm } from "@/components/login-form";

/** Merchant self-registration: a shop account of its own, not a customer account. */
export default function MerchantRegisterPage() {
  return <LoginForm merchant />;
}
